/**
 * اختبار قاعدة حقيقية لإشعارات دورة حياة الاشتراك: انتهاءُ التجربة والاشتراك
 *   والإلغاء والتفعيل تُنتج إشعاراً واحداً لا أكثر، ولا يُسلَّم مرّتين، والفشلُ
 *   العابر يُعاد والدائمُ يُوسَم فاشلاً، والمحجوبُ لا يُشعَر.
 *
 * لا يوجد Telegram فعلي هنا: الناشرُ المزدوج يُثبت أثرَ الإرسال وحكمَ الدوام فقط،
 * وكلُّ ما عداه — الإدراجُ والحجزُ والتقدّم — يُنفَّذ على PostgreSQL حقيقية.
 *
 * الفخُّ المُثبَت هنا: `activate_subscription` تُغلق صفَّ التجربة إلى `expired`
 * بنفسها، فلو كان الإشعار مبنيّاً على الحالة لا على الواقعة لكان السائق الذي
 * دفع يستقبل «انتهت فترتك» بعد لحظةٍ من «تم تفعيل اشتراكك».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverSubscriptionNotices } from "../../packages/application/subscription/deliver-notices.ts";
import type {
  SubscriptionNoticeKind,
  SubscriptionNoticePublisher,
} from "../../packages/application/subscription/notice-ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSubscriptionNoticeDeliveryPort } from "../../packages/infrastructure/subscription/notice-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let driverId: string;
let driverUserId: string;
let notices: ReturnType<typeof createSubscriptionNoticeDeliveryPort>;

const DRIVER_CHAT = "771001";

async function firstId(rows: { id: string }[], what: string): Promise<string> {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر تجهيز ${what}`);
  return id;
}

async function createFixture(): Promise<void> {
  cityId = await firstId(
    await sql<{ id: string }[]>`select id from cities where code = 'JED'`,
    "مدينة جدة",
  );
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  driverUserId = await firstId(
    await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, ${DRIVER_CHAT}::bigint, 'سائق الإشعارات', '+966500771001', 'driver', 'ar')
      returning id
    `,
    "مستخدم السائق",
  );
  driverId = await firstId(
    await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${driverUserId}::uuid, 'verified', 'sedan', 'NT-1001')
      returning id
    `,
    "السائق",
  );
}

/**
 * صفُّ اشتراكٍ بحالةٍ محدَّدة. الوحدةُ الواحدةُ الحيّة يحرسها فهرسٌ جزئي، فلا يُنشأ
 * صفّان حيّان لسائقٍ واحد. والإلغاءُ في هذا المخطّط ليس عموداً بموعد بل
 * `cancel_at_period_end` مع وقتِ طلبٍ يفرضه قيدُ التماسك.
 */
async function seedSubscription(input: {
  readonly status: "trialing" | "active" | "expired";
  readonly cancelAtPeriodEnd?: boolean;
}): Promise<string> {
  const cancelling = input.cancelAtPeriodEnd === true;
  return await firstId(
    await sql<{ id: string }[]>`
      insert into subscriptions
        (city_id, driver_id, plan, status, price_amount, currency,
         cancel_at_period_end, cancellation_requested_at)
      values (${cityId}, ${driverId}::uuid, 'transport', ${input.status}::subscription_status,
              250, 'SAR', ${cancelling},
              case when ${cancelling} then now() else null end)
      returning id
    `,
    "الاشتراك",
  );
}

async function expireDue(): Promise<Record<string, unknown>> {
  const rows = await sql<
    { result: Record<string, unknown> }[]
  >`select expire_due_subscriptions() result`;
  const result = rows[0]?.result;
  if (result === undefined) throw new Error("تعذّرت دورة الانتهاء");
  return result;
}

interface NoticeRow {
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly message_id: string | null;
  readonly error_code: string | null;
  readonly payload: Record<string, unknown>;
}

