/**
 * الغرض: إثبات أن اقتراح طبقة الذكاء الاصطناعي يصل فعلاً إلى صفحة النزاعات في
 *   لوحة الإدارة — على قاعدة PostgreSQL حقيقية لا على كائن مُتخيَّل. اختبار
 *   الوحدة يُثبت أن الخلية تُرسَم إذا وصلتها البيانات؛ وهذا يُثبت أن الاستعلام
 *   يُوصلها، وأن الربط الجانبي لا يُكرّر التذكرة ولا يُظهر قراراً غير منشور.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على listDisputes أو على جدول القرارات
 * ملاحظات مستقبلية: حين يُعرض سجلّ القرارات كاملاً في صفحة مستقلّة، يُنقل هذا
 *   الاختبار معه ويبقى هنا ما يخصّ عمود النزاعات وحده.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { renderDisputesPage } from "../../apps/admin-dashboard/src/pages/disputes.ts";
import { listDisputes } from "../../apps/gateway/src/admin/queries.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM = "990001";
const LIMIT = 50;

let sql: Sql;
let cityId: string;
let ticketId: string;

/** يُنشئ قراراً على التذكرة الحالية. `published` هو محلّ الاختبار غالباً. */
async function seedDecision(options: {
  traceId: string;
  action: string;
  classification: string;
  confidence: number;
  published: boolean;
}): Promise<void> {
  await sql`
    insert into agent_decisions
      (city_id, trace_id, ticket_id, agent_id, classification,
       recommended_action, confidence, allowed_tool_level, published)
    values
      (${cityId}, ${options.traceId}, ${ticketId}::uuid, 'support_ticket_agent',
       ${options.classification}, ${options.action}, ${options.confidence},
       'SUGGEST', ${options.published})
  `;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبار عرض الاقتراح مُتخطّى: عيّن TEST_DATABASE_URL.");
}

describeIf("ظهور اقتراح الطبقة في صفحة النزاعات", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'TIF'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, support_tickets,
                             riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, support_tickets,
                             riders, users restart identity cascade`;

    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'عميل التذكرة', '+966500000901', 'ar', 'rider')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");

    const riders = await sql<{ id: string }[]>`
      insert into riders (user_id, city_id) values (${userId}::uuid, ${cityId}) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    const tickets = await sql<{ id: string }[]>`
      insert into support_tickets (city_id, rider_id, type, status, message)
      values (${cityId}, ${riderId}::uuid, 'ride_dispute', 'open', 'المبلغ خُصم مرّتين')
      returning id
    `;
    const created = tickets[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء التذكرة");
    ticketId = created;
  });

  it("بلا طبقة مفعّلة: التذكرة تظهر والخلية فارغة ولا تنكسر الصفحة", async () => {
    const rows = await listDisputes(sql, cityId, null, LIMIT);

    expect(rows.length).toBe(1);
    expect(rows[0]?.agentSuggestion).toBeNull();
    expect(rows[0]?.agentClassification).toBeNull();
    expect(rows[0]?.agentConfidence).toBeNull();

    const html = renderDisputesPage({
      now: new Date(),
      csrfToken: "csrf-token",
      rows,
      cities: [],
      cityId,
      status: null,
      openCount: 1,
      claimedCount: 0,
      resolvedDayCount: 0,
      windowHours: 24,
      limit: LIMIT,
    });
    expect(html).toContain("المبلغ خُصم مرّتين");
    expect(html).toContain("اقتراح الطبقة");
  });

  it("اقتراح منشور يصل إلى الصفحة بنصّه وتصنيفه وثقته", async () => {
    await seedDecision({
      traceId: "trace-published-1",
      action: "راجِع سجلّ الدفع ثمّ أعِد المبلغ الزائد",
      classification: "شكوى دفع",
      confidence: 0.82,
      published: true,
    });

    const rows = await listDisputes(sql, cityId, null, LIMIT);
    expect(rows.length).toBe(1);
    expect(rows[0]?.agentSuggestion).toBe("راجِع سجلّ الدفع ثمّ أعِد المبلغ الزائد");
    expect(rows[0]?.agentClassification).toBe("شكوى دفع");
    // numeric(4,3) يعود نصّاً؛ التحويل يجب أن يُنتج رقماً لا NaN
    expect(rows[0]?.agentConfidence).toBeCloseTo(0.82, 3);

    const html = renderDisputesPage({
      now: new Date(),
      csrfToken: "csrf-token",
      rows,
      cities: [],
      cityId,
      status: null,
      openCount: 1,
      claimedCount: 0,
      resolvedDayCount: 0,
      windowHours: 24,
      limit: LIMIT,
    });
    expect(html).toContain("راجِع سجلّ الدفع");
    expect(html).toContain("82%");
  });

  it("قرار غير منشور لا يُعرض: ما لم يره الدعم لا يظهر كأنّه معروض", async () => {
    await seedDecision({
      traceId: "trace-unpublished-1",
      action: "اقتراح لم يُنشر",
      classification: "شكوى دفع",
      confidence: 0.9,
      published: false,
    });

    const rows = await listDisputes(sql, cityId, null, LIMIT);
    expect(rows.length).toBe(1);
    expect(rows[0]?.agentSuggestion).toBeNull();
  });

  it("⚠️ قراران على تذكرة واحدة لا يُكرّرانها، ويُعرض الأحدث وحده", async () => {
    await seedDecision({
      traceId: "trace-old",
      action: "اقتراح قديم",
      classification: "تصنيف قديم",
      confidence: 0.6,
      published: true,
    });
    // إبعاد الأوّل في الزمن كي يكون الترتيب قاطعاً لا رهن دقّة الساعة
    await sql`update agent_decisions set created_at = now() - interval '1 hour'`;
    await seedDecision({
      traceId: "trace-new",
      action: "اقتراح أحدث",
      classification: "تصنيف أحدث",
      confidence: 0.75,
      published: true,
    });

    const rows = await listDisputes(sql, cityId, null, LIMIT);
    // هذا هو بيت القصيد: صفٌّ واحد لا صفّان
    expect(rows.length).toBe(1);
    expect(rows[0]?.agentSuggestion).toBe("اقتراح أحدث");
  });

  it("حذف التذكرة يحذف قرارها فلا يبقى قياس على تذكرة ممحوّة", async () => {
    await seedDecision({
      traceId: "trace-cascade",
      action: "اقتراح",
      classification: "شكوى",
      confidence: 0.7,
      published: true,
    });
    await sql`delete from support_tickets where id = ${ticketId}::uuid`;

    const remaining = await sql<{ id: string }[]>`select id from agent_decisions`;
    expect(remaining.length).toBe(0);
    expect((await listDisputes(sql, cityId, null, LIMIT)).length).toBe(0);
  });
});
