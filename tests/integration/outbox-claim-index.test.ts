/**
 * الغرض: `LOAD-01` (CAP-20261016-CONTINUATION) — انحدارُ عيبِ سعةِ صندوقِ الصادرِ الذي كشفته موجةُ
 *   القبولِ 50 (2026-10-17): `claim_notification_delivery` كانَ يفحصُ الجدولَ
 *   تسلسليًّا (O(N) لكلِّ رسالةٍ) فيتراكمَ الطابورُ (32k معلقًا، أقدمُ مهمةٍ
 *   376ث؛ بروتوكولُ القبولِ P7: ≤ 120ث).
 *
 * ## السبب الجذري (مثبت بخطتين)
 *
 * العيبُ **مزدوجُ الوجهِ** ولا يثبتُ إلّا بخطةِ الدالةِ الفعليةِ:
 *
 * ١. **الوجهُ الأولُ (خطةٌ خاصةٌ):** فهرسُ الأولويةِ الجزئيُّ القديمُ غطّى
 *    قائمةَ أنواعٍ (8) بينما قائمةُ `v_ride_kinds` في الدالةِ صارت 14 نوعًا —
 *    فلا يُثبتُ محمولَ الفهرسِ شرطَ الاستعلامِ.
 * ٢. **الوجهُ الثانيُّ (الأدهى — خطةٌ عامةٌ):** استعلامُ الدالةِ مُعلمٌ
 *    (`kind = any($1)`)، وبعدَ خمسِ تنفيذاتٍ يتحوّلُ plpgsql إلى **خطةٍ عامةٍ**
 *    لا تستطيعُ إثباتَ محمولِ أيِّ فهرسٍ جزئيٍّ يشترطُ قائمةَ أنواعٍ حرفيةٍ —
 *    فيسقطُ الفهرسُ كليًّا ويفحصُ الجدولَ تسلسليًّا في **كلِّ التقاطٍ**
 *    (مُثبَتٌ: `Seq Scan`, ‏198ms عندَ 30 ألفِ صفٍّ معلقٍ). والحلُّ فهرسٌ
 *    بمحمولٍ لا يعتمدُ القائمةَ (`where status = 'pending'` وحدها) تثبتهُ
 *    الخطةُ العامةُ والخاصةُ معًا (مقيسٌ بعدَهُ: ~1ms).
 *
 * ## المدّعى في هذا الاختبار
 *
 * (١) خطةُ استعلامِ الدالةِ **بترميزِهِ العامِّ المعلمِ** (PREPARE + تنفيذاتٌ
 *     كافيةٌ لتحوّلِ المخطِّطِ إلى الخطةِ العامةِ، ثمّ `EXPLAIN EXECUTE`) لا
 *     تفحصُ الجدولَ تسلسليًّا بل يمسحُهُ فهرسُ الأولويةِ في عقدةِ الجدولِ
 *     الخارجيِّ (الاسمُ `n`) تحديدًا.
 * (٢) ترميزُ «نفسِ المستلِمِ» (recipient head-of-line) حاضرٌ في الاستعلامِ
 *     المختبرِ كما في الدالةِ — لا نسخةً مبسّطةً منه — والبياناتُ بأوامرٍ
 *     ومستلمينَ حقيقيينَ متعددينَ لكلِّ أمرٍ.
 * (٣) الدالةُ الفعليةُ `claim_notification_delivery()` تلتقطُ صفًّا من
 *     البياناتِ المزروعةِ فعلاً (لا خروجًا سريعًا فارغًا) وتبقى مقيدةَ الزمنِ
 *     تحتَ التراكمِ المحاكى — بوسيطِ العيناتِ الدافئةِ لا أدناها.
 *
 * الحالة: اختبار تكاملٍ — يتطلب TEST_DATABASE_URL (قاعدة بها الهجراتُ مطبَّقةً
 *   بما فيها `20261017000000_load01_outbox_claim_index.sql`).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: بوابةُ سعةِ صندوقِ الصادرِ في جولاتِ LOAD-01.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  انختارُ انحدارِ فهرسِ صندوقِ الصادرِ مُتخطّى: عيّن TEST_DATABASE_URL.");
}
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

/**
 * حدٌّ معلنٌ مسبقًا على **وسيطِ** العيناتِ الدافئةِ: الفحصُ التسلسليُّ المقيسُ
 * عندَ ~20 ألفِ صفٍّ معلقٍ كانَ ~198ms للاستعلامِ و~230ms للدالةِ؛ والفهرسُ
 * يجعلُها ~1ms. حدٌّ متساهلٌ عمدًا (50ms) يثبتُ العلاقةَ لا زمنًا مطلقًا،
 * بوسيطٍ لا أدنى قيمةٍ — فالأدنى يتغاضى عن ذيولِ التذبذبِ.
 */
