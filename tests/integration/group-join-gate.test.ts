/**
 * الغرض: بوّابةُ دخولِ قروبِ السائقينَ غيرِ المشتركينَ (`PD-001` · `ADR 0157`) على
 *   قاعدةِ PostgreSQL حقيقيّةٍ: طلبُ الانضمامِ يمرُّ منَ الويبهوكِ كاملًا
 *   (خريطةٌ ← إيداعٌ ← حوارٌ ← بوّابةٌ) ويُحكَمُ فيهِ منَ القاعدةِ — قبولٌ
 *   لسائقٍ موثَّقٍ في مدينةِ القروبِ، ورفضٌ مُسبَّبٌ لغيرِهِ، وإرشادٌ خاصٌّ
 *   لغيرِ المسجَّلِ، ورفضٌ صامتًا لقروبٍ لا تعرفُهُ مدينةٌ.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على بوّابةِ القروبِ.
 * ملاحظات مستقبلية: قياسُ التحويلِ (`PD-001e`) يُثبَتُ ههنا استعلامًا مباشرًا
 *   على `group_memberships` معَ `subscriptions` — لا دالّةَ قراءةٍ عامّةً
 *   تُبنى للاختبارِ وحدهِ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { TelegramGroupGatePort } from "../../packages/application/groups/group-join-gate.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const UNSUB_GROUP = -1003;
const UNKNOWN_GROUP = -1099;
const LINK = "https://t.me/test_driver_bot?start=register";

const config: AppConfig = testConfig({
  port: 3999,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

interface GateCapture {
  readonly approved: string[];
  readonly declined: string[];
  readonly messaged: { chatId: string; text: string }[];
}

/** بوّابةٌ تلتقطُ القرارَ بلا شبكةِ تلغرامَ — والقرارُ نفسُهُ يُنفَّذُ كاملًا. */
function capturingGate(capture: GateCapture): TelegramGroupGatePort {
  return {
    approve: async (group, user) => {
      capture.approved.push(`${group}:${user}`);
      return true;
    },
    decline: async (group, user) => {
      capture.declined.push(`${group}:${user}`);
      return true;
    },
    messageUser: async (chatId, text) => {
      capture.messaged.push({ chatId, text });
      return true;
    },
    registrationLink: async () => LINK,
  };
}

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let capture: GateCapture;
let cityId: string;
let otherCityId: string;
let cityHandle: ActiveCityHandle | undefined;

