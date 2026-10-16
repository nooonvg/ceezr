import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { ensureActiveCity, restoreCityBaseline } from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const sql = postgres(DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/waslah");

describeIf("F12-10 — امتثال PDPL: أساسُ المعالجةِ وحقوقُ أصحابِ البياناتِ", () => {
  let cityId: string;
  let userId: string;
  /** مقبضُ المدينةِ للردِّ في afterAll — عقدُ المعينِ كاملًا لا نصفُه. */
  let cityHandle: Awaited<ReturnType<typeof ensureActiveCity>> | undefined;

  beforeAll(async () => {
    // مدينةٌ مفعّلةٌ عبرَ المعينِ الموحّدِ (لا اقتباسُ «أوّلِ مدينةٍ» — ترتيبُ
    // التشغيلِ المتوازي يُخلي الجداولِ فلا ضمانَ لوجودِ صفٍّ). انظر
    // tests/support/active-city.ts: الاقتباسُ العشوائيُّ أخضرٌ زائفٌ رهنُ الترتيب.
    const city = await ensureActiveCity(sql);
    cityHandle = city;
    cityId = city.cityId;
    // مستخدمٌ خاصٌّ بهذا الملفِّ — لا اقتباسُ «أوّلِ مستخدمٍ»: الملفّاتُ المتوازيةُ
    // تقتلعُ users في beforeEach فأيُّ اقتباسٍ عشوائيٍّ UNDEFINED_VALUE عندَ التزامنِ
    // (قياسُ الجولةِ: CI يُسقطُ هذا الملفَّ وحدَهُ في الحزمةِ المتوازيةِ).
    const inserted = await sql`
      insert into users (city_id, telegram_id, full_name, role)
      values (${cityId}::uuid, ${991_500_010}::bigint, 'فاحصُ PDPL', 'rider')
      returning id`;
    userId = inserted[0]?.id as string;
  });

  it("لا يُسمَحُ بنشاطٍ بلا أساسِ معالجةٍ أو غيرِ نشطٍ", async () => {
    // نشاطٌ مسوّدةٌ (draft) — لا يُسمَحُ به
    const draft = await sql`
      insert into pdpl_processing_activities (
        city_id, controller_contact, purpose, processing_basis,
        mandatory_data_categories, subject_categories,
        disclosure_recipients, expected_retention_period,
        requires_dpia, status, created_by, updated_by
      ) values (
        ${cityId}::uuid, 'dpo@waslah.sa', 'تسجيلُ الركّابِ', 'consent'::pdpl_processing_basis,
        array['phone']::text[], array['rider']::text[],
        array[]::text[], 'سنةٌ واحدةٌ',
        false, 'draft'::pdpl_activity_status,
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const draftId = draft[0]?.id as string;
    const allowed = await sql`
      select pdpl_processing_activity_is_allowed(${draftId}::uuid) as allowed
    `;
    // المسوّدةُ غيرُ مسموحةٍ
    expect(allowed[0]?.allowed).toBe(false);

    // نشاطٌ نشطٌ — مسموحٌ
    await sql`
      update pdpl_processing_activities set status = 'active'::pdpl_activity_status where id = ${draftId}::uuid
    `;
    const activeAllowed = await sql`
      select pdpl_processing_activity_is_allowed(${draftId}::uuid) as allowed
    `;
    expect(activeAllowed[0]?.allowed).toBe(true);
  });

  it("نشاطٌ عاليُ الخطرِ بلا DPIA معتمدٍ يُرفَضُ", async () => {
    const activity = await sql`
      insert into pdpl_processing_activities (
        city_id, controller_contact, purpose, processing_basis,
        mandatory_data_categories, subject_categories,
        disclosure_recipients, expected_retention_period,
        requires_dpia, status, created_by, updated_by
      ) values (
        ${cityId}::uuid, 'dpo@waslah.sa', 'معالجةُ بياناتٍ حسّاسةٍ', 'consent'::pdpl_processing_basis,
        array['health']::text[], array['patient']::text[],
        array[]::text[], 'سنتانِ',
        true, 'active'::pdpl_activity_status,
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const activityId = activity[0]?.id as string;

    // يتطلَّبُ DPIA وليسَ معتمداً
    const required = await sql`
      select pdpl_high_risk_requires_dpia(${activityId}::uuid) as required
    `;
    expect(required[0]?.required).toBe(true);
  });

  it("DPIA معتمدٌ يُغيِّر الحُكمَ", async () => {
    const activity = await sql`
      insert into pdpl_processing_activities (
        city_id, controller_contact, purpose, processing_basis,
        mandatory_data_categories, subject_categories,
        disclosure_recipients, expected_retention_period,
        requires_dpia, status, created_by, updated_by
      ) values (
        ${cityId}::uuid, 'dpo@waslah.sa', 'معالجةٌ عاليةُ الخطرِ', 'consent'::pdpl_processing_basis,
        array['financial']::text[], array['customer']::text[],
        array[]::text[], 'خمسُ سنواتٍ',
        true, 'active'::pdpl_activity_status,
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const activityId = activity[0]?.id as string;

    // قبلَ الاعتمادِ: يتطلَّبُ DPIA
    const beforeApproved = await sql`
      select pdpl_high_risk_requires_dpia(${activityId}::uuid) as required
    `;
    expect(beforeApproved[0]?.required).toBe(true);

    // إضافةُ تقييمِ أثرٍ معتمدٍ
    await sql`
      insert into pdpl_dpia_assessments (
        city_id, processing_activity_id,
        processing_description, identified_risks, mitigation_measures,
        residual_risk_level, status, assessed_by, approved_by,
        next_review_due
      ) values (
        ${cityId}::uuid, ${activityId}::uuid,
        'معالجةُ بياناتٍ ماليّةٍ', 'خطرُ تسريبٍ ماليٍّ', 'تشفيرٌ + تحكمُ وصولٍ',
        'low_risk'::pdpl_dpia_risk_level, 'approved'::pdpl_dpia_status,
        ${userId}::uuid, ${userId}::uuid,
        now() + interval '2 years'
      )
    `;

    // بعدَ الاعتمادِ: لا يتطلَّبُ DPIA بعدَ
    const afterApproved = await sql`
      select pdpl_high_risk_requires_dpia(${activityId}::uuid) as required
    `;
    expect(afterApproved[0]?.required).toBe(false);
  });

  it("النقلُ خارجَ المملكةِ مرفوضٌ افتراضياً", async () => {
    const activity = await sql`
      insert into pdpl_processing_activities (
        city_id, controller_contact, purpose, processing_basis,
        mandatory_data_categories, subject_categories,
        disclosure_recipients, expected_retention_period,
        requires_dpia, status, created_by, updated_by
      ) values (
        ${cityId}::uuid, 'dpo@waslah.sa', 'معالجةٌ عامّةٌ', 'consent'::pdpl_processing_basis,
        array['contact']::text[], array['customer']::text[],
        array[]::text[], 'سنةٌ',
        false, 'active'::pdpl_activity_status,
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const activityId = activity[0]?.id as string;

    // نقلٌ مطلوبٌ فقط (requested) — غيرُ مسموحٍ
    const transfer = await sql`
      insert into pdpl_cross_border_transfers (
        city_id, processing_activity_id,
        recipient_country, recipient_entity,
        transferred_data_categories, transfer_basis,
        protection_safeguards, status,
        approved_at, expires_at, created_by
      ) values (
        ${cityId}::uuid, ${activityId}::uuid,
        'AE', 'Cloud Provider',
        array['phone']::text[], 'ksa_interests'::pdpl_transfer_basis,
        'اتفاقيّةُ معالجةٍ موقَّعةٌ', 'requested'::pdpl_transfer_status,
        null, now() + interval '1 year',
        ${userId}::uuid
      )
      returning id
    `;
    const transferId = transfer[0]?.id as string;

    const allowed = await sql`
      select pdpl_cross_border_transfer_allowed(${transferId}::uuid) as allowed
    `;
    expect(allowed[0]?.allowed).toBe(false);
  });

  it("النقلُ المعتمدُ غيرُ المنتهي فقط يُسمَحُ به", async () => {
    const activity = await sql`
      insert into pdpl_processing_activities (
        city_id, controller_contact, purpose, processing_basis,
        mandatory_data_categories, subject_categories,
        disclosure_recipients, expected_retention_period,
        requires_dpia, status, created_by, updated_by
      ) values (
        ${cityId}::uuid, 'dpo@waslah.sa', 'معالجةٌ عامّةٌ', 'consent'::pdpl_processing_basis,
        array['contact']::text[], array['customer']::text[],
        array[]::text[], 'سنةٌ',
        false, 'active'::pdpl_activity_status,
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const activityId = activity[0]?.id as string;

    // نقلٌ معتمدٌ وغيرُ منتهي
    const validTransfer = await sql`
      insert into pdpl_cross_border_transfers (
        city_id, processing_activity_id,
        recipient_country, recipient_entity,
        transferred_data_categories, transfer_basis,
        protection_safeguards, status,
        approved_at, expires_at, approved_by, created_by
      ) values (
        ${cityId}::uuid, ${activityId}::uuid,
        'US', 'Cloud Provider',
        array['phone']::text[], 'treaty_obligation'::pdpl_transfer_basis,
        'اتفاقيّةُ نقلٍ موقَّعةٌ + تشفيرٌ', 'approved'::pdpl_transfer_status,
        now(), now() + interval '1 year',
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const validId = validTransfer[0]?.id as string;
    const validAllowed = await sql`
      select pdpl_cross_border_transfer_allowed(${validId}::uuid) as allowed
    `;
    expect(validAllowed[0]?.allowed).toBe(true);

    // نقلٌ معتمدٌ لكن منتهي
    const expiredTransfer = await sql`
      insert into pdpl_cross_border_transfers (
        city_id, processing_activity_id,
        recipient_country, recipient_entity,
        transferred_data_categories, transfer_basis,
        protection_safeguards, status,
        approved_at, expires_at, approved_by, created_by
      ) values (
        ${cityId}::uuid, ${activityId}::uuid,
        'US', 'Cloud Provider',
        array['phone']::text[], 'treaty_obligation'::pdpl_transfer_basis,
        'اتفاقيّةُ نقلٍ موقَّعةٌ + تشفيرٌ', 'approved'::pdpl_transfer_status,
        now() - interval '2 years', now() - interval '1 year',
        ${userId}::uuid, ${userId}::uuid
      )
      returning id
    `;
    const expiredId = expiredTransfer[0]?.id as string;
    const expiredAllowed = await sql`
      select pdpl_cross_border_transfer_allowed(${expiredId}::uuid) as allowed
    `;
    expect(expiredAllowed[0]?.allowed).toBe(false);
  });

  it("طلبُ حقِّ صاحبِ بياناتٍ له مهلةٌ ثلاثونَ يوماً وحالاتُ انتقالٍ", async () => {
    // تسجيلُ الطلبِ
    const requestId = await sql`
      select pdpl_record_right_request(
        ${cityId}::uuid,
        'access'::pdpl_subject_right,
        '123456789',
        ${userId}::uuid
      ) as request_id
    `;
    const id = requestId[0]?.request_id as string;
    expect(id).toBeTruthy();

    // المهلةُ: ٣٠ يوماً من الاستلامِ
    const deadline = await sql`
      select pdpl_right_request_deadline(now()) as deadline
    `;
    const diff = (new Date(deadline[0]?.deadline as string).getTime() - Date.now()) / 86400000;
    expect(diff).toBeCloseTo(30, 0);

    // الطلبُ ليسَ منقضيَ الموعدِ (استُلمَ الآنَ)
    const overdue = await sql`
      select pdpl_right_request_is_overdue(${id}::uuid) as overdue
    `;
    expect(overdue[0]?.overdue).toBe(false);

    // إغلاقُ الطلبِ بنتيجةٍ
    await sql`
      select pdpl_close_right_request(
        ${id}::uuid,
        'fulfilled'::pdpl_right_request_status,
        'تمَّ تسليمُ البياناتِ',
        null
      )
    `;
    const closed = await sql`
      select status, completed_at, result_summary from pdpl_data_subject_requests where id = ${id}::uuid
    `;
    expect(closed[0]?.status).toBe("fulfilled");
    expect(closed[0]?.completed_at).not.toBeNull();
    expect(closed[0]?.result_summary).toBe("تمَّ تسليمُ البياناتِ");
  });

  afterAll(async () => {
    // عقدُ المعينِ كاملًا: التفعيلُ في beforeAll والردُّ إلى الحالةِ الأصلِ هنا.
    // حارسُ check-integration-city-precondition يُسقطُ من ينادي أحدَهما دونَ الآخر.
    await restoreCityBaseline(sql, cityHandle);
    await sql.end();
  });
});
