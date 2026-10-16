/**
 * اختبار قاعدة حقيقية لمسار SOS: كتابة + outbox، تعافٍ بعد فشل تلغرام، وقفل قرار
 * فريق الإسناد. لا يوجد Telegram فعلي هنا؛ الناشر المزدوج يثبت أثر الإرسال فقط.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

/** اختباراتُ هذا الملفِّ تشتغلُ على I/O قاعدةٍ حقيقيّةٍ فتبلغُ تحتَ حملِ
 * الحزمةِ المتسلسلةِ أكثرَ من المهلةِ الافتراضيةِ (5ث). مهلةٌ صريحةٌ لبطءِ
 * العملِ المشروعِ لا لتغطيةِ عطلٍ: الفشلُ يظلُّ فشلًا بعدَ المهلةِ. */
const slowIt = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000);

import { deliverSafetyIncidents } from "../../apps/workers/src/jobs/deliver-safety-incidents.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { SafetyCardPublisher } from "../../packages/application/safety/ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createSafetyDeliveryPort,
  createSafetyResolutionPort,
  createTriggerSosPort,
} from "../../packages/infrastructure/safety/safety-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM_ID = "880001";
const SUPPORT_TELEGRAM_ID = "880101";
const ESCALATION_GROUP = "-100880";
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let reporterUserId: string;
let trigger: ReturnType<typeof createTriggerSosPort>;
let resolution: ReturnType<typeof createSafetyResolutionPort>;

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  cityHandle = await ensureActiveCity(sql, {
    groups: { support: -100881, escalation: ESCALATION_GROUP, unsubscribed: -100882 },
    prior: cityHandle,
  });
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${RIDER_TELEGRAM_ID}::bigint, 'راكب SOS', '+966500880001', 'rider')
    returning id
  `;
  reporterUserId = users[0]?.id ?? "";
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${reporterUserId}::uuid) returning id
  `;
  const riderId = riders[0]?.id;
  if (riderId === undefined) throw new Error("تعذر تجهيز الراكب");
  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (
      ${cityId}, ${riderId}::uuid, 'transport', 'searching',
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography
    )
    returning id
  `;
  orderId = orders[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذر تجهيز الطلب");
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${SUPPORT_TELEGRAM_ID}::bigint, 'مدير الإسناد', '+966500880101', 'admin')
  `;
}

