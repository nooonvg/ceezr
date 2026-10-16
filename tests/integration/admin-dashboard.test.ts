/**
 * الغرض: لوحة الإدارة كاملةً على قاعدة PostgreSQL فعلية: دورة الدخول من طلب
 *   الرمز إلى الجلسة، ثم الصفحات الثماني بواجهة HTTP حقيقية، ثم الأفعال الكتابية
 *   الثلاثة عبر دوالّها الذرّية — وأهمّ من ذلك حدودها: من ليس مسؤولاً لا يصله
 *   رمز، ورمز خاطئ متكرّر يُقفل، وسحب الصفة يُسقط الجلسة في الطلب التالي.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مصادقة اللوحة
 * ملاحظات مستقبلية: عند إضافة صفحة تُضاف إلى قائمة الصفحات المفحوصة هنا.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_MAX_PER_WINDOW,
  type AdminAuthPort,
  createAdminAuthPort,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { createAdminApiRoutes } from "../../apps/gateway/src/routes/admin-api.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSupportResolutionPort } from "../../packages/infrastructure/dispute/support-adapters.ts";
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import { createRatingFlagPort } from "../../packages/infrastructure/reputation/rating-adapters.ts";
import { createTrackingTokenRpc } from "../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import { seedAcceptedDocuments } from "../support/seed-driver-documents.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ADMIN_TELEGRAM = "770001";
const OTHER_TELEGRAM = "770002";
const DRIVER_TELEGRAM = "770003";

let sql: Sql;
let revocationStore: ReturnType<typeof createMemorySessionRevocationStore>;
let auth: AdminAuthPort;
let app: Hono;
let cityId: string;
let cityGroupsId: string;
let adminUserId: string;
let sentCodes: { chatId: string; text: string }[];
/** PD-042: ما طلبَه البابُ من المُوقِّع — المسارُ والمدّة — لا رابطٌ حقيقيّ. */
let signedReads: { objectPath: string; ttlSeconds: number }[];

/** يلتقط الرمز من نصّ الرسالة كما يقرأه المسؤول فعلاً، لا من القاعدة. */
function extractCode(text: string): string {
  const match = text.match(/[0-9]{6}/);
  if (match === null) throw new Error(`لا رمز في الرسالة: ${text}`);
  return match[0];
}

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

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة في الاستجابة");
  const value = header.split(";")[0];
  if (value === undefined) throw new Error("كعكة جلسة بلا قيمة");
  return value;
}

/** دورة دخول كاملة كما يمرّ بها المسؤول: طلب رمز، قراءته، ثم إدخاله. */
async function login(telegramId: string): Promise<string> {
  sentCodes = [];
  const requested = await request("/admin/login/code", {
    method: "POST",
    body: form({ telegram_id: telegramId }),
  });
  const SEE_OTHER = 303;
  expect(requested.status).toBe(SEE_OTHER);
  const delivered = sentCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز");
  const verified = await request("/admin/login/verify", {
    method: "POST",
    body: form({ telegram_id: telegramId, code: extractCode(delivered.text) }),
  });
  expect(verified.status).toBe(SEE_OTHER);
  return cookieFrom(verified);
}