const FUNCTION_LATENCY_CEILING_MS = 50;
const SEED_GROUPS = 20; // مجموعة (أمر، مستلم) — لكلٍّ منها رأسُ طابورٍ واحد
const SEED_ROWS_PER_GROUP = 1_000; // ≈ 20 ألف صفٍّ معلقٍ

const RIDE_KINDS = [
  "offer",
  "dispute_resolution",
  "negotiation_turn_opened",
  "negotiation_turn_closed",
  "negotiation_agreed",
  "wider_circle_opened",
  "no_driver_found",
  "order_cancelled",
  "lost_item_report",
  "safety_resolution_closed",
  "safety_resolution_blocked",
  "rider_trip_notice",
  "driver_candidate_notice",
  "order_chat_message",
];

/** الاستعلامُ الحرفيُّ للدالةِ (ترتيبُ المستلِمِ) — يُحوَّلُ إلى PREPARE معلم. */
const CLAIM_SQL = `
select n.* from notification_outbox n
 where n.status = 'pending' and n.next_attempt_at <= now()
   and n.kind = any($1)
   and not exists (
     select 1 from notification_outbox o
      where o.order_id = n.order_id
        and o.recipient_user_id is not distinct from n.recipient_user_id
        and o.status = 'pending' and o.kind = any($1)
        and o.next_attempt_at <= now()
        and (o.created_at, o.id) < (n.created_at, n.id)
   )
 order by notification_kind_priority(n.kind), n.created_at
 for update skip locked limit 1`;