async function noticeRows(): Promise<NoticeRow[]> {
  return await sql<NoticeRow[]>`
    select payload->>'notice_kind' kind, status, attempts, delivered_message_id::text message_id,
           error_code, payload
    from notification_outbox
    where kind = 'subscription_notice'
    order by created_at`;
}

/** ناشرٌ يسجّل ما أُرسل ويُخفق بحسب جدولٍ يُملى عليه — لا شبكةَ ولا تلغرام. */
function fakePublisher(options: {
  readonly sent: string[];
  readonly failures?: { code: string; permanent: boolean }[];
}): SubscriptionNoticePublisher {
  let sequence = 0;
  return {
    publish: async (input) => {
      const failure = options.failures?.shift();
      if (failure !== undefined) return err(failure);
      sequence += 1;
      options.sent.push(input.text);
      return ok({ messageId: String(8000 + sequence) });
    },
  };
}

describeIf("إشعارات دورة حياة الاشتراك على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table subscription_notices, notification_outbox, subscription_invoices,
        subscriptions, drivers, riders, users, audit_log restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table subscription_notices, notification_outbox, subscription_invoices,
        subscriptions, drivers, riders, users, audit_log restart identity cascade
    `;
    await sql`
      update platform_settings set value = '""'::jsonb
      where key = 'unsubscribed_drivers_group_link'
    `;
    await createFixture();
    notices = createSubscriptionNoticeDeliveryPort(sql);
  });

  it("انتهاءُ التجربة يُنتج إشعاراً واحداً لا يتكرّر في الدورة التالية", async () => {
    await seedSubscription({ status: "trialing" });
    await sql`
      update subscriptions set trial_ends_at = now() - interval '1 minute' where driver_id = ${driverId}::uuid
    `;

    const first = await expireDue();
    expect(first.ok).toBe(true);
    expect(Number(first.expired_subscriptions)).toBe(1);

    let rows = await noticeRows();
    expect(rows.length).toBe(1);
    expect(rows[0]?.kind).toBe("trial_expired");
    expect(rows[0]?.status).toBe("pending");
    // الحمولةُ تحمل واقعةَ الانتهاء لا حالةَ اللحظة: النصُّ يُصاغ منها بعد ساعات.
    expect(typeof rows[0]?.payload.ends_at).toBe("string");

    await expireDue();
    rows = await noticeRows();
    expect(rows.length).toBe(1);
  });

  it("الإلغاءُ المستحقّ يُشعِر بالإلغاء لا بالانتهاء", async () => {
    await seedSubscription({ status: "active", cancelAtPeriodEnd: true });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    const result = await expireDue();
    expect(Number(result.cancelled_subscriptions)).toBe(1);
    const rows = await noticeRows();
    expect(rows.map((row) => row.kind)).toEqual(["cancelled"]);
  });

  it("انتهاءُ اشتراكٍ مدفوع يُشعِر بالانتهاء لا بانتهاء التجربة", async () => {
    await seedSubscription({ status: "active" });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    await expireDue();
    const rows = await noticeRows();
    expect(rows.map((row) => row.kind)).toEqual(["expired"]);
  });

  it("التفعيلُ يُشعِر بالتفعيل، ولا يُنتج إشعارَ انتهاءٍ لصفّ التجربة الذي أغلقه", async () => {
    await seedSubscription({ status: "trialing" });
    await sql`
      update subscriptions set trial_ends_at = now() + interval '10 days' where driver_id = ${driverId}::uuid
    `;
    const activated = await sql<{ result: Record<string, unknown> }[]>`
      select activate_subscription(${driverId}::uuid, 'transport'::subscription_plan, 30) result
    `;
    expect(activated[0]?.result.ok).toBe(true);

    const rows = await noticeRows();
    // إشعارٌ واحد: التفعيل. والصفُّ القديم أُغلق بـ`expired` من داخل الدالّة نفسها،
    // فلو كان الإدراجُ مبنيّاً على الحالة لجاء إشعارُ «انتهت فترتك» بعده بلحظة.
    expect(rows.map((row) => row.kind)).toEqual<SubscriptionNoticeKind[]>(["activated"]);
    expect(rows[0]?.payload.plan).toBe("transport");
    expect(typeof rows[0]?.payload.period_end).toBe("string");

    // ثمّ دورةُ الانتهاء لا تجد شيئاً مستحقّاً ولا تُضيف إشعاراً.
    await expireDue();
    expect((await noticeRows()).length).toBe(1);
  });

  it("التسليمُ يُرسل مرّةً واحدة ويحفظ معرّف الرسالة", async () => {
    await seedSubscription({ status: "active" });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    await expireDue();

    const sent: string[] = [];
    const first = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("تعذّر الشوط");
    expect(first.value).toMatchObject({ claimed: 1, sent: 1, failed: 0, retried: 0 });
    expect(sent.length).toBe(1);
    // نصُّ الإشعار يحمل اسمَ الخطّة بلغة السائق لا رمزَها الإنجليزي.
    expect(sent[0]).toContain("نقل أشخاص");

    const rows = await noticeRows();
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.message_id).toBe("8001");

    // شوطٌ ثانٍ لا يجد ما يحجزه: الإشعارُ المُسلَّم لا يُسلَّم مرّتين.
    const second = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!second.ok) throw new Error("تعذّر الشوط الثاني");
    expect(second.value.claimed).toBe(0);
    expect(sent.length).toBe(1);
  });

  it("الفشلُ العابر يُعاد بعد موعد المدينة، والدائمُ يُوسَم فاشلاً بلا إعادة", async () => {
    await seedSubscription({ status: "active" });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    await expireDue();

    const sent: string[] = [];
    const transient = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent, failures: [{ code: "429:flood", permanent: false }] }),
    });
    if (!transient.ok) throw new Error("تعذّر الشوط العابر");
    expect(transient.value).toMatchObject({ claimed: 1, sent: 0, failed: 0, retried: 1 });
    let rows = await noticeRows();
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.attempts).toBe(1);

    // الموعدُ التالي في المستقبل: شوطٌ فوريّ لا يحجزه، وإلّا كانت الإعادة حرقاً لحدّ الإرسال.
    const immediate = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!immediate.ok) throw new Error("تعذّر الشوط الفوري");
    expect(immediate.value.claimed).toBe(0);

    await sql`update notification_outbox set next_attempt_at = now() - interval '1 second'
              where kind = 'subscription_notice'`;
    const permanent = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent, failures: [{ code: "403:blocked", permanent: true }] }),
    });
    if (!permanent.ok) throw new Error("تعذّر الشوط الدائم");
    expect(permanent.value).toMatchObject({ claimed: 1, sent: 0, failed: 1, retried: 0 });
    rows = await noticeRows();
    expect(rows[0]?.status).toBe("failed");
    // كودُ الإخفاق محفوظٌ كما جاء: بلا كودٍ لا يعرف الدعمُ لماذا لم تصل الرسالة.
    expect(rows[0]?.error_code).toBe("403:blocked");

    // ولا شوطَ بعده يحجزه: الفاشلُ نهايةٌ لا انتظار.
    await sql`update notification_outbox set next_attempt_at = now() - interval '1 second'
              where kind = 'subscription_notice'`;
    const after = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!after.ok) throw new Error("تعذّر الشوط الأخير");
    expect(after.value.claimed).toBe(0);
  });

  it("المستخدمُ المحجوب لا يُشعَر أصلاً", async () => {
    await sql`update users set is_blocked = true where id = ${driverUserId}::uuid`;
    await seedSubscription({ status: "active" });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    const result = await expireDue();
    // الاشتراكُ ينتهي فعلاً — الحجبُ يمنع الرسالة لا يمنع سريان الواقعة.
    expect(Number(result.expired_subscriptions)).toBe(1);
    expect((await noticeRows()).length).toBe(0);
  });

  it("رابطُ قروب غير المشتركين يظهر في النصّ حين يضعه المالك", async () => {
    await sql`
      update platform_settings set value = '"https://t.me/+waslah_unsub"'::jsonb
      where key = 'unsubscribed_drivers_group_link' and city_id = ${cityId}::uuid
    `;
    await seedSubscription({ status: "trialing" });
    await sql`
      update subscriptions set trial_ends_at = now() - interval '1 minute' where driver_id = ${driverId}::uuid
    `;
    await expireDue();

    const sent: string[] = [];
    const report = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!report.ok) throw new Error("تعذّر الشوط");
    expect(report.value.sent).toBe(1);
    expect(sent[0]).toContain("https://t.me/+waslah_unsub");
    // ونصُّ التجربة يشرح البابين معاً: الاشتراك، والقروب لمن لا يشترك اليوم.
    expect(sent[0]).toContain("اشتراكي");
  });

  it("بلا رابطٍ مضبوط يُحال السائق إلى الدعم ولا يُرسَل رابطٌ فارغ", async () => {
    await seedSubscription({ status: "trialing" });
    await sql`
      update subscriptions set trial_ends_at = now() - interval '1 minute' where driver_id = ${driverId}::uuid
    `;
    await expireDue();

    const sent: string[] = [];
    const report = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!report.ok) throw new Error("تعذّر الشوط");
    expect(report.value.sent).toBe(1);
    expect(sent[0]).toContain("الدعم");
    expect(sent[0]).not.toContain("https://");
  });

  /**
   * أخطرُ من البثّ: إشعارُ «فُعّل اشتراكك» عالقٌ في `sending` يعني سائقاً دفع
   * ولا يعلم أنّ دفعَه وصل. الحجزُ المتروك — عاملٌ حجز ثمّ مات — كان يبقى كذلك
   * إلى الأبد لأنّ الحجزَ لا يلتقط إلّا `pending`.
   */
  it("الحجزُ المتروك بعد موتِ العامل يُسترجَع فيصل الإشعار", async () => {
    await seedSubscription({ status: "active" });
    await sql`
      update subscriptions set current_period_end = now() - interval '1 minute'
      where driver_id = ${driverId}::uuid
    `;
    await expireDue();

    const abandoned = await notices.claim(cityId);
    if (!abandoned.ok) throw new Error("تعذّر الحجز");
    expect(abandoned.value.length).toBe(1);
    expect((await noticeRows())[0]?.status).toBe("sending");

    // قبل انقضاء المهلة لا يُسحب الصفُّ من عاملٍ قد يكون حيّاً.
    const tooEarly = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent: [] }),
    });
    if (!tooEarly.ok) throw new Error("تعذّر الشوط");
    expect(tooEarly.value.claimed).toBe(0);

    await sql`
      update notification_outbox
         set claimed_at = now() - make_interval(secs => 1200)
       where kind = 'subscription_notice' and status = 'sending'
    `;

    const sent: string[] = [];
    const recovered = await deliverSubscriptionNotices(cityId, {
      notices,
      publisher: fakePublisher({ sent }),
    });
    if (!recovered.ok) throw new Error("تعذّر الشوط");
    expect(recovered.value).toMatchObject({ claimed: 1, sent: 1 });
    expect(sent.length).toBe(1);

    const rows = await sql<{ status: string; attempts: number; claimed_at: Date | null }[]>`
      select status, attempts, claimed_at from notification_outbox
      where kind = 'subscription_notice'
    `;
    expect(rows[0]?.status).toBe("delivered");
    expect(rows[0]?.attempts).toBe(2);
    expect(rows[0]?.claimed_at).toBeNull();
  });

  it("دالّات الإشعارات ممنوعةٌ عن anon وauthenticated", async () => {
    const rows = await sql<{ name: string; role: string }[]>`
      select p.proname name, r.rolname role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as g(rolname)
      join pg_roles r on r.rolname = g.rolname
      where n.nspname = 'public'
        and p.proname in ('enqueue_subscription_notice', 'claim_subscription_notices',
                          'finish_subscription_notice')
        and has_function_privilege(r.rolname, p.oid, 'execute')
    `;
    expect(rows.length).toBe(0);
  });
});