async function csrfFrom(cookie: string, path: string): Promise<string> {
  const page = await request(path, { cookie });
  const html = await page.text();
  const match = html.match(/name="csrf" value="([0-9a-f]{64})"/);
  if (match?.[1] === undefined) throw new Error(`لا رمز CSRF في ${path}`);
  return match[1];
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("لوحة الإدارة على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    const cityGroups = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
    const cityGroupsRecord = cityGroups[0]?.id;
    if (cityGroupsRecord === undefined) throw new Error("لم تُطبَّق هجرة بذر مدينة مكة");
    cityGroupsId = cityGroupsRecord;
    auth = createAdminAuthPort(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    // مكة مخصّصة لاختبارات قروبات المدن كي لا تتداخل مع مدينة جدة التي تستخدمها
    // اختبارات المسارات التشغيلية الأخرى في نفس قاعدة PostgreSQL.
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where id = ${cityGroupsId}
    `;

    const admins = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول النظام', '+966500000001', 'ar', 'admin')
      returning id
    `;
    const created = admins[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء المسؤول");
    adminUserId = created;

    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${OTHER_TELEGRAM}::bigint, 'راكب عادي', '+966500000002', 'ar', 'rider')
    `;

    sentCodes = [];
    signedReads = [];
    // مخزنٌ جديدٌ لكلِّ حالةٍ: عتبةُ حالةٍ سابقةٍ لا تُقرأُ إنفاذاً في هذه.
    revocationStore = createMemorySessionRevocationStore();
    app = new Hono();
    // الأخصّ أولاً: /admin/api قبل /admin كما في index.ts
    app.route("/admin/api", createAdminApiRoutes({ sql, auth }));
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        // أصلٌ واحد يُمرَّر لإثبات أن السياسة تتبع الضبط لا قائمةً مكتوبةً في الموجّه.
        mapOrigins: ["https://tiles.example.org", "https://unpkg.com"],
        codeSender: {
          send: async (chatId, text) => {
            sentCodes.push({ chatId, text });
            return true;
          },
        },
        revocation: revocationStore,
        // `F16-01` — منفذُ تعليمِ التقييمِ: نفسُ منفذِ `/flag` في القروبِ.
        ratingFlags: createRatingFlagPort(sql),
        // `F16-02` — منفذُ الإقفالِ الإداريِّ: نفسُ منفذِ أزرارِ القروبِ.
        disputeResolutions: createSupportResolutionPort(sql),
        // `F16-03` — منفذُ رموزِ التتبُّعِ: نفسُ منفذِ زرِّ الراكبِ.
        trackingTokens: createTrackingTokenRpc(sql),
        // PD-042 — مُوقِّعٌ مزيّفٌ يُسجِّلُ ما طُلِب: الحكمُ في القاعدةِ لا فيه.
        readSigner: {
          signRead: async (input) => {
            signedReads.push({ objectPath: input.objectPath, ttlSeconds: input.ttlSeconds });
            return {
              ok: true,
              value: {
                readUrl: "https://storage.example.org/signed/opaque-token",
                expiresAtEpochMs: Date.now() + input.ttlSeconds * 1000,
              },
            };
          },
        },
      }),
    );
  });

  // -------------------------------------------------------------------------
  // الدخول
  // -------------------------------------------------------------------------

  it("يرسل الرمز إلى محادثة المسؤول وحده ويفتح جلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect(sentCodes[0]?.chatId).toBe(ADMIN_TELEGRAM);
    // الرمز لا يُخزَّن نصّاً: ما في القاعدة بصمة لا يُستدلّ منها عليه
    const stored = await sql<{ code_hash: string }[]>`select code_hash from admin_login_codes`;
    expect(stored[0]?.code_hash).not.toBe(extractCode(sentCodes[0]?.text ?? ""));

    const overview = await request("/admin", { cookie });
    expect(overview.status).toBe(200);
    expect(await overview.text()).toContain("نظرة عامة");
  });

  it("لا يُرسَل رمز لمن ليس مسؤولاً، ولا يُكشف له أنه ليس مسؤولاً", async () => {
    const rejected = await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: OTHER_TELEGRAM }),
    });
    const UNPROCESSABLE = 422;
    expect(rejected.status).toBe(UNPROCESSABLE);
    expect(sentCodes.length).toBe(0);

    const missing = await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: "999999999" }),
    });
    expect(missing.status).toBe(UNPROCESSABLE);
    // نفس نصّ الرفض حرفاً بحرف: من يجرّب معرّفات لا يفرّق بين «غير موجود» و«ليس مسؤولاً»
    const reason = /notice--error">([^<]+)</;
    const first = (await rejected.text()).match(reason)?.[1];
    const second = (await missing.text()).match(reason)?.[1];
    expect(first).toBeDefined();
    expect(second).toBe(first ?? "");
  });

  it("رمز جديد يُبطِل السابق فلا يصلح رمزان معاً", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const first = extractCode(sentCodes[0]?.text ?? "");
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });

    const stale = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(first));
    expect(stale.ok && stale.value.ok).toBe(false);
  });

  it("محاولات خاطئة متتالية تُقفل الرمز ولو أُدخل الصحيح بعدها", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const correct = extractCode(sentCodes[0]?.text ?? "");

    for (let attempt = 0; attempt < ADMIN_CODE_MAX_ATTEMPTS; attempt += 1) {
      const wrong = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex("000000"));
      expect(wrong.ok && wrong.value.ok).toBe(false);
    }

    const late = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(correct));
    expect(late.ok && late.value.ok).toBe(false);
  });

  it("طلب الرمز محدود بعدد في النافذة", async () => {
    for (let index = 0; index < ADMIN_CODE_MAX_PER_WINDOW; index += 1) {
      const allowed = await auth.issueCode(ADMIN_TELEGRAM, sha256Hex(`code-${index}`));
      expect(allowed.ok && allowed.value.ok).toBe(true);
    }
    const blocked = await auth.issueCode(ADMIN_TELEGRAM, sha256Hex("code-extra"));
    expect(blocked.ok && !blocked.value.ok && blocked.value.error).toBe("RATE_LIMITED");
  });

  it("الرمز يُستهلك مرّة واحدة", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const code = extractCode(sentCodes[0]?.text ?? "");
    const first = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(first.ok && first.value.ok).toBe(true);
    const second = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(second.ok && second.value.ok).toBe(false);
  });

  it("بلا كعكة: الصفحة تُحوَّل إلى الدخول والواجهة تُجيب 401", async () => {
    const SEE_OTHER = 303;
    const UNAUTHORIZED = 401;
    const page = await request("/admin/drivers");
    expect(page.status).toBe(SEE_OTHER);
    expect(page.headers.get("location")).toBe("/admin/login");

    const api = await request("/admin/api/overview");
    expect(api.status).toBe(UNAUTHORIZED);
  });

  it("الخروج يُبطل الجلسة فوراً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const SEE_OTHER = 303;
    const csrf = await csrfFrom(cookie, "/admin");
    const out = await request("/admin/logout", { method: "POST", cookie, body: form({ csrf }) });
    expect(out.status).toBe(SEE_OTHER);

    const after = await request("/admin", { cookie });
    expect(after.status).toBe(SEE_OTHER);
  });

  it("سحب صفة المسؤول يُسقط الجلسة في الطلب التالي لا بعد ساعات", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect((await request("/admin", { cookie })).status).toBe(200);

    await sql`update users set role = 'rider' where id = ${adminUserId}`;

    const SEE_OTHER = 303;
    expect((await request("/admin", { cookie })).status).toBe(SEE_OTHER);
  });

  // -------------------------------------------------------------------------
  // الصفحات الثماني
  // -------------------------------------------------------------------------

  it("الصفحات الثماني كلّها تُقدَّم بنجاح لجلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const paths = [
      "/admin",
      "/admin/live-orders",
      "/admin/drivers",
      "/admin/heatmap",
      "/admin/disputes",
      "/admin/ratings",
      "/admin/attendance",
      "/admin/settings",
    ];
    for (const path of paths) {
      const response = await request(path, { cookie });
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
      const html = await response.text();
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("مسؤول النظام");
    }
  });

  it("الصفحات التشغيلية تُعلِن عُمرَ قراءتها ولا تستقصي — وصفحات النماذج بلا شريط قِدَم (UI-6)", async () => {
    const cookie = await login(ADMIN_TELEGRAM);

    // كان طلبٌ أُلغي يبقى معروضاً تحت «طلبات تبحث عن سائق»؛ كان العلاجُ مؤقّتَ
    // إعادةِ تحميل، والمصدرُ الكانونيُّ §9 يحظرُ الاستقصاء. البديل (ADR 0240): ساعةُ
    // القراءةِ معلنةٌ، وشريطُ «قراءةٌ قديمة» يظهرُ بعدَ العتبةِ برابطِ تحديثٍ يدويّ.
    for (const [path, seconds] of [
      ["/admin/live-orders", 20],
      ["/admin", 60],
      ["/admin/recovery", 60],
    ] as const) {
      const html = await (await request(path, { cookie })).text();
      expect(html).not.toContain("location.reload");
      expect(html).not.toContain("setInterval");
      expect(html).toContain(`data-freshness="${seconds}"`);
      expect(html).toContain('data-state="stale"');
      expect(html).toContain(`.stale-reveal{animation-delay:${seconds}s}`);
    }

    // الإعدادات تحمل نماذج: لا شريطَ قِدَمٍ يُشتّت من يكتب، ولا تحديثَ تحت يده.
    const settings = await (await request("/admin/settings", { cookie })).text();
    expect(settings).not.toContain("location.reload");
    expect(settings).not.toContain("data-freshness");
  });

  it("كلُّ نموذجِ كتابةٍ في صفحةِ الاسترداد يحملُ رمزَ CSRF — كان غائباً فيُرفَضُ كلُّ قرار (UI-6)", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const html = await (await request("/admin/recovery", { cookie })).text();
    const forms = html.match(/<form[^>]*method="post"[\s\S]*?<\/form>/g) ?? [];
    for (const form of forms) expect(form).toContain('name="csrf"');
  });

  // -------------------------------------------------------------------------
  // ترويسات الأمن (المرحلة ١٠)
  // -------------------------------------------------------------------------

  it("كل صفحةٍ تحمل سياسةَ أمن محتوىً بـnonce يطابق وسومَها فعلاً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    for (const path of ["/admin", "/admin/live-orders", "/admin/settings", "/admin/payments"]) {
      const res = await request(path, { cookie });
      expect(res.status).toBe(200);
      const csp = res.headers.get("content-security-policy");
      expect(csp).not.toBeNull();
      if (csp === null) continue;

      // المطابقة هي المقصود: nonce في الترويسة لا يوافق ما في الصفحة يعني
      // لوحةً تُرفض وسومُها فيتوقّف البحثُ والتحديث بلا رسالة خطأ ظاهرة.
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeDefined();
      const html = await res.text();
      expect(html).toContain(`<style nonce="${nonce}">`);
      expect(html).toContain(`<script nonce="${nonce}">`);
      // ولا يبقى وسمٌ بلا nonce: واحدٌ منسيّ = وظيفةٌ معطّلةٌ في صفحةٍ واحدة.
      expect(html.split("<script").length - 1).toBe(html.split('<script nonce="').length - 1);
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain("'unsafe-inline'; script-src");
    }
  });

  it("الـnonce يتغيّر في كل طلب: قيمةٌ ثابتة تُخمَّن فتُبطل السياسة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const first = (await request("/admin", { cookie })).headers.get("content-security-policy");
    const second = (await request("/admin", { cookie })).headers.get("content-security-policy");
    expect(first).not.toBe(second);
  });

  it("صفحةُ الدخول محميّةٌ كذلك — وهي أضعفُ صفحةٍ إذ تُرسَل فيها كلمةُ المرور الوقتية", async () => {
    const res = await request("/admin/login");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'nonce-");
    const nonce = /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
    expect(await res.text()).toContain(`<style nonce="${nonce}">`);
  });

  it("بقيّةُ الترويسات: تأطيرٌ ممنوع، ولا تخمينَ نوع، ولا مُحيلٌ يُسرِّب المعرّفات", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const res = await request("/admin/drivers", { cookie });
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // مسارات اللوحة تحمل معرّفات سائقين في الرابط؛ إرسالُها في `Referer` إلى
    // مضيف بلاطاتٍ خارجي تسريبُ بيانات لا مجرّد ضعفٍ نظري.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("permissions-policy")).toContain("geolocation=()");
  });

  it("لا سمةَ حدثٍ داخلية في أي صفحة: السياسة لا تُجيزها فتتوقّف الوظيفة صامتةً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    for (const path of ["/admin", "/admin/payments", "/admin/heatmap", "/admin/drivers"]) {
      const html = await (await request(path, { cookie })).text();
      for (const attribute of ["onsubmit=", "onclick=", "onchange=", "onload=", "onerror="]) {
        expect(html).not.toContain(attribute);
      }
    }
  });

  it("واجهة JSON تعيد نماذج القراءة نفسها", async () => {
    const cookie = await login(ADMIN_TELEGRAM);

    const overview = await request("/admin/api/overview", { cookie });
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as { ok: boolean; counters: { searchingOrders: number } };
    expect(body.ok).toBe(true);
    expect(typeof body.counters.searchingOrders).toBe("number");

    const orders = await request("/admin/api/live-orders", { cookie });
    expect(((await orders.json()) as { ok: boolean }).ok).toBe(true);

    const cities = await request("/admin/api/cities", { cookie });
    const cityList = (await cities.json()) as { cities: { code: string }[] };
    expect(cityList.cities.map((city) => city.code)).toContain("JED");
  });

  it("البحث الموحَّد يجد شخصاً باسمه وبمعرّف تلغرامه", async () => {
    const cookie = await login(ADMIN_TELEGRAM);

    const byName = await request(`/admin/api/search?q=${encodeURIComponent("راكب")}`, { cookie });
    const named = (await byName.json()) as { groups: { title: string; items: unknown[] }[] };
    expect(named.groups[0]?.items.length).toBeGreaterThan(0);

    const byId = await request(`/admin/api/search?q=${OTHER_TELEGRAM}`, { cookie });
    const found = (await byId.json()) as { groups: { items: { detail: string }[] }[] };
    expect(found.groups[0]?.items[0]?.detail).toContain(OTHER_TELEGRAM);

    const empty = await request("/admin/api/search?q=", { cookie });
    expect(((await empty.json()) as { groups: unknown[] }).groups.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // الأفعال الكتابية
  // -------------------------------------------------------------------------

  async function createDriver(): Promise<{ driverId: string; userId: string }> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${DRIVER_TELEGRAM}::bigint, 'سائق قيد التوثيق', '+966500000003', 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}, 'pending', 'sedan', 'ABC-1234')
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`
      insert into driver_availability (city_id, driver_id, is_available)
      values (${cityId}, ${driverId}, true)
    `;
    return { driverId, userId };
  }

  it("توثيق سائق يُسجَّل في سجلّ التدقيق ويظهر أثره في الصفحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    await seedAcceptedDocuments(sql, cityId, driverId);
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    const SEE_OTHER = 303;
    const response = await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf, status: "verified" }),
    });
    expect(response.status).toBe(SEE_OTHER);

    const rows = await sql<{ verification_status: string }[]>`
      select verification_status::text from drivers where id = ${driverId}
    `;
    expect(rows[0]?.verification_status).toBe("verified");

    const audits = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${driverId}
    `;
    expect(audits.length).toBeGreaterThan(0);
  });

  /** PD-042 · وثيقةٌ مُرسَلةٌ للمراجعةِ كما تتركُها `submit_driver_documents_for_review`. */
  async function submittedDocument(driverId: string): Promise<string> {
    const [type] = await sql<{ t: string }[]>`
      select (driver_required_document_types(${cityId}::uuid))[1]::text as t
    `;
    const docType = type?.t;
    if (docType === undefined) throw new Error("لا نوعَ إلزاميّ");
    await sql`
      insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at)
      values (${cityId}, ${driverId}, ${docType}::driver_document_type, 'under_review',
              ${`drivers/${driverId}/${docType}/front.png`}, current_date + 365, now())
    `;
    return docType;
  }

  it("PD-042: مسؤولٌ بلا منحِ مراجِعٍ لا يفتحُ الوثيقةَ ولا يحكمُ عليها (403 · لا توقيع)", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const docType = await submittedDocument(driverId);

    const FORBIDDEN = 403;
    const view = await request(`/admin/drivers/${driverId}/documents/${docType}`, { cookie });
    expect(view.status).toBe(FORBIDDEN);
    expect(signedReads).toHaveLength(0);

    const csrf = await csrfFrom(cookie, `/admin/drivers/${driverId}`);
    const SEE_OTHER = 303;
    const review = await request(`/admin/drivers/${driverId}/documents/${docType}/review`, {
      method: "POST",
      cookie,
      body: form({ csrf, decision: "accepted" }),
    });
    expect(review.status).toBe(SEE_OTHER);
    expect(review.headers.get("location")).toContain("review=NOT_DOCUMENT_REVIEWER");
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from driver_documents where driver_id = ${driverId}
    `;
    expect(row?.status).toBe("under_review");
  });

  it("PD-042: المراجِعُ الممنوحُ يفتحُ برابطِ دقيقةٍ مدقَّقٍ ويحكمُ بـCSRF، ولا يُوثَّقُ السائقُ تلقائيّاً", async () => {
    const [granted] = await sql<{ result: { ok: boolean } }[]>`
      select admin_set_document_reviewer(${adminUserId}::uuid, ${adminUserId}::uuid, ${cityId}::uuid, true) as result
    `;
    expect(granted?.result.ok).toBe(true);
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const docType = await submittedDocument(driverId);

    const view = await request(`/admin/drivers/${driverId}/documents/${docType}`, { cookie });
    expect(view.status).toBe(200);
    expect(view.headers.get("cache-control") ?? "").toContain("no-store");
    // الصورةُ من أصلِ المخزنِ مسموحةٌ في هذا الردِّ وحدَه، وصفحةُ السائقِ لا تسمحُ بها.
    expect(view.headers.get("content-security-policy") ?? "").toContain(
      "https://storage.example.org",
    );
    const detailPage = await request(`/admin/drivers/${driverId}`, { cookie });
    expect(detailPage.headers.get("content-security-policy") ?? "").not.toContain(
      "storage.example.org",
    );
    expect(signedReads).toEqual([
      { objectPath: `drivers/${driverId}/${docType}/front.png`, ttlSeconds: 60 },
    ]);
    const viewed = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log where action = 'admin.driver_document_viewed'
    `;
    expect(viewed).toHaveLength(1);
    expect(JSON.stringify(viewed)).not.toContain("front.png");
    expect(JSON.stringify(viewed)).not.toContain("opaque-token");

    // بلا CSRF: لا حكم.
    const noCsrf = await request(`/admin/drivers/${driverId}/documents/${docType}/review`, {
      method: "POST",
      cookie,
      body: form({ decision: "accepted" }),
    });
    expect(noCsrf.status).toBe(403);

    const csrf = await csrfFrom(cookie, `/admin/drivers/${driverId}`);
    const incomplete = await request(`/admin/drivers/${driverId}/documents/${docType}/review`, {
      method: "POST",
      cookie,
      body: form({ csrf, decision: "incomplete", note: "الوجه الخلفي مفقود" }),
    });
    expect(incomplete.status).toBe(303);
    expect(incomplete.headers.get("location")).toContain("review=ok");
    const [row] = await sql<{ status: string; reviewed_by: string | null }[]>`
      select status::text as status, reviewed_by from driver_documents where driver_id = ${driverId}
    `;
    expect(row).toEqual({ status: "incomplete", reviewed_by: adminUserId });
    const reviewed = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log where action = 'admin.driver_document_reviewed'
    `;
    expect(JSON.stringify(reviewed)).not.toContain("الوجه الخلفي");
    const [driver] = await sql<{ s: string }[]>`
      select verification_status::text as s from drivers where id = ${driverId}
    `;
    expect(driver?.s).toBe("pending");
  });

  it("سحب التوثيق يُنزل السائق عن الإتاحة في نفس العملية", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf, status: "suspended" }),
    });

    const rows = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(rows[0]?.is_available).toBe(false);
  });

  /**
   * يقرأ قيمة الحقل من الصفحة المعروضة لا يكتبها بنفسه: الاختبار الذي كان هنا
   * يُرسل "1" مباشرة فمرّ سنةً كاملة بينما الزرّ يُرسل "true" ولا يحظر أحداً.
   * الاختبار الذي لا يمرّ بما تُخرجه الصفحة لا يختبر ما تنقره المشغّلة.
   */
  it("القيمة التي يُرسلها زرّ «حظر» في الصفحة نفسها تحظر فعلاً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { userId } = await createDriver();

    const page = await request("/admin/drivers", { cookie });
    const html = await page.text();
    const csrf = html.match(/name="csrf" value="([0-9a-f]{64})"/)?.[1];
    const blocked = html.match(/name="blocked" value="([^"]+)"/)?.[1];
    expect(csrf).toBeDefined();
    expect(blocked).toBeDefined();

    await request(`/admin/users/${userId}/blocked`, {
      method: "POST",
      cookie,
      body: form({ csrf: csrf ?? "", blocked: blocked ?? "" }),
    });

    const users = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${userId}
    `;
    expect(users[0]?.is_blocked).toBe(true);
  });

  it("صفحة تفاصيل السائق تعرض ملفّه، ومعرّف مجهول يُردّ بـ 404", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();

    const found = await request(`/admin/drivers/${driverId}`, { cookie });
    expect(found.status).toBe(200);
    const html = await found.text();
    expect(html).toContain(driverId);
    expect(html).toContain("بيانات التسجيل");

    const NOT_FOUND = 404;
    const missing = await request("/admin/drivers/00000000-0000-4000-8000-000000000000", {
      cookie,
    });
    expect(missing.status).toBe(NOT_FOUND);

    const HTML_UNPROCESSABLE = 422;
    const invalid = await request("/admin/drivers/not-a-uuid", { cookie });
    expect(invalid.status).toBe(HTML_UNPROCESSABLE);
  });

  it("حظر مستخدم يُبطل جلساته ويُنزله عن الإتاحة، والمسؤول لا يحظر نفسه", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId, userId } = await createDriver();
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    await request(`/admin/users/${userId}/blocked`, {
      method: "POST",
      cookie,
      body: form({ csrf, blocked: "1" }),
    });

    const users = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${userId}
    `;
    expect(users[0]?.is_blocked).toBe(true);
    const availability = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(availability[0]?.is_available).toBe(false);

    // حظر النفس مرفوض في القاعدة نفسها: لا اعتماد على إخفاء الزرّ في الواجهة
    await request(`/admin/users/${adminUserId}/blocked`, {
      method: "POST",
      cookie,
      body: form({ csrf, blocked: "1" }),
    });
    const self = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${adminUserId}
    `;
    expect(self[0]?.is_blocked).toBe(false);
    expect((await request("/admin", { cookie })).status).toBe(200);
  });

  it("تعديل إعداد يُغيّر القيمة، ويرفض النوع الخاطئ، ويرفع صفة «مبدئي»", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityId}`);

    // الإعداد مبذور لا مُنشأ في beforeEach، فنُعيده إلى حاله المبدئي
    // كي لا يعتمد الاختبار على أثر تشغيل سابق غيّره.
    await sql`
      update platform_settings set value = '0.01'::jsonb, is_provisional = true
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    const before = await sql<{ is_provisional: boolean }[]>`
      select is_provisional from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(before[0]?.is_provisional).toBe(true);

    await request(`/admin/settings/${cityId}/admin_heatmap_cell_degrees`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: "0.02" }),
    });
    const after = await sql<{ value: number; is_provisional: boolean }[]>`
      select (value #>> '{}')::float8 as value, is_provisional from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(after[0]?.value).toBeCloseTo(0.02);
    expect(after[0]?.is_provisional).toBe(false);

    await request(`/admin/settings/${cityId}/admin_heatmap_cell_degrees`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: '"نصّ لا رقم"' }),
    });
    const unchanged = await sql<{ value: number }[]>`
      select (value #>> '{}')::float8 as value from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(unchanged[0]?.value).toBeCloseTo(0.02);
  });

  /**
   * الإعدادُ النصيّ كان يُرسَل إلى PostgreSQL بـ`::jsonb`، فمن كتب رابطَ القروب
   * كما هو ارتفع استثناءٌ وعادت 500 بلا بيان — وهو أوّلُ ما يُملأ في مدينةٍ
   * جديدة. الآن يُقبل النصُّ بلغته، ويُعرض في الخانة بلا تنصيصٍ يُربك قارئه.
   */
  it("الإعدادُ النصيّ يُحفَظ رابطاً عادياً ويُعرض بلا تنصيص", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityId}`);
    const link = "https://t.me/+waslah_admin_check";

    const saved = await request(`/admin/settings/${cityId}/unsubscribed_drivers_group_link`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: link }),
    });
    expect(saved.status).toBe(303);

    const stored = await sql<{ value: string; is_provisional: boolean }[]>`
      select value #>> '{}' as value, is_provisional from platform_settings
       where city_id = ${cityId} and key = 'unsubscribed_drivers_group_link'
    `;
    expect(stored[0]?.value).toBe(link);
    expect(stored[0]?.is_provisional).toBe(false);

    const page = await (await request(`/admin/settings?city=${cityId}`, { cookie })).text();
    expect(page).toContain(`value="${link}"`);
  });

  /**
   * الرقمُ الفاسد كان يُوجّه المسؤولَ إلى الصفحة كأنّ الحفظَ تمّ. الآن يُبيَّن
   * الرفضُ برمزٍ مفهوم، والقيمةُ القديمة لا تُمَسّ.
   */
  it("القيمةُ المرفوضة تُبيَّن للمسؤول ولا تُغيّر المحفوظ", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityId}`);

    const rejected = await request(`/admin/settings/${cityId}/admin_heatmap_cell_degrees`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: "ليس رقماً" }),
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).toBe("INVALID_NUMBER");
  });

  it("فعل كتابي بلا رمز CSRF مرفوض ولو كانت الجلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const FORBIDDEN = 403;

    const response = await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf: "0".repeat(64), status: "verified" }),
    });
    expect(response.status).toBe(FORBIDDEN);

    const rows = await sql<{ verification_status: string }[]>`
      select verification_status::text from drivers where id = ${driverId}
    `;
    expect(rows[0]?.verification_status).toBe("pending");
  });

  it("حفظ قروبات مدينة من الواجهة يكتب bigint السالب ويُفعّلها مع أثر تدقيق", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);

    const response = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000001",
        escalation_group_id: "-1009000000002",
        unsubscribed_drivers_group_id: "-1009000000003",
      }),
    });
    expect(response.status).toBe(303);

    const rows = await sql<
      {
        is_active: boolean;
        support: string | null;
        escalation: string | null;
        unsubscribed: string | null;
      }[]
    >`
      select is_active, telegram_support_group_id::text as support,
             telegram_escalation_group_id::text as escalation,
             telegram_unsubscribed_drivers_group_id::text as unsubscribed
        from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({
      is_active: true,
      support: "-1009000000001",
      escalation: "-1009000000002",
      unsubscribed: "-1009000000003",
    });
    const audits = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${cityGroupsId}::uuid
    `;
    expect(audits.map((audit) => audit.action)).toContain("admin.city_group_ids_updated");

    // الرابطُ يُضبط صريحاً: `platform_settings` لا تُقتطع بين الاختبارات، فترك
    // قيمته لما سبق يجعل الشارةَ تابعةً لترتيب التشغيل لا للحالة المقصودة.
    await sql`
      select admin_update_setting(${adminUserId}::uuid, ${cityGroupsId}::uuid,
        'unsubscribed_drivers_group_link', ${"https://t.me/+readyCityGroup"}::text)
    `;
    const page = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    const html = await page.text();
    expect(html).toContain("-1009000000001");
    expect(html).toContain("مفعّلة وجاهزة");
    expect(html).toContain("طريقة الحصول على معرّف القروب");
  });

  it("الحفظ الجزئي يبقي المدينة غير مفعّلة ولا يظهرها كمدينة جاهزة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);

    const response = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000101",
        escalation_group_id: "",
        unsubscribed_drivers_group_id: "",
      }),
    });
    expect(response.status).toBe(303);
    const rows = await sql<{ is_active: boolean; support: string | null }[]>`
      select is_active, telegram_support_group_id::text as support from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({ is_active: false, support: "-1009000000101" });

    const page = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    expect(await page.text()).toContain("غير جاهزة: حقول قروبات ناقصة");
  });

  /**
   * معرّفاتُ القروبات الثلاثة كانت وحدَها ما تقيسه الشارة، فمدينةٌ مفعّلةٌ برابطِ
   * قروبٍ فارغٍ تظهر «مفعّلة وجاهزة» — وهي الحالةُ التي يرى فيها السائقُ عند انتهاء
   * تجربته بطاقةً تُحيله إلى قروبٍ بلا مدخل. الشارةُ تُسمّي الناقصَ لا تُخفيه.
   */
  it("رابط قروب غير المشتركين الناقص يظهر في جاهزية المدينة ثم يختفي بحفظه", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    let csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);

    const groups = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(groups.status).toBe(303);

    // الرابطُ مبذورٌ فارغاً بالتصميم: قيمةٌ حقيقيةٌ يملكها فريقُ المدينة لا نحن.
    await sql`
      update platform_settings set value = '""'::jsonb
       where city_id = ${cityGroupsId} and key = 'unsubscribed_drivers_group_link'
    `;

    const before = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    const beforeHtml = await before.text();
    expect(beforeHtml).toContain("مفعّلة؛ رابط قروب غير المشتركين ناقص");
    // الجدولُ يُسمّي الناقصَ في عمودِه أيضاً، لا في شارةِ الحالة وحدها.
    expect(beforeHtml).toContain("رابط القروب");

    csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);
    const saved = await request(`/admin/settings/${cityGroupsId}/unsubscribed_drivers_group_link`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: "https://t.me/+testUnsubscribedGroup" }),
    });
    expect(saved.status).toBe(303);

    const after = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    const afterHtml = await after.text();
    expect(afterHtml).toContain("مفعّلة وجاهزة");
    expect(afterHtml).not.toContain("مفعّلة؛ رابط قروب غير المشتركين ناقص");
    // الرابطُ يُحفظ نصّاً خالصاً لا JSON مُقتبَساً: علامتا التنصيص كانتا ستصلان تلغرام.
    const stored = await sql<{ value: string }[]>`
      select value #>> '{}' as value from platform_settings
       where city_id = ${cityGroupsId} and key = 'unsubscribed_drivers_group_link'
    `;
    expect(stored[0]?.value).toBe("https://t.me/+testUnsubscribedGroup");
  });

  it("يرفض القيم غير الصالحة والمكررة ويحمي حفظ القروبات بـ CSRF والجلسة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);
    const invalid = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "ليس-رقماً",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(invalid.status).toBe(422);

    const duplicate = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000201",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(duplicate.status).toBe(422);

    const csrfRejected = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf: "0".repeat(64),
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(csrfRejected.status).toBe(403);
    const anonymous = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      body: form({
        csrf,
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(anonymous.status).toBe(303);

    const rows = await sql<{ is_active: boolean; support: string | null }[]>`
      select is_active, telegram_support_group_id::text as support from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({ is_active: false, support: null });
  });

  it("الخريطة الحرارية تعدّ الطلب والعرض على شبكة واحدة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();

    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      select ${cityId}, id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    await sql`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                          pickup_label, dropoff_label)
      values (${cityId}, ${riderId}, 'transport', 'searching',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
    `;
    await sql`
      update drivers set last_location = st_point(39.1755, 21.5475)::geography,
                         last_location_at = now()
       where id = ${driverId}
    `;

    const response = await request(`/admin/api/heatmap?city=${cityId}&hours=6`, { cookie });
    const grid = (await response.json()) as { totalDemand: number; totalSupply: number };
    expect(grid.totalDemand).toBe(1);
    expect(grid.totalSupply).toBe(1);

    const page = await request(`/admin/heatmap?city=${cityId}`, { cookie });
    expect(page.status).toBe(200);
  });

  it("ملخّص الحضور يحتسب من بقي متاحاً حتى الآن لا صفراً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    await sql`
      insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
      values (${cityId}, ${driverId}, true, 'bot', now() - interval '2 hours')
    `;

    const page = await request("/admin/attendance", { cookie });
    const html = await page.text();
    expect(html).toContain("سائق قيد التوثيق");
    // ساعتان متّصلتان حتى الآن: لا يجوز أن تُقرأ صفراً لأنه لم يُطفئ بعد
    expect(html).not.toMatch(/سائق قيد التوثيق[\s\S]{0,400}0 ثانية/);
  });

  // -------------------------------------------------------------------------
  // إبطالُ جلساتِ Mini App (SEC-18-ب)
  // -------------------------------------------------------------------------

  /*
   * الترتيبُ هو المقيسُ ههنا: **الإنفاذُ قبلَ التسجيلِ**. فلو سُجِّلَ أوّلاً ثمَّ
   * فشِلَ الإنفاذُ لبقِيَ في السِجلِّ صفٌّ يقولُ ما لم يقعْ — وصفٌّ كاذبٌ أسوأُ
   * من غيابِه. ولذا يُقاسُ في كلِّ رفضٍ أنَّ **العتبةَ لم تُضرَبْ** كما يُقاسُ
   * أنَّ **الأثرَ لم يُكتَبْ**.
   */

  it("إبطالٌ بسببٍ من المعجمِ يضربُ العتبةَ ويكتبُ الأثرَ", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, "/admin/drivers");
    const targets = await sql<{ id: string }[]>`
      select id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
    `;
    const targetId = targets[0]?.id;
    expect(targetId).toBeDefined();
    if (targetId === undefined) return;

    const response = await request(`/admin/users/${targetId}/revoke-sessions`, {
      method: "POST",
      cookie,
      body: form({ csrf, reason: "stolen_device", back: "/admin/drivers" }),
    });
    const SEE_OTHER = 303;
    expect(response.status).toBe(SEE_OTHER);

    // الإنفاذُ: عتبةٌ مضروبةٌ بمُعرِّفِ تيليجرام — وهو مفتاحُ المخزنِ لا `users.id`.
    const epoch = await revocationStore.revokedAtMsForUser(OTHER_TELEGRAM);
    expect(epoch.ok).toBe(true);
    if (!epoch.ok) return;
    expect(epoch.value).not.toBeNull();

    // الأثرُ: صفٌّ واحدٌ بمعناهُ، لا يُستنتَجُ قرارُه من التجاورِ الزمنيِّ.
    const rows = await sql<
      { action: string; entity_id: string; payload: Record<string, unknown> }[]
    >`
      select action, entity_id::text, payload from audit_log
       where action = 'admin.miniapp_sessions_revoked'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe(targetId);
    expect(rows[0]?.payload.reason).toBe("stolen_device");
  });

  it("سببٌ خارجَ المعجمِ يُرفَضُ، ولا عتبةَ ولا أثرَ", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, "/admin/drivers");
    const targets = await sql<{ id: string }[]>`
      select id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
    `;
    const targetId = targets[0]?.id ?? "";

    const response = await request(`/admin/users/${targetId}/revoke-sessions`, {
      method: "POST",
      cookie,
      body: form({ csrf, reason: "just-because" }),
    });
    const UNPROCESSABLE = 422;
    expect(response.status).toBe(UNPROCESSABLE);
    expect(await response.text()).toContain("INVALID_REASON");

    const epoch = await revocationStore.revokedAtMsForUser(OTHER_TELEGRAM);
    expect(epoch.ok && epoch.value).toBeNull();
    const rows = await sql`select 1 from audit_log where action = 'admin.miniapp_sessions_revoked'`;
    expect(rows).toHaveLength(0);
  });

  it("بلا مخزنِ إبطالٍ موصولٍ يُردُّ 503 لا نجاحٌ صامتٌ", async () => {
    /*
     * التبعيَّةُ اختياريَّةٌ في النوعِ كي لا يُكسَرَ بناءُ كلِّ موضعِ تركيبٍ،
     * و**الثقبُ محروسٌ ههنا**: غيابُها يُغلِقُ البابَ ولا يُقالُ «تمَّ».
     */
    const bare = new Hono();
    bare.route(
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
    const previous = app;
    app = bare;
    try {
      const cookie = await login(ADMIN_TELEGRAM);
      const csrf = await csrfFrom(cookie, "/admin/drivers");
      const targets = await sql<{ id: string }[]>`
        select id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      `;
      const response = await request(`/admin/users/${targets[0]?.id ?? ""}/revoke-sessions`, {
        method: "POST",
        cookie,
        body: form({ csrf, reason: "stolen_device" }),
      });
      const UNAVAILABLE = 503;
      expect(response.status).toBe(UNAVAILABLE);
      expect(await response.text()).toContain("SESSION_REVOCATION_NOT_AVAILABLE");
      const rows =
        await sql`select 1 from audit_log where action = 'admin.miniapp_sessions_revoked'`;
      expect(rows).toHaveLength(0);
    } finally {
      app = previous;
    }
  });

  /*
   * `F16-01` — تعليمُ التقييمِ المسيءِ من صفحةِ التقييماتِ: زرٌّ يمرُّ على
   * `flag_rating` فتَحكُمُ القاعدةُ بالدورِ وتكتبُ `audit_log`. المقيسُ ههنا
   * المسارُ كاملًا: الصفحةُ تعرضُ الزرَّ، والـPOST يُعلِّمُ فعلاً، والمعلَّمُ
   * لا يُعرَضُ لهُ زرٌّ ثانٍ.
   */
  it("تعليم تقييم من اللوحة: يُستثنى من المتوسط ويُسجَّل في سجل التدقيق", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, "/admin/ratings");

    // بذرةُ التقييمِ: راكبٌ وسائقٌ وطلبٌ منتهٍ وتقييمٌ منخفضٌ.
    const { driverId, userId: driverUserId } = await createDriver();
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      select ${cityId}, id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status, pickup, dropoff)
      values (${cityId}, ${riderId}, ${driverId}, 'transport', 'completed',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography)
      returning id
    `;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("تعذّر إنشاء الطلب");
    const seeded = await sql<{ id: string }[]>`
      insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id, stars)
      values (${cityId}, ${orderId}, 'rider_to_driver'::rating_direction,
              (select user_id from riders where id = ${riderId}), ${driverUserId}, 1)
      returning id
    `;
    const ratingId = seeded[0]?.id;
    if (ratingId === undefined) throw new Error("تعذّر إنشاء التقييم");

    // الصفحةُ تعرضُ الزرَّ لغيرِ المُعلَّمِ.
    const page = await (await request("/admin/ratings", { cookie })).text();
    expect(page).toContain(`action="/admin/ratings/${ratingId}/flag"`);

    const flagged = await request(`/admin/ratings/${ratingId}/flag`, {
      method: "POST",
      cookie,
      body: form({ csrf }),
    });
    expect(flagged.status).toBe(303);

    const after = await sql<{ is_flagged: boolean }[]>`
      select is_flagged from ratings where id = ${ratingId}::uuid
    `;
    expect(after[0]?.is_flagged).toBe(true);
    const audit = await sql`
      select 1 from audit_log where action = 'rating.flagged' and entity_id = ${ratingId}::uuid
    `;
    expect(audit).toHaveLength(1);

    // والمعلَّمُ لا يُعرَضُ لهُ زرٌّ ثانٍ.
    const pageAfter = await (await request("/admin/ratings", { cookie })).text();
    expect(pageAfter).toContain("مُعلَّم");
    expect(pageAfter).not.toContain(`action="/admin/ratings/${ratingId}/flag"`);
    expect(driverId).toBeDefined();
  });

  it("بلا منفذ تعليم موصول يردّ المسلك 503 لا نجاح صامت", async () => {
    const bare = new Hono();
    bare.route(
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
    const previous = app;
    app = bare;
    try {
      const cookie = await login(ADMIN_TELEGRAM);
      const csrf = await csrfFrom(cookie, "/admin/ratings");
      const response = await request("/admin/ratings/1b2c3d4e-5f60-4a1b-8c2d-9e0f1a2b3c4d/flag", {
        method: "POST",
        cookie,
        body: form({ csrf }),
      });
      expect(response.status).toBe(503);
      const rows = await sql`select 1 from audit_log where action = 'rating.flagged'`;
      expect(rows).toHaveLength(0);
    } finally {
      app = previous;
    }
  });
  /*
   * `F16-02` — الإقفالُ الإداريُّ للتذكرةِ من صفحةِ النزاعاتِ (`close-dispute.ts`
   * الذي كانَ مكتوباً بلا نداءٍ): المسارُ كاملًا — الصفحةُ تعرضُ النموذجَ
   * للمفتوحةِ، والـPOST بسببعٍ مكتوبٍ يُقفِلُ عبرَ `resolve_support_ticket`
   * (reject) فتكتبُ القاعدةُ الحالةَ والحاسمَ والسببَ و`audit_log` — كما في
   * القروبِ سواءً بسواءٍ. والاستلامُ يبقى في القروبِ: هذا قرارٌ لا نقلُ يدٍ.
   */
  it("إقفال تذكرة من اللوحة: مرفوضة بسببع موثّق وحاسم مسجّل في سجل التدقيق", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, "/admin/disputes");

    // بذرةُ التذكرةِ: شكوى مفتوحة من الراكب.
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      select ${cityId}, id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    const tickets = await sql<{ id: string }[]>`
      insert into support_tickets (city_id, rider_id, type, status, message)
      values (${cityId}, ${riderId}, 'app_problem', 'open', 'السائق لم يصل')
      returning id
    `;
    const ticketId = tickets[0]?.id;
    if (ticketId === undefined) throw new Error("تعذّر إنشاء التذكرة");

    // الصفحةُ تعرضُ النموذجَ للمفتوحةِ.
    const page = await (await request("/admin/disputes", { cookie })).text();
    expect(page).toContain(`action="/admin/disputes/${ticketId}/close"`);

    // بلا سببعٍ لا إقفالَ: 422 لا نجاحٌ صامتٌ.
    const noNote = await request(`/admin/disputes/${ticketId}/close`, {
      method: "POST",
      cookie,
      body: form({ csrf, note: "   " }),
    });
    expect(noNote.status).toBe(422);

    const closed = await request(`/admin/disputes/${ticketId}/close`, {
      method: "POST",
      cookie,
      body: form({ csrf, note: "لا استجابة من العميل بعد الانتظار" }),
    });
    expect(closed.status).toBe(303);

    const after = await sql<
      { status: string; resolution: string | null; resolvedBy: string | null }[]
    >`
      select status, resolution,
             (select full_name from users u where u.id = resolved_by_user_id) as "resolvedBy"
      from support_tickets where id = ${ticketId}::uuid
    `;
    expect(after[0]?.status).toBe("rejected");
    expect(after[0]?.resolution).toBe("لا استجابة من العميل بعد الانتظار");
    expect(after[0]?.resolvedBy).toBe("مسؤول النظام");
    const audit = await sql`
      select 1 from audit_log where action = 'support.ticket_reject' and entity_id = ${ticketId}::uuid
    `;
    expect(audit).toHaveLength(1);

    // والمرفوضةُ لا يُعرَضُ لها نموذجٌ ثانٍ.
    const pageAfter = await (await request("/admin/disputes?status=rejected", { cookie })).text();
    expect(pageAfter).not.toContain(`action="/admin/disputes/${ticketId}/close"`);
  });

  it("بلا منفذ إقفال موصول يردّ المسلك 503 لا نجاح صامت", async () => {
    const bare = new Hono();
    bare.route(
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
    const previous = app;
    app = bare;
    try {
      const cookie = await login(ADMIN_TELEGRAM);
      const csrf = await csrfFrom(cookie, "/admin/disputes");
      const response = await request("/admin/disputes/1b2c3d4e-5f60-4a1b-8c2d-9e0f1a2b3c4d/close", {
        method: "POST",
        cookie,
        body: form({ csrf, note: "سبب" }),
      });
      expect(response.status).toBe(503);
      const rows = await sql`select 1 from audit_log where action = 'support.ticket_reject'`;
      expect(rows).toHaveLength(0);
    } finally {
      app = previous;
    }
  });
  /*
   * `F16-03` — قطعُ روابطِ التتبُّعِ منَ اللوحةِ بطلبِ دعمٍ: الإلغاءُ **بالنيابةِ
   * عن مُصدِرِها** — تلغرامُ صاحبِ الطلبِ يُقرأُ منَ القاعدةِ، وملكيّةُ الإلغاءِ
   * تُطابِقُها القاعدةُ في `revoke_order_tracking_tokens` داخلَ عبارةِ الكتابةِ.
   * زرُّ الراكبِ موصولٌ منذُ §4.2 — وهذا مسارُ اللوحةِ. والفعلُ واحدٌ:
   * `revokeOrderTrackingTokens` نفسُها.
   */
  it("قطع روابط تتبع طلب من اللوحة: يُلغي بالنيابة عن صاحبه وإعادة الإلغاء آمنة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, "/admin/live-orders");

    // بذرةُ الطلبِ ورابطِ التتبُّعِ.
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      select ${cityId}, id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    const { driverId } = await createDriver();
    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status, pickup, dropoff)
      values (${cityId}, ${riderId}, ${driverId}, 'transport', 'in_progress',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography)
      returning id
    `;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("تعذّر إنشاء الطلب");
    await sql`
      insert into trip_tracking_tokens (city_id, order_id, token, created_by, expires_at)
      values (${cityId}, ${orderId}, ${"t".repeat(64)}, ${OTHER_TELEGRAM}::bigint,
              now() + interval '1 hour')
    `;

    // الصفحةُ تعرضُ الزرَّ.
    const page = await (await request("/admin/live-orders", { cookie })).text();
    expect(page).toContain(`action="/admin/live-orders/${orderId}/revoke-tracking"`);

    const revoked = await request(`/admin/live-orders/${orderId}/revoke-tracking`, {
      method: "POST",
      cookie,
      body: form({ csrf }),
    });
    expect(revoked.status).toBe(303);

    const after = await sql<{ revoked_at: string | null }[]>`
      select revoked_at from trip_tracking_tokens where order_id = ${orderId}::uuid
    `;
    expect(after[0]?.revoked_at).not.toBeNull();

    // إعادةُ الإلغاءِ آمنةٌ: لا روابطَ ساريةَ فعددُ المُلغاةِ صفرٌ — والردُّ
    // إعادةُ توجيهٍ لا خطأٍ (idempotent).
    const again = await request(`/admin/live-orders/${orderId}/revoke-tracking`, {
      method: "POST",
      cookie,
      body: form({ csrf }),
    });
    expect(again.status).toBe(303);
  });

  it("بلا منفذ تتبع موصول يردّ المسلك 503 لا نجاح صامت", async () => {
    const bare = new Hono();
    bare.route(
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
    const previous = app;
    app = bare;
    try {
      const cookie = await login(ADMIN_TELEGRAM);
      const csrf = await csrfFrom(cookie, "/admin/live-orders");
      const response = await request(
        "/admin/live-orders/1b2c3d4e-5f60-4a1b-8c2d-9e0f1a2b3c4d/revoke-tracking",
        { method: "POST", cookie, body: form({ csrf }) },
      );
      expect(response.status).toBe(503);
    } finally {
      app = previous;
    }
  });
});
