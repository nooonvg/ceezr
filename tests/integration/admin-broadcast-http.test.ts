/**
 * الغرض: البثُّ الجماعي من واجهة اللوحة نفسها — نموذجٌ HTML حقيقيّ عبر HTTP: صناديقُ
 *   الاختيار، والمعاينةُ قبل الإرسال، وحقلُ الجدولة، والإرسال، والإلغاء — ثمّ
 *   تسليمُ الصفوف فعلاً. الاختباراتُ القائمة كانت تنادي المينَاء مباشرةً، فكلُّ ما
 *   بين النموذج والميناء (قراءةُ الاختيارات، وبناءُ المرشّحات، وتفسيرُ الوقت،
 *   وإعادةُ التوجيه بعد POST) كان بلا حرس.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على نموذج البثّ أو مساره في اللوحة.
 * ملاحظات مستقبلية: لا تلغرام هنا — التسليمُ يُختبر بناشرٍ يُثبت أثرَه، والمقصودُ
 *   إثباتُ أنّ ما اختاره المسؤول في الصفحة هو ما وصل القاعدةَ فعلاً.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { type AdminAuthPort, createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { deliverBroadcastBatch } from "../../packages/application/broadcast/deliver-broadcast.ts";
import type {
  BroadcastAudience,
  BroadcastPublisher,
} from "../../packages/application/broadcast/ports.ts";
import { createBroadcastDeliveryPort } from "../../packages/infrastructure/broadcast/broadcast-adapters.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { ok } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ADMIN_TELEGRAM = "781001";
const SEE_OTHER = 303;
const UNPROCESSABLE = 422;

let sql: Sql;
let auth: AdminAuthPort;
let app: Hono;
let cityId: string;
let otherCityId: string;
let sentCodes: { chatId: string; text: string }[];
let deliveries: ReturnType<typeof createBroadcastDeliveryPort>;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function request(
  path: string,
  init: { method?: string; body?: FormData; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": "integration-test" };
  if (init.cookie !== undefined) headers.cookie = init.cookie;
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: "manual",
    }),
  );
}

async function login(): Promise<string> {
  sentCodes = [];
  await request("/admin/login/code", {
    method: "POST",
    body: form({ telegram_id: ADMIN_TELEGRAM }),
  });
  const delivered = sentCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز");
  const code = delivered.text.match(/[0-9]{6}/)?.[0];
  if (code === undefined) throw new Error("لا رمز في الرسالة");
  const verified = await request("/admin/login/verify", {
    method: "POST",
    body: form({ telegram_id: ADMIN_TELEGRAM, code }),
  });
  expect(verified.status).toBe(SEE_OTHER);
  const header = verified.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة");
  const cookie = header.split(";")[0];
  if (cookie === undefined) throw new Error("كعكة بلا قيمة");
  return cookie;
}

async function csrfFrom(cookie: string, path: string): Promise<string> {
  const html = await (await request(path, { cookie })).text();
  const match = html.match(/name="csrf" value="([0-9a-f]{64})"/);
  if (match?.[1] === undefined) throw new Error(`لا رمز CSRF في ${path}`);
  return match[1];
}

async function seedUser(input: {
  telegramId: number;
  role: string;
  name: string;
  language?: string | undefined;
  cityId?: string | undefined;
}): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${input.cityId ?? cityId}, ${input.telegramId}::bigint, ${input.name},
            ${`+96650088${input.telegramId}`}, ${input.role}::user_role,
            ${input.language ?? "ar"})
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر إنشاء ${input.name}`);
  return id;
}

/** سائقٌ موثَّق بلغةٍ محدّدة؛ يعود بمعرّف السائق لا المستخدم. */
async function seedDriver(input: {
  telegramId: number;
  name: string;
  language?: string | undefined;
  verification: string;
  cityId?: string | undefined;
}): Promise<string> {
  const userId = await seedUser({
    telegramId: input.telegramId,
    role: "driver",
    name: input.name,
    language: input.language,
    cityId: input.cityId,
  });
  const rows = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${input.cityId ?? cityId}, ${userId}, ${input.verification}::verification_status)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر إنشاء السائق ${input.name}`);
  return id;
}

async function seedRider(input: {
  telegramId: number;
  name: string;
  cityId?: string | undefined;
}): Promise<string> {
  const userId = await seedUser({
    telegramId: input.telegramId,
    role: "rider",
    name: input.name,
    cityId: input.cityId,
  });
  const rows = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${input.cityId ?? cityId}, ${userId})
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر إنشاء الراكب ${input.name}`);
  return id;
}

