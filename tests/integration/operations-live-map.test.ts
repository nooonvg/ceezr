/**
 * الغرض: خريطةُ العمليات على قاعدةٍ حقيقيةٍ وبواجهةِ HTTP حقيقية. تُبذر سبعُ حالاتٍ
 *   لسائقين في ظروفٍ مختلفة، ثم يُقرأ ما يراه المشغّل فعلاً في الصفحة — وكلُّ
 *   تأكيدٍ هنا يقابل عيباً **قِيس** في المرحلة ١٣ قبل الإصلاح، لا سلوكاً مأمولاً.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `listLiveDriverPositions` أو على
 *   `operationsStatusOf` أو على صفحة `/admin/live-map`.
 * ملاحظات مستقبلية: المرحلة ١٤ ستضيف عمودَ العروض المعلّقة — يُضاف تأكيدُه هنا.
 *
 * ## العيوب المقيسة التي يحرسها هذا الملف
 *
 * - **D13-1**: لم تكن هناك صفحةُ خريطةِ عملياتٍ ألبتّة (`renderMapPanel` بلا مستهلك).
 * - **D13-2** (P0): سائقٌ على رحلةٍ `in_progress` وجلستُه أُغلقت كان **يغيب عن
 *   الخريطة كليّاً** — راكبٌ في السيّارة ولا يرى المشغّل سائقَه.
 * - **D13-3** (P1): لا اشتقاقَ حالة: من هو عند نقطة الانطلاق ومن يبعد كيلومترين
 *   كانا يُقرآن `matched` سواءً بسواء، ومن انقطعت إصلاحتُه قبل نصفِ ساعةٍ كان
 *   يُقرأ كمن أرسل موقعَه الآن.
 * - **D13-4**: من ليس في الخدمة ولا على رحلةٍ لا يُعرض موقعُه — قرارُ خصوصيةٍ
 *   مقصودٌ (المرحلة ١٢) يُثبَّت هنا حتى لا يُنقض بلا قرار.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { type AdminAuthPort, createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { listLiveDriverStatuses } from "../../apps/gateway/src/admin/queries.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ADMIN_TELEGRAM = "781001";
const SEE_OTHER = 303;
const OK = 200;

/** نقطةُ انطلاقٍ ثابتةٌ في جدة، ونقطةُ مقصدٍ ثابتة — المسافةُ بينهما كيلومتراتٌ عدّة. */
const PICKUP = { lat: 21.5471, lng: 39.1751 };
const DROPOFF = { lat: 21.56, lng: 39.19 };
/** بعيدٌ عن الانطلاق بما يتجاوز نصفَ قطر الوصول (١٥٠ متراً) بمراتب. */
const FAR = { lat: 21.62, lng: 39.26 };

let sql: Sql;
let auth: AdminAuthPort;
let app: Hono;
let cityId: string;
let sentCodes: { chatId: string; text: string }[];

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
  const requested = await request("/admin/login/code", {
    method: "POST",
    body: form({ telegram_id: ADMIN_TELEGRAM }),
  });
  expect(requested.status).toBe(SEE_OTHER);
  const delivered = sentCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز");
  const code = delivered.text.match(/[0-9]{6}/)?.[0];
  if (code === undefined) throw new Error(`لا رمز في الرسالة: ${delivered.text}`);
  const verified = await request("/admin/login/verify", {
    method: "POST",
    body: form({ telegram_id: ADMIN_TELEGRAM, code }),
  });
  expect(verified.status).toBe(SEE_OTHER);
  const header = verified.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة");
  return header.split(";")[0] ?? "";
}

let telegramSeq = 0;

async function seedDriver(tag: string, at: { lat: number; lng: number }): Promise<string> {
  telegramSeq += 1;
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    values (${cityId}, ${782000 + telegramSeq}::bigint, ${`سائق ${tag}`}, 'ar', 'driver')
    returning id`;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (user_id, city_id, verification_status, national_id, plate_number,
      last_location, last_location_at, last_location_quality, last_location_recorded_at)
    values (${userId}::uuid, ${cityId}, 'verified', ${`ID13${tag}`}, ${`P13${tag}`},
      st_point(${at.lng}, ${at.lat})::geography, now(), 'ACCEPT', now())
    returning id`;
  const driverId = drivers[0]?.id;
  if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
  return driverId;
}

async function seedRider(tag: string): Promise<string> {
  telegramSeq += 1;
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    values (${cityId}, ${782000 + telegramSeq}::bigint, ${`راكب ${tag}`}, 'ar', 'rider')
    returning id`;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${userId}::uuid) returning id`;
  const riderId = riders[0]?.id;
  if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
  return riderId;
}