async function post(bot: string, update: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

let updateIdCounter = 0;
const joinRequest = (group: number, userId: number) => ({
  update_id: ++updateIdCounter,
  chat_join_request: {
    chat: { id: group },
    from: { id: userId, language_code: "ar" },
    user_chat_id: userId,
  },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("بوّابةُ دخولِ قروبِ غيرِ المشتركينَ على قاعدةٍ حقيقيّةٍ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    // مدينةٌ ثانيةٌ لسائقِ خارجِ المدينةِ — تُقرأُ منَ البذرِ لا تُنشأُ ههنا. لا
    // شرطَ تفعيلَ ههنا: البوّابةُ تقرأُ مدينةَ السائقِ لا نشاطَها، والتفعيلُُ
    // يُقيَّمُ حينَ يُطابَقُ طلبٌ — وهوَ خارجُ هذا الاختبارِ.
    const others = await sql<{ id: string }[]>`
      select id from cities where code <> 'JED' order by code limit 1
    `;
    otherCityId = others[0]?.id ?? cityId;
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table group_memberships, unsubscribed_claims,
                             unsubscribed_negotiations, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table group_memberships, unsubscribed_claims,
                             unsubscribed_negotiations, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: UNSUB_GROUP },
      prior: cityHandle,
    });
    driverSent = [];
    capture = { approved: [], declined: [], messaged: [] };
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      driverJoinGate: capturingGate(capture),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("سائقٌ موثَّقٌ في مدينةِ القروبِ: قبولٌ + صفُّ عضويّةٍ بلا سببٍ", async () => {
    const seeded = await seedVerifiedDriver(320_101);
    const response = await post("driver", joinRequest(UNSUB_GROUP, 320_101));
    expect(response.status).toBe(200);
    expect(capture.approved).toEqual([`${UNSUB_GROUP}:320101`]);
    expect(capture.declined).toEqual([]);
    const rows = await sql<
      { status: string; reason: string | null; source: string; first_approved_at: string | null }[]
    >`
      select status, reason, source, first_approved_at from group_memberships
       where driver_id = ${seeded.driverId} and chat_id = ${UNSUB_GROUP}::bigint
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "approved",
      reason: null,
      source: "driver_bot_join_request",
    });
    expect(rows[0]?.first_approved_at).not.toBeNull();
  });

  it("غيرُ المسجَّلِ: رفضٌ + رسالةٌ خاصّةٌ برابطِ التسجيلِ — وصفرُ صفوفَ", async () => {
    const response = await post("driver", joinRequest(UNSUB_GROUP, 320_777));
    expect(response.status).toBe(200);
    expect(capture.declined).toEqual([`${UNSUB_GROUP}:320777`]);
    expect(capture.approved).toEqual([]);
    expect(capture.messaged).toHaveLength(1);
    expect(capture.messaged[0]?.chatId).toBe("320777");
    expect(capture.messaged[0]?.text).toContain(LINK);
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from group_memberships
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it("سائقٌ من مدينةٍ أخرى: رفضٌ بسببِ المدينةِ + صفٌّ مُسبَّبٌ", async () => {
    const seeded = await seedVerifiedDriver(320_102, otherCityId);
    await post("driver", joinRequest(UNSUB_GROUP, 320_102));
    expect(capture.declined).toEqual([`${UNSUB_GROUP}:320102`]);
    const rows = await sql<{ status: string; reason: string }[]>`
      select status, reason from group_memberships where driver_id = ${seeded.driverId}
    `;
    expect(rows[0]).toMatchObject({ status: "declined", reason: "city_mismatch" });
  });

  it("سائقٌ غيرُ موثَّقٍ في مدينتِهِ: رفضٌ بسببِ التوثيقِ + صفٌّ مُسبَّبٌ", async () => {
    const seeded = await seedVerifiedDriver(320_103);
    await sql`update drivers set verification_status = 'pending' where id = ${seeded.driverId}`;
    await post("driver", joinRequest(UNSUB_GROUP, 320_103));
    expect(capture.declined).toEqual([`${UNSUB_GROUP}:320103`]);
    const rows = await sql<{ status: string; reason: string }[]>`
      select status, reason from group_memberships where driver_id = ${seeded.driverId}
    `;
    expect(rows[0]).toMatchObject({ status: "declined", reason: "driver_not_verified" });
  });

  it("قروبٌ لا تعرفُهُ مدينةٌ: رفضٌ صامتٌ وصفرُ صفوفَ", async () => {
    const response = await post("driver", joinRequest(UNKNOWN_GROUP, 320_104));
    expect(response.status).toBe(200);
    expect(capture.declined).toEqual([`${UNKNOWN_GROUP}:320104`]);
    expect(capture.messaged).toEqual([]);
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from group_memberships
    `;
    expect(rows[0]?.count).toBe(0);
  });

  it("طلبٌ متكرِّرٌ: صفٌّ واحدٌ لا يتغيّرُ أوّلُ طلبِهِ", async () => {
    const seeded = await seedVerifiedDriver(320_105);
    await post("driver", joinRequest(UNSUB_GROUP, 320_105));
    await post("driver", joinRequest(UNSUB_GROUP, 320_105));
    const rows = await sql<
      { count: number; requested_at: string; first_approved_at: string | null }[]
    >`
      select count(*)::int as count, min(requested_at)::text as requested_at,
             min(first_approved_at)::text as first_approved_at
        from group_memberships where driver_id = ${seeded.driverId}
    `;
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.first_approved_at).not.toBeNull();
    // صفٌّ واحدٌ بعدَ طلبَينِ: القيدُ الفريدُ (قروبٍ × سائقٍ) يمنعُ الازدواجَ،
    // وأوّلُ طلبٍ محفوظٌ في `requested_at` لا يُطمَسُ بإعادةِ المحاولةِ.
    const row = await sql<{ requested_at: string }[]>`
      select requested_at::text from group_memberships where driver_id = ${seeded.driverId}
    `;
    expect(new Date(row[0]?.requested_at ?? "").toISOString()).toBe(
      new Date(rows[0]?.requested_at ?? "").toISOString(),
    );
  });

  it("قياسُ التحويلِ (`PD-001e`): العضويّةُ تتّصلُ بالاشتراكِ من داخلِ القاعدةِ", async () => {
    await seedVerifiedDriver(320_106);
    await post("driver", joinRequest(UNSUB_GROUP, 320_106));
    // هذا هو الاستعلامُ الذي يقومُ عليهِ القياسُ: المقامُ صفوفُ العضويّةِ
    // المقبولةُ والبسطُ وصلُها معَ الاشتراكِ الساري — لا جدولَ مؤقّتاتِ ولا
    // دالّةَ قراءةٍ عامّةً تُبنى لغيرِ المستهلكِ.
    const rows = await sql<
      { chat_id: number; driver_id: string; subscription_status: string | null }[]
    >`
      select gm.chat_id, gm.driver_id, s.status::text as subscription_status
        from group_memberships gm
        left join subscriptions s
          on s.driver_id = gm.driver_id and s.status in ('trialing', 'active')
       where gm.status = 'approved' and gm.chat_id = ${UNSUB_GROUP}::bigint
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscription_status).toBe("active");
  });

  it("بوتُ العميلِ يُقرُّ طلبَ انضمامٍ ولا يحكُمُ فيهِ", async () => {
    const response = await post("rider", joinRequest(UNSUB_GROUP, 320_108));
    expect(response.status).toBe(200);
    expect(capture.approved).toEqual([]);
    expect(capture.declined).toEqual([]);
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from group_memberships
    `;
    expect(rows[0]?.count).toBe(0);
  });

  /**
   * سائقٌ موثَّقٌ مشترِكٌ قادرٌ — يُبذَرُ مباشرةً في القاعدةِ (البوّابةُ تقرأُ
   * القاعدةَ لا الحوارَ، فلا يلزمُ أن يمرَّ بالتسجيلِ الحواريِّ).
   */
  async function seedVerifiedDriver(
    telegramId: number,
    driverCityId: string = cityId,
  ): Promise<{ driverId: string }> {
    const userRows = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${driverCityId}, ${telegramId}, ${`سائق البوابة ${telegramId}`}, 'ar', 'driver')
      returning id
    `;
    const userId = userRows[0]?.id;
    if (userId === undefined) throw new Error("تعذّر بذر مستخدم السائق");
    const driverRows = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${driverCityId}, ${userId}, 'verified'::verification_status)
      returning id
    `;
    const driverId = driverRows[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر بذر السائق");
    await sql`
      insert into subscriptions (city_id, driver_id, plan, status)
      values (${driverCityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status)
    `;
    return { driverId };
  }
});