describeIf("LOAD-01 — التزامُ صندوقِ الصادرِ: خطة معلمة عامة بفهرس، لا فحصًا كاملًا", () => {
  let pool: ReturnType<typeof postgres>;
  /** اتصالٌ مخصصٌّ واحدٌ: إعداداتُ الجلسةِ وPREPARE تبقى على اتصالٍ واحدٍ. */
  let dedicated: ReturnType<typeof postgres>;
  /** أوامرُ ومستلمونَ من القاعدةِ نفسِها — لا اصطناعَ مفاتيحَ أجنبيةٍ. */
  let orderIds: string[] = [];
  let recipientIds: string[] = [];

  beforeAll(async () => {
    pool = postgres(DATABASE_URL as string, { max: 4 });
    dedicated = postgres(DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await pool.end({ timeout: 5 });
    await dedicated.end({ timeout: 5 });
  });

  it("خطة عامة معلمة بفهرس الأولوية للجدول الخارجي، والتقاطٌ فعليٌّ مقيدُ الزمن", async () => {
    // بذرٌ: لكلِّ أمرٍ مستلمانِ (راكبٌ وسائقُهُ) × ألفُ رسالةٍ — رؤوسُ طوابيرَ
    // حقيقيةٌ يفرزُها ترميزُ «نفسِ المستلِمِ»، وأعمارٌ متدرجةٌ داخلَ المجموعةِ.
    const seed = async (): Promise<{ headRows: { id: string; kind: string }[] }> => {
      // الأوامرُ والمستلمونَ يُخلقونَ هنا (ببياناتِ اختبارٍ معلَّمةٍ تُمحى بعدَهُ)
      // فلا يعتمدُ الاختبارُ على بياناتٍ سابقةٍ في القاعدةِ.
      await pool`delete from notification_outbox where dedup_key like 'load01-claim-index-%'`;
      const city = await pool`select id from cities where code = 'JED' limit 1`;
      const cityId = city[0]?.id as string;
      expect(cityId).toBeTruthy();
      for (let g = 0; g < SEED_GROUPS; g += 1) {
        const users = await pool`
          insert into users (city_id, role, telegram_id)
          values (${cityId}, 'rider', ${900000000000 + g * 10}),
                 (${cityId}, 'driver', ${900000000001 + g * 10})
          returning id`;
        recipientIds = [...recipientIds, ...users.map((u) => u.id as string)];
        const riderProfile = await pool`
          insert into riders (city_id, user_id) values (${cityId}, ${users[0]?.id}) returning id`;
        const driverProfile = await pool`
          insert into drivers (city_id, user_id) values (${cityId}, ${users[1]?.id}) returning id`;
        const order = await pool`
          insert into orders (city_id, rider_id, service, status, assigned_driver_id, pickup)
          values (${cityId}, ${riderProfile[0]?.id}, 'transport', 'completed',
                  ${driverProfile[0]?.id}, st_setsrid(st_makepoint(39.8, 21.4), 4326))
          returning id`;
        orderIds = [...orderIds, ...order.map((o) => o.id as string)];
      }
      expect(orderIds.length).toBe(SEED_GROUPS);
      for (let g = 0; g < orderIds.length; g += 1) {
        const rider = recipientIds[(g * 2) % recipientIds.length];
        const driver = recipientIds[(g * 2 + 1) % recipientIds.length];
        expect(rider).toBeTruthy();
        expect(driver).toBeTruthy();
        if (rider === undefined || driver === undefined) throw new Error("fixture");
        for (const [recipient, kind] of [
          [rider, "rider_trip_notice"],
          [driver, "order_chat_message"],
        ] as const) {
          const orderId = orderIds[g];
          expect(orderId).toBeTruthy();
          if (orderId === undefined) throw new Error("fixture");
          await pool`
              insert into notification_outbox
                    (city_id, kind, status, next_attempt_at, created_at, payload, dedup_key, recipient_user_id, order_id)
              select (select id from cities where code = 'JED'), ${kind}, 'pending', now(),
                     now() - make_interval(secs => ${SEED_ROWS_PER_GROUP} - g),
                    jsonb_build_object('seed', 'load01-claim-index'),
                    'load01-claim-index-' || ${g} || '-' || ${kind} || '-' || g,
                    ${recipient}::uuid, ${orderId}::uuid
                from generate_series(1, ${SEED_ROWS_PER_GROUP}) g`;
        }
      }
      const headRows = await pool`
          select distinct on (order_id, recipient_user_id) id, kind
            from notification_outbox
           where dedup_key like 'load01-claim-index-%'
           order by order_id, recipient_user_id, created_at, id
        `;
      return { headRows: headRows as unknown as { id: string; kind: string }[] };
    };
    const cleanup = async () => {
      await pool`delete from notification_outbox where dedup_key like 'load01-claim-index-%'`;
      await pool`delete from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id between 900000000000 and 900000999999))`;
      await pool`delete from riders where user_id in (select id from users where telegram_id between 900000000000 and 900000999999)`;
      await pool`delete from drivers where user_id in (select id from users where telegram_id between 900000000000 and 900000999999)`;
      await pool`delete from users where telegram_id between 900000000000 and 900000999999`;
      orderIds = [];
      recipientIds = [];
    };
    try {
      const { headRows } = await seed();
      // إحصاءاتٌ حيّةٌ بعدَ البذرِ: المخطِّطُ يقرأُ الجدولَ الفارغَ قبلَها
      // فيقدّرُ الصفوفِ المعلقةِ بسقفٍ افتراضيٍّ ويختارُ مسحًا خريطةً رخيصًا
      // بدلَ مسيرِ الفهرسِ ذي الأولوية — وذاك يقيّسُ بلايا لا الحدثَ المقصود.
      await pool`analyze notification_outbox`;
      // رؤوسُ الطوابيرِ المتوقعةُ: مجموعةٌ واحدةٌ لكلِّ (أمر، مستلم).
      expect(headRows.length).toBe(orderIds.length * 2);

      // (١) خطةٌ عامةٌ معلمةٌ: PREPARE على الاتصالِ المخصصِ ثمّ خمسُ تنفيذاتٍ
      // لتجاوزِ عتبةِ التحولِ إلى الخطةِ العامةِ (5)، ثمّ EXPLAIN EXECUTE.
      await dedicated.unsafe("set plan_cache_mode = force_generic_plan");
      await dedicated.unsafe(`prepare claim_p(text[]) as ${CLAIM_SQL}`);
      for (let i = 0; i < 5; i += 1) {
        await dedicated.unsafe(`execute claim_p(array['${RIDE_KINDS.join("','")}']::text[])`);
      }
      const explained = (await dedicated.unsafe(
        `explain (format json) execute claim_p(array['${RIDE_KINDS.join("','")}']::text[])`,
      )) as { "QUERY PLAN": unknown }[];
      const nodes: {
        nodeType: string;
        relation: string | null;
        alias: string | null;
        indexName: string | null;
      }[] = [];
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
          return;
        }
        if (value === null || typeof value !== "object") return;
        const node = value as Record<string, unknown>;
        if (typeof node["Node Type"] === "string") {
          nodes.push({
            nodeType: node["Node Type"] as string,
            relation:
              typeof node["Relation Name"] === "string" ? (node["Relation Name"] as string) : null,
            alias: typeof node.Alias === "string" ? (node.Alias as string) : null,
            indexName:
              typeof node["Index Name"] === "string" ? (node["Index Name"] as string) : null,
          });
        }
        const plans = node.Plans;
        if (Array.isArray(plans)) {
          for (const child of plans) walk(child);
        }
        walk(node.Plan);
        walk(node["QUERY PLAN"]);
      };
      walk(explained);
      const onTable = nodes.filter((n) => n.relation === "notification_outbox");
      // لا فحصًا تسلسليًّا للجدولِ في أيةِ عقدةٍ: عينُ الحلقةِ المُنهكةِ للسعةِ.
      expect(onTable.some((n) => n.nodeType === "Seq Scan")).toBe(false);
      // الفهرسُ الجديدُ يخدمُ الجدولَ — والاسمُ يظهرُ في الخطةِ أيا كانَ شكلُ
      // المسحِ المفهرسِ (Index Scan عندَ الاستعلامِ الضيّقِ أو Bitmap Heap Scan عندَ
      // تقديراتٍ أخرى)، فالحراسةُ على الاسمِ في نصِّ الخطةِ وعلى عقدةٍ تحملُهُ.
      const planText = JSON.stringify(explained);
      expect(planText).toContain("notification_outbox_priority_claim_idx2");
      expect(onTable.some((n) => n.indexName === "notification_outbox_priority_claim_idx2")).toBe(
        true,
      );

      // (٣) الدالةُ الفعليةُ: كلُّ نداءٍ يُفحصُ مخرجُهُ — التقاطٌ حقيقيٌّ من
      // البياناتِ المزروعةِ (صفٌّ من رؤوسِ الطوابيرِ) لا خروجًا فارغًا سريعًا.
      const results: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const started = performance.now();
        const claimed = await pool`select claim_notification_delivery() as c`;
        results.push(performance.now() - started);
        const row = (claimed[0]?.c ?? {}) as {
          ok?: boolean;
          backpressure?: string;
          error?: string;
          delivery?: { delivery_id?: string } | null;
        };
        // لا خروجًا سريعًا: كلُّ نداءٍ إمّا التقاطٌ فعليٌّ أو رفضُ ضغطٍ خلفيٍّ
        // صريحٌ — وكلاهما مُثبتٌ هنا لا افتراضٌ صامتٌ.
        expect(row.ok).toBe(true);
        expect(row.backpressure).toBeUndefined();
        if (i === 0) {
          // أولُ التقاطٍ: من رؤوسِ الطوابيرِ المزروعةِ (الأقدمُ في ترتيبِ
          // الأولويةِ) — إثباتُ أنَّ الاستعلامَ المكلفَ جرى فعلًا على بياناتِنا.
          expect(headRows.some((h) => h.id === row.delivery?.delivery_id)).toBe(true);
        }
      }
      // وسيطُ العيناتِ الدافئةِ (الثانيةُ فما بعدَ) — لا أدنى قيمةٍ.
      const warm = results.slice(1).sort((a, b) => a - b);
      const median = warm[Math.floor(warm.length / 2)];
      expect(median).toBeLessThan(FUNCTION_LATENCY_CEILING_MS);
    } finally {
      await cleanup();
    }
  }, 180_000); // بذرُ ~20 ألفِ صفٍّ + PREPARE + ستةُ نداءاتٍ للدالةِ يتجاوزانَ مهلةَ bun (5ث).
});