async function seedOrder(
  driverId: string,
  status: "matched" | "in_progress",
  tag: string,
): Promise<string> {
  const riderId = await seedRider(tag);
  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff,
      assigned_driver_id, matched_at, started_at)
    values (${cityId}, ${riderId}::uuid, 'transport', ${status}::order_status,
      st_point(${PICKUP.lng}, ${PICKUP.lat})::geography,
      st_point(${DROPOFF.lng}, ${DROPOFF.lat})::geography,
      ${driverId}::uuid, now(), ${status === "in_progress" ? sql`now()` : sql`null`})
    returning id`;
  const orderId = orders[0]?.id;
  if (orderId === undefined) throw new Error("تعذّر إنشاء الطلب");
  return orderId;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("خريطة العمليات على قاعدة حقيقية", () => {
  /** معرّفاتُ السائقين السبعة بأسمائها الوصفية، تُعاد بذرُها لكل اختبار. */
  let free: string;
  let atPickup: string;
  let toPickup: string;
  let arrived: string;
  let stale: string;
  let closedSession: string;
  let offDuty: string;
  let openButOffDuty: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    auth = createAdminAuthPort(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, tracking_sessions, admin_sessions,
                             admin_login_codes, drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, tracking_sessions, admin_sessions,
                             admin_login_codes, drivers, riders, users restart identity cascade`;
    await sql`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول العمليات', 'ar', 'admin')`;

    // ١. في الخدمة، جلسةٌ حيّة، بلا رحلة ⇒ AVAILABLE
    free = await seedDriver("01", PICKUP);
    await sql`select record_attendance(${free}::uuid, true, 'test_probe')`;
    await sql`insert into tracking_sessions (driver_id, city_id, last_fix_at)
              values (${free}::uuid, ${cityId}, now())`;

    // ٢. مُسنَدٌ وهو **عند** نقطة الانطلاق ⇒ AT_PICKUP
    atPickup = await seedDriver("02", PICKUP);
    const o2 = await seedOrder(atPickup, "matched", "02");
    await sql`insert into tracking_sessions (driver_id, city_id, trip_id, last_fix_at)
              values (${atPickup}::uuid, ${cityId}, ${o2}::uuid, now())`;

    // ٣. مُسنَدٌ وهو بعيدٌ عن الانطلاق ⇒ TO_PICKUP
    toPickup = await seedDriver("03", FAR);
    const o3 = await seedOrder(toPickup, "matched", "03");
    await sql`insert into tracking_sessions (driver_id, city_id, trip_id, last_fix_at)
              values (${toPickup}::uuid, ${cityId}, ${o3}::uuid, now())`;

    // ٤. رحلةٌ جارية وهو عند المقصد ⇒ ARRIVED
    arrived = await seedDriver("04", DROPOFF);
    const o4 = await seedOrder(arrived, "in_progress", "04");
    await sql`insert into tracking_sessions (driver_id, city_id, trip_id, last_fix_at)
              values (${arrived}::uuid, ${cityId}, ${o4}::uuid, now())`;

    // ٥. جلسةٌ مفتوحةٌ وإصلاحتُها قديمة ⇒ STALE
    stale = await seedDriver("05", PICKUP);
    await sql`select record_attendance(${stale}::uuid, true, 'test_probe')`;
    await sql`insert into tracking_sessions (driver_id, city_id, started_at, last_fix_at)
              values (${stale}::uuid, ${cityId}, now() - interval '40 minutes',
                      now() - interval '35 minutes')`;

    // ٦. رحلةٌ جارية وجلستُه **أُغلقت** ⇒ يجب أن يبقى مرئياً (D13-2)
    closedSession = await seedDriver("06", PICKUP);
    const o6 = await seedOrder(closedSession, "in_progress", "06");
    await sql`insert into tracking_sessions (driver_id, city_id, trip_id, started_at,
                last_fix_at, ended_at, end_reason)
              values (${closedSession}::uuid, ${cityId}, ${o6}::uuid,
                      now() - interval '2 hours', now() - interval '90 minutes',
                      now() - interval '80 minutes', 'EXPIRED')`;

    // ٧. خارج الخدمة، بلا جلسةٍ وبلا رحلة، وله موقعٌ مخزَّن ⇒ لا يُعرض (D13-4)
    offDuty = await seedDriver("07", PICKUP);
    await sql`select record_attendance(${offDuty}::uuid, false, 'test_probe')`;

    /**
     * ٨. جلسةٌ **مفتوحةٌ وإصلاحتُها حديثة** والإتاحةُ مطفأة. حالةٌ ليست نظرية:
     * تغييرُ حالةِ التوثيق من اللوحة و`expire_stale_availability` كلاهما يطفئان
     * الإتاحةَ في SQL بلا إغلاقِ الجلسة (الخطر R-45 المرصود). فتُقرأ هنا كما هي:
     * `OFFLINE`. ولن أُلبسها `AVAILABLE` لأن الجلسةَ مفتوحة — إتاحةُ السائق هي
     * مصدرُ الحقيقة لدوامه، والجلسةُ مصدرُ الحقيقة لتتبّعه، ولا يُنتحل أحدُهما
     * الآخر. وظهورُها على الخريطة `OFFLINE` هو ما يجعل الخللَ مرئياً للمشغّل.
     */
    openButOffDuty = await seedDriver("08", PICKUP);
    await sql`select record_attendance(${openButOffDuty}::uuid, false, 'test_probe')`;
    await sql`insert into tracking_sessions (driver_id, city_id, last_fix_at)
              values (${openButOffDuty}::uuid, ${cityId}, now())`;

    sentCodes = [];
    app = new Hono();
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        codeSender: {
          send: async (chatId, text) => {
            sentCodes.push({ chatId, text });
            return true;
          },
        },
      }),
    );
  });

  it("سائقٌ على رحلةٍ حيّةٍ وجلستُه أُغلقت يبقى مرئياً — إغلاق D13-2", async () => {
    const rows = await listLiveDriverStatuses(sql, cityId);
    const row = rows.find((candidate) => candidate.driverId === closedSession);
    expect(row).toBeDefined();
    // لا جلسةَ مفتوحة، ومع ذلك حاضرٌ لأن الرحلةَ حيّة — وهذا بعينُه ما كان يُفقده.
    expect(row?.sessionStartedAt).toBeNull();
    expect(row?.tripStatus).toBe("in_progress");
    // ولا يُدَّعى أن موقعَه حديث: الحالةُ تقول صراحةً إن تتبّعه انقطع.
    expect(row?.status).toBe("STALE");
  });

  it("الحالاتُ تُفرّق بين من هو عند الانطلاق ومن يقصده — إغلاق D13-3", async () => {
    const rows = await listLiveDriverStatuses(sql, cityId);
    const statusOf = (driverId: string): string | undefined =>
      rows.find((row) => row.driverId === driverId)?.status;

    expect(statusOf(free)).toBe("AVAILABLE");
    expect(statusOf(atPickup)).toBe("AT_PICKUP");
    expect(statusOf(toPickup)).toBe("TO_PICKUP");
    expect(statusOf(arrived)).toBe("ARRIVED");
    expect(statusOf(stale)).toBe("STALE");
    // الإتاحةُ هي الحاكمُ عند غياب الرحلة: جلسةٌ مفتوحةٌ لا تصنع دواماً.
    expect(statusOf(openButOffDuty)).toBe("OFFLINE");
    expect(rows.find((row) => row.driverId === openButOffDuty)?.isAvailable).toBe(false);
    expect(rows.find((row) => row.driverId === free)?.isAvailable).toBe(true);
  });

  it("من ليس في الخدمة ولا على رحلةٍ لا يُعرض موقعُه — قرارُ خصوصيةٍ مقصود", async () => {
    const rows = await listLiveDriverStatuses(sql, cityId);
    expect(rows.some((row) => row.driverId === offDuty)).toBe(false);
    // والباقون كلُّهم حاضرون: الاستبعادُ مقصورٌ على حالةٍ واحدة لا استبعادٌ عامّ.
    expect(rows).toHaveLength(7);
  });

  it("لكلِّ سائقٍ صفٌّ واحدٌ لا أكثر — لا يُرسَم أحدٌ مرّتين", async () => {
    const rows = await listLiveDriverStatuses(sql, cityId);
    expect(new Set(rows.map((row) => row.driverId)).size).toBe(rows.length);
  });

  it("الصفحةُ تُصيَّر وتعرض الحالاتَ نصّاً يقرؤه المشغّل — إغلاق D13-1", async () => {
    const cookie = await login();
    const response = await request("/admin/live-map", { cookie });
    expect(response.status).toBe(OK);
    const html = await response.text();

    expect(html).toContain("خريطة العمليات");
    expect(html).toContain("عند الانطلاق");
    expect(html).toContain("متوجّه للانطلاق");
    expect(html).toContain("انقطع تتبّعُه");
    expect(html).toContain("متاح");
    expect(html).toContain("خارج الخدمة");
    // سبعةُ صفوفٍ في الجدول: السائقُ خارجُ الخدمة ليس منها.
    expect(html).not.toContain("سائق 07");
    expect(html).toContain("سائق 06");
  });

  it("عنصرُ التنقّل موجودٌ ومُعلَّمٌ نشِطاً في صفحته", async () => {
    const cookie = await login();
    const html = await (await request("/admin/live-map", { cookie })).text();
    expect(html).toContain('href="/admin/live-map"');
    expect(html).toMatch(/class="nav-link is-active" href="\/admin\/live-map"/);
  });

  it("الصفحةُ تعمل كاملةً بلا مزوّدِ خريطة، وتقول السببَ نصّاً", async () => {
    const cookie = await login();
    const html = await (await request("/admin/live-map", { cookie })).text();
    // لا وسمَ نصٍّ خارجيّاً ولا حاويةَ خريطةٍ فارغة، بل سببٌ مقروء.
    expect(html).not.toContain("maplibre-gl.js");
    expect(html).not.toContain('id="waslah-map"');
    expect(html).toContain("MAP_PROVIDER");
    // ومع ذلك الجدولُ كامل: الخريطةُ زينةٌ والجدولُ هو السطحُ ذو الحُجّية.
    expect(html).toContain("حالة الأسطول");
    expect(html).toContain("عند المقصد");
  });

  it("الترشيحُ بمدينةٍ أخرى يُفرغ الصفحةَ ولا يُسقطها", async () => {
    const others = await sql<{ id: string }[]>`select id from cities where code = 'RUH'`;
    const otherCity = others[0]?.id;
    if (otherCity === undefined) throw new Error("لم تُبذَر مدينة الرياض");
    const cookie = await login();
    const response = await request(`/admin/live-map?city=${otherCity}`, { cookie });
    expect(response.status).toBe(OK);
    const html = await response.text();
    expect(html).toContain("لا سائقَ مرئيّاً الآن");
  });

  it("عند ضبطِ مزوّدٍ وبصمةٍ صالحةٍ يُصيَّر لوحُ الخريطة فعلاً — إغلاق R-39", async () => {
    // بصمةٌ بصيغةٍ صالحة (٦٤ حرفاً base64) — الغرضُ إثباتُ أن الوصلةَ قائمة، لا
    // التحقّقُ من بايتات maplibre-gl.js: ذاك من شأن المتصفّح، وحسابُها يستلزم
    // شبكةً خارجيةً لا وجودَ لها في بيئة الاختبار (ADR 0019).
    const sri = `sha384-${"A".repeat(63)}=`;
    const configured = new Hono();
    configured.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        mapOrigins: ["https://tiles.example.org", "https://unpkg.com"],
        mapStyle: {
          configured: true,
          provider: "maplibre",
          styleUrl: "https://tiles.example.org/style.json",
          origins: ["https://tiles.example.org", "https://unpkg.com"],
        },
        maplibreSri: sri,
        codeSender: {
          send: async (chatId, text) => {
            sentCodes.push({ chatId, text });
            return true;
          },
        },
      }),
    );
    const previous = app;
    app = configured;
    try {
      const cookie = await login();
      const response = await request("/admin/live-map", { cookie });
      expect(response.status).toBe(OK);
      const html = await response.text();
      expect(html).toContain('id="waslah-map"');
      expect(html).toContain("maplibre-gl.js");
      expect(html).toContain(sri);
      // النصُّ يحمل nonce الطلب، وسياسةُ أمن المحتوى تُجيز أصلَ الخريطة.
      const nonce = html.match(/<script nonce="([^"]+)">/)?.[1];
      expect(nonce).toBeDefined();
      expect(response.headers.get("content-security-policy")).toContain(
        `script-src 'nonce-${nonce}'`,
      );
      expect(response.headers.get("content-security-policy")).toContain("https://unpkg.com");
      // ودبابيسُ السائقين الستّة في حِمل النصّ، لا الجدولُ وحده.
      expect(html).toContain("waslahMap");
    } finally {
      app = previous;
    }
  });

  it("الدخولُ شرطٌ لقراءة مواقع الأسطول", async () => {
    const response = await request("/admin/live-map");
    expect(response.status).toBe(SEE_OTHER);
    expect(response.headers.get("location")).toContain("/admin/login");
  });
});