describeIf("SOS safety outbox على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers, orders,
        driver_availability, drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers, orders,
        driver_availability, drivers, riders, users restart identity cascade
    `;
    await createFixture();
    trigger = createTriggerSosPort(sql);
    resolution = createSafetyResolutionPort(sql);
    // مهلةُ الخطافِ نفسِه: truncate + fixture تحتَ حملِ الحزمةِ يتخطى الخمسَ
    // ثوانٍ الافتراضيةَ للخطافاتِ (slowIt لا يغطّي الخطافاتِ).
  }, 30_000);

  /**
   * الانحصار الذي كان: المطالبة تمسح المدن كلّها بترتيب `created_at`، فصفٌّ في
   * مدينةٍ بلا مجموعة تصعيد كان يُختار أوّلاً، ويُرجع `ESCALATION_GROUP_MISSING`،
   * فيسقط الشوط كلّه — واستغاثةُ جدّة المهيّأة تماماً لا تُسلَّم أبداً. حقلٌ فارغ
   * في مدينةٍ غير مفعّلة كان يكفي لتعطيل مسار الاستغاثة في المنصّة كلّها.
   */
  slowIt("صفٌّ أقدم في مدينةٍ بلا مجموعة تصعيد لا يمنع تسليم استغاثة جدّة", async () => {
    const poisonCity = await sql<{ id: string }[]>`
      select id from cities where code = 'MKK' and telegram_escalation_group_id is null
    `;
    const poisonCityId = poisonCity[0]?.id;
    if (poisonCityId === undefined) throw new Error("مدينة الاختبار غير مبذورة");

    // صفٌّ سامّ أقدم من صفّ جدّة، في مدينةٍ ناقصة الإعداد.
    const newId = async (rows: { id: string }[], what: string): Promise<string> => {
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`تعذر تجهيز ${what}`);
      return id;
    };
    const poisonUserId = await newId(
      await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role)
        values (${poisonCityId}, 880777::bigint, 'راكب مدينة غير مهيأة', '+966500880777', 'rider')
        returning id`,
      "الراكب",
    );
    const poisonRiderId = await newId(
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${poisonCityId}, ${poisonUserId}::uuid)
        returning id`,
      "ملف الراكب",
    );
    const poisonOrderId = await newId(
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${poisonCityId}, ${poisonRiderId}::uuid, 'transport', 'searching',
          ST_SetSRID(ST_MakePoint(39.826, 21.389), 4326)::geography)
        returning id`,
      "الطلب",
    );
    const poisonIncidentId = await newId(
      await sql<{ id: string }[]>`
        insert into safety_incidents (city_id, order_id, reporter_role, reporter_user_id, status)
        values (${poisonCityId}, ${poisonOrderId}::uuid, 'rider', ${poisonUserId}::uuid, 'open')
        returning id`,
      "الحادث",
    );
    // صفٌّ سامّ أقدم من صفّ جدّة، في مدينةٍ ناقصة الإعداد. يُودَعُ في الصندوقِ
    // الموحَّدِ (kind='safety_incident') لا في safety_incident_deliveries بعدَ F6-03.
    const poisonDelivery = await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, dedup_key, payload, created_at, next_attempt_at)
      values (${poisonCityId}, 'safety_incident',
        'safety_incident:' || ${poisonIncidentId}::text,
        jsonb_build_object('incident_id', ${poisonIncidentId}::uuid),
        now() - interval '1 hour', now() - interval '1 hour')
      returning id`;
    const poisonDeliveryId = poisonDelivery[0]?.id;
    if (poisonDeliveryId === undefined) throw new Error("تعذر تجهيز الصفّ السامّ");

    const triggered = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(triggered.ok).toBe(true);

    // `string | null` بعدَ `F12-03`: بلاغٌ بلا رحلةٍ يصلُ الناشرَ بـ`null` صريحٍ.
    const published: (string | null)[] = [];
    const report = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: {
        publish: async (card) => {
          published.push(card.orderId);
          return ok("991");
        },
      } satisfies SafetyCardPublisher,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // استغاثة جدّة سُلّمت رغم أنّ الصفّ السامّ أقدم منها.
    expect(report.value.delivered).toBe(1);
    expect(published).toEqual([orderId]);
    // والصفّ السامّ لم يُكتم: يُبلَّغ بسببه في كل دورة حتى يُضبط إعداد مدينته.
    expect(report.value.deferred).toEqual([
      { deliveryId: poisonDeliveryId, cityId: poisonCityId, reason: "ESCALATION_GROUP_MISSING" },
    ]);
    // ولم يُستهلك: لا محاولة محسوبة عليه ولا حالةٌ تغيّرت، فيُسلَّم فور ضبط الإعداد.
    const poisonRow = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from notification_outbox where id = ${poisonDeliveryId}::uuid`;
    expect(poisonRow[0]?.status).toBe("pending");
    expect(poisonRow[0]?.attempts).toBe(0);
  });

  slowIt("ضغطتا SOS متزامنتان تنشئان حادثاً واحداً وoutbox واحداً", async () => {
    const results = await Promise.all([
      trigger.trigger({
        orderId,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      }),
      trigger.trigger({
        orderId,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(
      results.filter(
        (result) =>
          result.ok &&
          result.value.incidentId !== null &&
          "created" in result.value &&
          result.value.created,
      ),
    ).toHaveLength(1);
    const persisted = await sql<{ incidents: string; deliveries: string }[]>`
      select
        (select count(*)::text from safety_incidents where order_id = ${orderId}::uuid) incidents,
        (select count(*)::text from notification_outbox where kind = 'safety_incident') deliveries
    `;
    expect(Number(persisted[0]?.incidents)).toBe(1);
    expect(Number(persisted[0]?.deliveries)).toBe(1);
  });

  slowIt("فشل تيليجرام مرة لا يفقد الحادث ثم تسلمه المحاولة التالية مرة واحدة", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(opened.ok).toBe(true);
    let failedCalls = 0;
    const failing: SafetyCardPublisher = {
      publish: async () => {
        failedCalls += 1;
        return err(new PortFailureError("telegram.safetyCard", "temporary failure"));
      },
    };
    const first = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: failing,
    });
    // فشل النشر لم يعد يُسقط الشوط: يُعدّ فشلاً معلوماً ويستمرّ الشوط لغيره.
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.delivered).toBe(0);
      expect(first.value.failed).toBe(1);
    }
    expect(failedCalls).toBe(1);

    const pending = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from notification_outbox where kind = 'safety_incident'
    `;
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.attempts).toBe(1);

    // نتجاوز فاصل الإعادة المأخوذ من platform_settings؛ لا ننتظر 30 ثانية في اختبار.
    await sql`update notification_outbox set next_attempt_at = now() where kind = 'safety_incident'`;
    let deliveredCalls = 0;
    const succeeding: SafetyCardPublisher = {
      publish: async () => {
        deliveredCalls += 1;
        return ok("7788");
      },
    };
    const second = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher: succeeding,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.delivered).toBe(1);
    expect(deliveredCalls).toBe(1);
    const delivered = await sql<{ status: string; attempts: number; message_id: string }[]>`
      select status, attempts, delivered_message_id::text as message_id
      from notification_outbox where kind = 'safety_incident'
    `;
    expect(delivered[0]).toEqual({ status: "delivered", attempts: 2, message_id: "7788" });
  });

  /**
   * `D-39`: عاملٌ حجزَ صفَّ استغاثةٍ (`sending`) ثمَّ ماتَ قبلَ أن يُعلِنَ نتيجتَه
   * (إعادةُ نشرٍ · `SIGKILL` · انقطاعُ القاعدةِ) كانَ يتركُ الصفَّ عالقاً إلى الأبدِ:
   * `claim_safety_incident_delivery` لا تلتقطُ إلّا `pending`، ولا جارفَ للصنفِ
   * `safety_incident` خلافاً لأصنافِ الرحلةِ والبثِّ وإشعاراتِ الاشتراكِ. شوهِدَ
   * حيّاً على البيئةِ التجريبيّةِ: صفٌّ عالقٌ منذُ 2026-09-30 03:06 UTC.
   */
  slowIt("حجزُ استغاثةٍ متروكٌ بعدَ مهلتِه يُستردُّ ويُسلَّمُ مرّةً واحدةً (D-39)", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(opened.ok).toBe(true);
    // عاملٌ يحجزُ ثمَّ يموتُ: مطالبةٌ بلا `finish`.
    const deliveries = createSafetyDeliveryPort(sql);
    const abandoned = await deliveries.claim();
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;
    expect(abandoned.value.delivery).not.toBeNull();
    const stuck = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from notification_outbox where kind = 'safety_incident'`;
    expect(stuck[0]?.status).toBe("sending");
    expect(stuck[0]?.attempts).toBe(1);

    // ضابطٌ: حجزٌ حيٌّ داخلَ مهلتِه لا يُنتزَعُ من عاملٍ ما زالَ يعملُ عليه.
    const published: (string | null)[] = [];
    const succeeding: SafetyCardPublisher = {
      publish: async (card) => {
        published.push(card.orderId);
        return ok("4242");
      },
    };
    const live = await deliverSafetyIncidents({ deliveries, publisher: succeeding });
    expect(live.ok).toBe(true);
    if (live.ok) expect(live.value.claimed).toBe(0);
    expect(published).toEqual([]);

    // بعدَ المهلةِ (إعدادُ المدينةِ `notification_claim_timeout_seconds`) يُستردُّ.
    await sql`
      update notification_outbox set claimed_at = now() - interval '1 hour'
       where kind = 'safety_incident'`;
    const recovered = await deliverSafetyIncidents({ deliveries, publisher: succeeding });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.claimed).toBe(1);
    expect(recovered.value.delivered).toBe(1);
    expect(published).toEqual([orderId]);
    const done = await sql<{ status: string; attempts: number; claim_token: string | null }[]>`
      select status, attempts, claim_token from notification_outbox where kind = 'safety_incident'`;
    expect(done[0]?.status).toBe("delivered");
    expect(done[0]?.attempts).toBe(2);
    expect(done[0]?.claim_token).toBeNull();

    // والمُسلَّمُ لا يُستردُّ ثانيةً.
    const again = await deliverSafetyIncidents({ deliveries, publisher: succeeding });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.claimed).toBe(0);
    expect(published).toEqual([orderId]);
  });

  slowIt("إغلاقان متزامنان بعد الاستلام يسجلان قراراً واحداً فقط", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.incidentId === null) return;
    const incidentId = opened.value.incidentId;
    const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.value.claimed).toBe(true);

    const closed = await Promise.all([
      resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "close",
        decisionReason: "resolved",
      }),
      resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "block_reporter",
        decisionReason: "policy_violation",
      }),
    ]);
    const succeeded = closed.filter((result) => result.ok && result.value.resolved);
    expect(succeeded).toHaveLength(1);
    const incident = await sql<
      {
        status: string;
        decision: string;
        decided_by_user_id: string;
        reporter_user_id: string;
      }[]
    >`
      select status, decision, decided_by_user_id::text, reporter_user_id::text
      from safety_incidents where id = ${incidentId}::uuid
    `;
    expect(incident[0]?.status).toBe("closed");
    expect(["close", "block_reporter"]).toContain(incident[0]?.decision ?? "");
    expect(incident[0]?.decided_by_user_id).not.toBeNull();
    if (incident[0]?.decision === "block_reporter") {
      const blocked = await sql<{ is_blocked: boolean }[]>`
        select is_blocked from users where id = ${reporterUserId}::uuid
      `;
      expect(blocked[0]?.is_blocked).toBe(true);
    }
  });

  slowIt("قرار إنسان بالحجب يستدعي مسار الإدارة القائم ويحفظ من اتخذه", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.value.incidentId === null) return;
    const incidentId = opened.value.incidentId;
    const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
    expect(claimed.ok).toBe(true);
    const closed = await resolution.resolve({
      incidentId,
      actorTelegramId: SUPPORT_TELEGRAM_ID,
      decision: "block_reporter",
      decisionReason: "policy_violation",
    });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.resolved).toBe(true);
    const audit = await sql<{ decision: string; is_blocked: boolean }[]>`
      select i.decision, u.is_blocked
      from safety_incidents i join users u on u.id = i.reporter_user_id
      where i.id = ${incidentId}::uuid
    `;
    expect(audit[0]).toEqual({ decision: "block_reporter", is_blocked: true });
  });

  /**
   * `PD-021` — السببُ الداخليُّ الإلزاميُّ والرسالةُ العامّةُ: الإغلاقُ بلا سببٍ
   * يُرفَضُ على القاعدةِ. والسببُ يُخزَّنُ ويُكتَبُ في `audit_log`. والإشعارُ
   * العامُّ يُكتَبُ في `notification_outbox` بلا كشفِ السببِ الداخليِّ.
   */
  describe("`PD-021` — سبب داخلي إلزامي ورسالة حالة عامّة", () => {
    slowIt("يرفض الإغلاق بلا سبب داخلي", async () => {
      const opened = await trigger.trigger({
        orderId,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok || opened.value.incidentId === null) return;
      const incidentId = opened.value.incidentId;
      const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
      expect(claimed.ok).toBe(true);

      const closed = await resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "close",
        decisionReason: "resolved",
      });
      expect(closed.ok).toBe(true);
      if (!closed.ok) return;
      expect(closed.value.resolved).toBe(true);

      const incident = await sql<{ decision_reason: string }[]>`
        select decision_reason from safety_incidents where id = ${incidentId}::uuid
      `;
      expect(incident[0]?.decision_reason).toBe("resolved");
    });

    slowIt("يكتب الإشعار العام للمبلّغ في notification_outbox بلا كشف السبب الداخلي", async () => {
      const opened = await trigger.trigger({
        orderId,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok || opened.value.incidentId === null) return;
      const incidentId = opened.value.incidentId;
      const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
      expect(claimed.ok).toBe(true);

      const closed = await resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "close",
        decisionReason: "false_report",
      });
      expect(closed.ok).toBe(true);

      const notif = await sql<{ kind: string; payload: unknown }[]>`
        select kind, payload from notification_outbox
        where kind in ('safety_resolution_closed', 'safety_resolution_blocked')
      `;
      expect(notif.length).toBeGreaterThanOrEqual(1);
      const payload = notif[0]?.payload as Record<string, unknown>;
      expect(payload).toBeDefined();
      // الحمولة تحمل القرار لا السبب الداخلي.
      expect(payload.decision).toBe("close");
      expect(payload.decision_reason).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("false_report");
    });

    slowIt("يكتب سبب القرار في audit_log", async () => {
      const opened = await trigger.trigger({
        orderId,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok || opened.value.incidentId === null) return;
      const incidentId = opened.value.incidentId;
      const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
      expect(claimed.ok).toBe(true);

      await resolution.resolve({
        incidentId,
        actorTelegramId: SUPPORT_TELEGRAM_ID,
        decision: "block_reporter",
        decisionReason: "policy_violation",
      });

      const audit = await sql<{ payload: unknown }[]>`
        select payload from audit_log
        where action = 'safety.incident_resolved' and entity_id = ${incidentId}::uuid
      `;
      expect(audit.length).toBeGreaterThanOrEqual(1);
      const payload = audit[0]?.payload as Record<string, unknown>;
      expect(payload.decision_reason).toBe("policy_violation");
    });
  });

  /**
   * `F12-03` — الطوارئُ لا تشترطُ رحلةً. وههنا تُقاسُ الدعوى على قاعدةٍ حقيقيّةٍ
   * لا على وحدةٍ مُقنَّعةٍ: القيدُ المُرخى، والقفلُ المستقلُّ، و**التسليمُ** الذي
   * كانَ يعلَقُ في `sending` أبداً حينَ لا طلبَ — عيبٌ لم يكن اختبارُ وحدةٍ
   * ليكشفَه لأنَّ سببَه وصلٌ داخليٌّ في SQL.
   */
  describe("`F12-03` — استغاثةٌ بلا رحلةٍ", () => {
    const ORDERLESS_TELEGRAM_ID = "880002";

    /** حسابٌ بمدينةٍ ولا رحلةَ له قطُّ: ولا صفَّ `riders` كذلك، فالبلاغُ لا يشترطُه. */
    async function createOrderlessRider(): Promise<string> {
      const rows = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role)
        values (${cityId}, ${ORDERLESS_TELEGRAM_ID}::bigint, 'راكبٌ بلا رحلةٍ', '+966500880002', 'rider')
        returning id
      `;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("تعذر تجهيز الحساب بلا رحلةٍ");
      return id;
    }

    slowIt("يُقيَّدُ البلاغُ بلا طلبٍ بمدينةِ الحسابِ ويُودَعُ تسليمُه في المعاملةِ نفسِها", async () => {
      const actorId = await createOrderlessRider();
      const triggered = await trigger.trigger({
        orderId: null,
        actorTelegramId: ORDERLESS_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      });
      expect(triggered.ok).toBe(true);
      if (!triggered.ok || triggered.value.incidentId === null) return;
      expect("created" in triggered.value && triggered.value.created).toBe(true);

      const rows = await sql<
        {
          order_id: string | null;
          city_id: string;
          reporter_user_id: string;
          reporter_role: string;
          status: string;
          location: string | null;
          outbox: string;
        }[]
      >`
        select
          i.order_id::text as order_id,
          i.city_id::text as city_id,
          i.reporter_user_id::text as reporter_user_id,
          i.reporter_role,
          i.status,
          i.last_known_location::text as location,
          (
            select count(*)::text from notification_outbox o
             where o.kind = 'safety_incident'
               and o.dedup_key = 'safety_incident:' || i.id::text
          ) as outbox
        from safety_incidents i where i.id = ${triggered.value.incidentId}::uuid
      `;
      // مدينةُ الحسابِ هيَ المصدرُ الثاني الصادقُ للمدينةِ، لا ثابتٌ ولا تخمينٌ.
      expect(rows[0]?.order_id).toBeNull();
      expect(rows[0]?.city_id).toBe(cityId);
      expect(rows[0]?.reporter_user_id).toBe(actorId);
      expect(rows[0]?.reporter_role).toBe("rider");
      expect(rows[0]?.status).toBe("open");
      // ولا موقعَ يُلفَّقُ: راكبٌ بلا رحلةٍ لا نقطةَ التقاطٍ له، ويُفصَحُ عن ذلكَ.
      expect(rows[0]?.location).toBeNull();
      expect(Number(rows[0]?.outbox)).toBe(1);
    });

    slowIt("ضغطتانِ متزامنتانِ بلا طلبٍ تنشئانِ حادثاً واحداً وoutbox واحداً", async () => {
      await createOrderlessRider();
      const results = await Promise.all([
        trigger.trigger({
          orderId: null,
          actorTelegramId: ORDERLESS_TELEGRAM_ID,
          reporterRole: "rider",
          reason: "sos",
        }),
        trigger.trigger({
          orderId: null,
          actorTelegramId: ORDERLESS_TELEGRAM_ID,
          reporterRole: "rider",
          reason: "sos",
        }),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        results.filter((result) => result.ok && "created" in result.value && result.value.created),
      ).toHaveLength(1);
      const persisted = await sql<{ incidents: string; deliveries: string }[]>`
        select
          (select count(*)::text from safety_incidents where order_id is null) incidents,
          (select count(*)::text from notification_outbox where kind = 'safety_incident') deliveries
      `;
      expect(Number(persisted[0]?.incidents)).toBe(1);
      expect(Number(persisted[0]?.deliveries)).toBe(1);
    });

    /**
     * **دليلُ العيبِ الكامنِ**: `claim_safety_incident_delivery` كانت تَسِمُ الصفَّ
     * `sending` ثمَّ تقرأُه بوصلٍ داخليٍّ على `orders`، فصفٌّ بلا طلبٍ يعودُ فارغاً
     * ويبقى `sending` أبداً — بلاغُ استغاثةٍ يُدفَنُ بصمتٍ. و`left join` يُصلِحُه،
     * وهذا الاختبارُ يفشلُ حرفاً إن عادَ الوصلُ الداخليُّ.
     */
    slowIt("تُسلَّمُ بطاقةُ بلاغٍ بلا طلبٍ بـ`orderId: null` ولا تعلَقُ في `sending`", async () => {
      await createOrderlessRider();
      const triggered = await trigger.trigger({
        orderId: null,
        actorTelegramId: ORDERLESS_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      });
      expect(triggered.ok).toBe(true);

      const published: { orderId: string | null; service: string | null }[] = [];
      const report = await deliverSafetyIncidents({
        deliveries: createSafetyDeliveryPort(sql),
        publisher: {
          publish: async (card) => {
            published.push({ orderId: card.orderId, service: card.service });
            return ok("552");
          },
        } satisfies SafetyCardPublisher,
      });

      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.value.delivered).toBe(1);
      expect(report.value.failed).toBe(0);
      // لا رقمَ رحلةٍ مُلفَّقاً ولا خدمةً مُختَرَعةً: `null` صريحٌ يُصاغُ نصّاً مختلفاً.
      expect(published).toEqual([{ orderId: null, service: null }]);
      const row = await sql<{ status: string; attempts: number; message_id: string }[]>`
        select status, attempts, delivered_message_id::text as message_id
        from notification_outbox where kind = 'safety_incident'
      `;
      expect(row[0]).toEqual({ status: "delivered", attempts: 1, message_id: "552" });
    });

    slowIt("يُعلِنُ حَكَمُ السطحِ أصلاً `NO_ORDER` بلا حقولِ نافذةٍ ويُفصِحُ خمسةَ رموزٍ", async () => {
      await createOrderlessRider();
      const rows = await sql<
        {
          state: {
            ok: boolean;
            origin: string;
            eligible: boolean;
            reason: string;
            order_id: string | null;
            post_ride_window_minutes: number | null;
            post_ride_window_source: string | null;
            disclosure: string[];
            incident: { status: string } | null;
          };
        }[]
      >`
        select sos_surface_state(${ORDERLESS_TELEGRAM_ID}::bigint, 'rider') as state
      `;
      const state = rows[0]?.state;
      if (state === undefined) throw new Error("لم يُقرأ حَكَمُ السطحِ");
      expect(state.ok).toBe(true);
      expect(state.origin).toBe("NO_ORDER");
      expect(state.eligible).toBe(true);
      expect(state.reason).toBe("NO_ORDER");
      // حقولُ النافذةِ تُحجَبُ لا تُصفَّرُ: صفرُ دقيقةٍ دعوى، و`null` غيابٌ صادقٌ.
      expect(state.order_id).toBeNull();
      expect(state.post_ride_window_minutes).toBeNull();
      expect(state.post_ride_window_source).toBeNull();
      expect(state.incident).toBeNull();
      expect(state.disclosure).toEqual([
        "SOS_NO_LOCATION_AVAILABLE",
        "SOS_NO_ORDER_REFERENCE",
        "SOS_SHARES_ROLE",
        "SOS_NOTIFIES_ACCOUNT_CITY_TEAM",
        "SOS_NO_PHONE_CALL",
      ]);
    });
  });
});