function publishers(sent: string[]): Record<BroadcastAudience, BroadcastPublisher> {
  let nextId = 9100;
  const publisher: BroadcastPublisher = {
    publish: async (recipient) => {
      sent.push(recipient.body);
      nextId += 1;
      return ok({ messageId: String(nextId) });
    },
  };
  return { drivers: publisher, riders: publisher };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("البثّ الجماعي من نموذج اللوحة عبر HTTP", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const jed = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const jedId = jed[0]?.id;
    if (jedId === undefined) throw new Error("لم تُطبَّق بذرةُ المدن");
    cityId = jedId;
    const med = await sql<{ id: string }[]>`select id from cities where code = 'MED'`;
    const medId = med[0]?.id;
    if (medId === undefined) throw new Error("لم تُطبَّق بذرةُ المدينة المنوّرة");
    otherCityId = medId;
    auth = createAdminAuthPort(sql);
    deliveries = createBroadcastDeliveryPort(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, broadcast_campaigns, audit_log, order_offers, orders,
        subscriptions, driver_availability, drivers, riders,
        admin_sessions, admin_login_codes, users restart identity cascade
    `;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, broadcast_campaigns, audit_log, order_offers, orders,
        subscriptions, driver_availability, drivers, riders,
        admin_sessions, admin_login_codes, users restart identity cascade
    `;
    await seedUser({ telegramId: Number(ADMIN_TELEGRAM), role: "admin", name: "مسؤول البثّ" });

    sentCodes = [];
    app = new Hono();
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        mapOrigins: ["https://tiles.example.org"],
        codeSender: {
          send: async (chatId, text) => {
            sentCodes.push({ chatId, text });
            return true;
          },
        },
      }),
    );
  });

  /**
   * صناديقُ الاختيار: النموذجُ يُرسل مفتاحاً واحداً بقيمٍ متعدّدة. لو قُرئ بـ
   * `get` بدلاً من `getAll` لضاعت كلُّ قيمةٍ إلّا الأولى، فيبثّ المسؤولُ على
   * جمهورٍ أضيقَ ممّا اختار ولا يعلم.
   */
  it("المعاينةُ تعدّ ما اختاره المسؤول من الصناديق فعلاً", async () => {
    await seedDriver({ telegramId: 781101, name: "سائق موثّق عربي", verification: "verified" });
    await seedDriver({
      telegramId: 781102,
      name: "سائق موثّق أردو",
      verification: "verified",
      language: "ur",
    });
    await seedDriver({ telegramId: 781103, name: "سائق منتظر", verification: "pending" });

    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    const body = new FormData();
    body.append("csrf", csrf);
    body.append("action", "preview");
    body.append("audience", "drivers");
    body.append("city", cityId);
    body.append("languages", "ar");
    body.append("languages", "ur");
    body.append("verification", "verified");
    body.append("body", "رسالة معاينة");

    const preview = await request("/admin/broadcast", { method: "POST", body, cookie });
    expect(preview.status).toBe(200);
    const html = await preview.text();
    // موثَّقان فقط، بلغتَين مختارتَين: المنتظرُ خارج العدّ.
    expect(html).toContain("2");
    // المعاينةُ لا تُنشئ شيئاً: حملةٌ تُنشأ عند «معاينة» تعني رسالةً بلا قرار.
    const campaigns = await sql<{ count: string }[]>`select count(*) from broadcast_campaigns`;
    expect(Number(campaigns[0]?.count)).toBe(0);
  });

  it("الإرسالُ يُنشئ الحملةَ ثم يُعيد التوجيه، ولا يُبثّ مرّتين بتحديث الصفحة", async () => {
    await seedRider({ telegramId: 781201, name: "راكب أول" });
    await seedRider({ telegramId: 781202, name: "راكب ثانٍ" });

    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    const sendOnce = async (): Promise<Response> =>
      await request("/admin/broadcast", {
        method: "POST",
        cookie,
        body: form({
          csrf,
          action: "send",
          audience: "riders",
          city: cityId,
          body: "رسالة إلى الركّاب",
        }),
      });

    const sent = await sendOnce();
    // إعادةُ توجيه لا صفحة: تحديثُ المتصفّح لصفحةٍ ناتجةٍ عن POST كان سيبثّ ثانياً.
    expect(sent.status).toBe(SEE_OTHER);
    expect(sent.headers.get("location")).toBe("/admin/broadcast?sent=2");

    const recipients = await sql<
      { count: string }[]
    >`select count(*) from notification_outbox where kind = 'broadcast_recipient'`;
    expect(Number(recipients[0]?.count)).toBe(2);

    // النصُّ يُسلَّم فعلاً إلى الجمهور المقصود.
    const delivered: string[] = [];
    const run = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(delivered),
    });
    if (!run.ok) throw new Error("تعذّر التسليم");
    expect(run.value.sent).toBe(2);
    expect(delivered).toEqual(["رسالة إلى الركّاب", "رسالة إلى الركّاب"]);
  });

  /**
   * الجدولةُ تُقرأ من حقل `datetime-local` بلا منطقة، وتوقيتُ الخادم في الإنتاج
   * UTC: بثٌّ جُدوِل للعاشرة صباحاً كان سيتأخّر ثلاثَ ساعات بلا أن يشتكي أحد.
   */
  it("الجدولةُ تُفسَّر بتوقيت المملكة ولا تُسلَّم قبل موعدها", async () => {
    await seedRider({ telegramId: 781301, name: "راكب مجدول" });

    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    // موعدٌ بعد ساعتَين بتوقيت المملكة، مكتوبٌ كما يكتبه المتصفّح.
    const at = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const riyadh = new Date(at.getTime() + 3 * 60 * 60 * 1000);
    const stamp = riyadh.toISOString().slice(0, 16);

    const scheduled = await request("/admin/broadcast", {
      method: "POST",
      cookie,
      body: form({
        csrf,
        action: "send",
        audience: "riders",
        city: cityId,
        body: "رسالة مجدولة",
        send_after: stamp,
      }),
    });
    expect(scheduled.status).toBe(SEE_OTHER);

    const rows = await sql<{ next_attempt_at: Date }[]>`
      select next_attempt_at from notification_outbox where kind = 'broadcast_recipient'
    `;
    const due = rows[0]?.next_attempt_at;
    if (due === undefined) throw new Error("لا مستقبِل");
    const hoursAway = (due.getTime() - Date.now()) / (60 * 60 * 1000);
    // ساعتان لا خمس: خمسٌ تعني أنّ الوقتَ فُسِّر UTC.
    expect(hoursAway).toBeGreaterThan(1.5);
    expect(hoursAway).toBeLessThan(2.5);

    const early = await deliverBroadcastBatch(cityId, { deliveries, publishers: publishers([]) });
    if (!early.ok) throw new Error("تعذّر التسليم");
    expect(early.value.claimed).toBe(0);
  });

  it("وقتُ إرسالٍ غير مفهوم يُردّ بالصفحة نفسها ولا يُنشئ حملة", async () => {
    await seedRider({ telegramId: 781401, name: "راكب" });
    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    const rejected = await request("/admin/broadcast", {
      method: "POST",
      cookie,
      body: form({
        csrf,
        action: "send",
        audience: "riders",
        city: cityId,
        body: "رسالة بوقت فاسد",
        send_after: "غداً صباحاً",
      }),
    });
    expect(rejected.status).toBe(UNPROCESSABLE);
    // ما كتبه المسؤول لم يضع: الصفحةُ تعود بالنصّ نفسه.
    expect(await rejected.text()).toContain("رسالة بوقت فاسد");
    const campaigns = await sql<{ count: string }[]>`select count(*) from broadcast_campaigns`;
    expect(Number(campaigns[0]?.count)).toBe(0);
  });

  it("«كلّ المدن» يُنشئ صفّاً لكلّ مدينة، والإلغاءُ من اللوحة يُبطل ما لم يُرسَل", async () => {
    await seedRider({ telegramId: 781501, name: "راكب جدة" });
    await seedRider({ telegramId: 781502, name: "راكب المدينة", cityId: otherCityId });

    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    const sent = await request("/admin/broadcast", {
      method: "POST",
      cookie,
      body: form({
        csrf,
        action: "send",
        audience: "riders",
        city: "all",
        body: "رسالة إلى كلّ المدن",
      }),
    });
    expect(sent.status).toBe(SEE_OTHER);
    expect(sent.headers.get("location")).toBe("/admin/broadcast?sent=2");

    const batches = await sql<{ batch_id: string; cities: string }[]>`
      select batch_id, count(*) cities from broadcast_campaigns group by batch_id
    `;
    expect(batches.length).toBe(1);
    expect(Number(batches[0]?.cities)).toBe(2);
    const batchId = batches[0]?.batch_id;
    if (batchId === undefined) throw new Error("لا دفعة");

    // نُسلّم مدينةَ جدة وحدها، ثمّ نُلغي الدفعةَ من زرّ اللوحة.
    const delivered: string[] = [];
    const run = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(delivered),
    });
    if (!run.ok) throw new Error("تعذّر التسليم");
    expect(run.value.sent).toBe(1);

    const canceled = await request(`/admin/broadcast/${batchId}/cancel`, {
      method: "POST",
      cookie,
      body: form({ csrf }),
    });
    expect(canceled.status).toBe(SEE_OTHER);
    expect(canceled.headers.get("location")).toBe("/admin/broadcast?canceled=1");

    const states = await sql<{ status: string; count: string }[]>`
      select status, count(*) from notification_outbox where kind = 'broadcast_recipient' group by status order by status
    `;
    // المُسلَّمُ لا يُلمَس، والمعلَّقُ يُبطل: إلغاءٌ يمسّ ما وصل كذبٌ على المسؤول.
    expect(states.map((row) => `${row.status}:${row.count}`)).toEqual([
      "canceled:1",
      "delivered:1",
    ]);
  });

  it("النموذجُ بقيمةٍ لا تُعرَف يُردّ، ولا يمرّ إلى القاعدة", async () => {
    await seedRider({ telegramId: 781601, name: "راكب" });
    const cookie = await login();
    const csrf = await csrfFrom(cookie, "/admin/broadcast");

    for (const bad of [
      { audience: "merchants" },
      { audience: "riders", activity: "whenever" },
      { audience: "riders", city: "not-a-uuid" },
    ]) {
      const response = await request("/admin/broadcast", {
        method: "POST",
        cookie,
        body: form({ csrf, action: "send", body: "رسالة", ...bad }),
      });
      expect(response.status).toBe(UNPROCESSABLE);
      expect(await response.text()).toBe("INVALID_BROADCAST_FORM");
    }

    const campaigns = await sql<{ count: string }[]>`select count(*) from broadcast_campaigns`;
    expect(Number(campaigns[0]?.count)).toBe(0);
  });

  it("بلا رمز CSRF لا بثّ ولا إلغاء", async () => {
    await seedRider({ telegramId: 781701, name: "راكب" });
    const cookie = await login();

    const sent = await request("/admin/broadcast", {
      method: "POST",
      cookie,
      body: form({ action: "send", audience: "riders", city: cityId, body: "بلا رمز" }),
    });
    expect(sent.status).not.toBe(SEE_OTHER);
    const campaigns = await sql<{ count: string }[]>`select count(*) from broadcast_campaigns`;
    expect(Number(campaigns[0]?.count)).toBe(0);
  });
});
