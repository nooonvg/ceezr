/**
 * الغرض: تثبيت مسار الهوية وتسجيل الدخول كاملاً على قاعدة PostgreSQL حقيقية،
 *   من منح صفة أول مسؤول عبر grant_bootstrap_admin وحده، مروراً بإصدار الرمز
 *   والتحقّق منه، إلى فتح الجلسة وتمديدها وانتهائها ورفض الوصول بعدها.
 *   هذا الملف مخصَّص للحدود الزمنية والتالفة التي لا يغطّيها
 *   admin-dashboard.test.ts: رمز منتهٍ بالوقت، جلسة منتهية بالوقت، وكعكة
 *   مزوَّرة — وكلها حالات لا تظهر إلا بتلاعب صريح بالوقت في القاعدة.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مصادقة اللوحة
 * ملاحظات مستقبلية: عند إضافة أدوار لوحة أدنى من «مسؤول» تُضاف هنا حالة
 *   «دور أدنى لا يفتح جلسة».
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  ADMIN_SESSION_COOKIE,
  type AdminAuthPort,
  createAdminAuthPort,
  generateSessionToken,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { createAdminApiRoutes } from "../../apps/gateway/src/routes/admin-api.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createBootstrapAdminPort } from "../../packages/infrastructure/identity/bootstrap-admin.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** معرّفات خاصة بهذا الملف وحده كي لا يتداخل مع admin-dashboard.test.ts. */
const ADMIN_TELEGRAM = "880001";
const RIDER_TELEGRAM = "880002";
const BLOCKED_ADMIN_TELEGRAM = "880003";
const UNKNOWN_TELEGRAM = "880999";

const SEE_OTHER = 303;
const UNPROCESSABLE = 422;
const UNAUTHORIZED = 401;
const OK = 200;

let sql: Sql;
let auth: AdminAuthPort;
let app: Hono;
let cityId: string;
let adminUserId: string;
let sentCodes: { chatId: string; text: string }[];

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
  const headers: Record<string, string> = { "user-agent": "identity-test" };
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

/** نصّ الرفض الظاهر للمستخدم — لإثبات أنه رسالة مفهومة لا عطل غامض. */
function noticeOf(html: string): string | null {
  return html.match(/notice--error">([^<]+)</)?.[1] ?? null;
}

async function requestCode(telegramId: string): Promise<Response> {
  return request("/admin/login/code", { method: "POST", body: form({ telegram_id: telegramId }) });
}

async function verify(telegramId: string, code: string): Promise<Response> {
  return request("/admin/login/verify", {
    method: "POST",
    body: form({ telegram_id: telegramId, code }),
  });
}

/** دورة دخول كاملة كما يمرّ بها المسؤول فعلاً. */
async function login(telegramId: string): Promise<string> {
  sentCodes = [];
  expect((await requestCode(telegramId)).status).toBe(SEE_OTHER);
  const delivered = sentCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز");
  const verified = await verify(telegramId, extractCode(delivered.text));
  expect(verified.status).toBe(SEE_OTHER);
  return cookieFrom(verified);
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات الهوية مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

describeIf("الهوية وتسجيل الدخول على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'RUH'`;
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
                             driver_availability, admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;

    const admins = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول الهوية', '+966500000101', 'ar', 'admin')
      returning id
    `;
    const created = admins[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء المسؤول");
    adminUserId = created;

    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكب', '+966500000102', 'ar', 'rider')
    `;
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role, is_blocked)
      values (${cityId}, ${BLOCKED_ADMIN_TELEGRAM}::bigint, 'مسؤول محظور',
              '+966500000103', 'ar', 'admin', true)
    `;

    sentCodes = [];
    app = new Hono();
    app.route("/admin/api", createAdminApiRoutes({ sql, auth }));
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

  // ---------------------------------------------------------------------------
  // 1) أول مسؤول: المسار المقصود وحده
  // ---------------------------------------------------------------------------

  it("لا يصير أول مسؤول إلا عبر grant_bootstrap_admin، ولا يمنح المسار غير المسجَّل شيئاً", async () => {
    const bootstrap = createBootstrapAdminPort(sql);

    // ADR 0212: الدالّةُ القديمةُ باقيةٌ على عقدِها — الغائبُ لا يُرقّى بها ولا يُنشأ.
    const direct = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select grant_bootstrap_admin(${UNKNOWN_TELEGRAM}::bigint) as result
    `;
    expect(direct[0]?.result.ok).toBe(false);
    expect(direct[0]?.result.error).toBe("USER_NOT_FOUND");
    const none = await sql`select 1 from users where telegram_id = ${UNKNOWN_TELEGRAM}::bigint`;
    expect(none.length).toBe(0);

    // راكب مسجَّل يطابق المعرّف المقصود: يُرقّى فعلاً في القاعدة
    const before = await sql<{ role: string }[]>`
      select role from users where telegram_id = ${RIDER_TELEGRAM}::bigint
    `;
    expect(before[0]?.role).toBe("rider");

    const granted = await bootstrap.grant(RIDER_TELEGRAM);
    expect(granted.ok && granted.value).toBe(true);

    const after = await sql<{ role: string }[]>`
      select role from users where telegram_id = ${RIDER_TELEGRAM}::bigint
    `;
    expect(after[0]?.role).toBe("admin");

    const audited = await sql<{ action: string }[]>`
      select action from audit_log where action = 'identity.bootstrap_admin_granted'
    `;
    expect(audited.length).toBe(1);
  });

  it("تكرار الترقية idempotent: لا صفّ تدقيق ثانٍ ولا يُعدّ فشلاً", async () => {
    const bootstrap = createBootstrapAdminPort(sql);
    const first = await bootstrap.grant(RIDER_TELEGRAM);
    expect(first.ok && first.value).toBe(true);

    // الثانية تعيد false لأن «لم يُرقَّ الآن»، لا لأنها فشلت
    const second = await bootstrap.grant(RIDER_TELEGRAM);
    expect(second.ok && second.value).toBe(false);

    const audited = await sql<{ action: string }[]>`
      select action from audit_log where action = 'identity.bootstrap_admin_granted'
    `;
    expect(audited.length).toBe(1);
  });

  it("ADR 0212: المسؤولُ الأوّلُ بلا حسابٍ يُنشَأُ حسابُه مسؤولاً بصفِّ تدقيقٍ واحدٍ ويفتحُ اللوحةَ", async () => {
    // حلقةُ الإقلاعِ: لا مدينةَ مفعَّلةً ⇒ لا تسجيلَ ⇒ لا صفَّ. فالمنفذُ يُنشئُه.
    const bootstrap = createBootstrapAdminPort(sql);
    const provisioned = await bootstrap.grant(UNKNOWN_TELEGRAM);
    expect(provisioned.ok && provisioned.value).toBe(true);

    const rows = await sql<{ role: string; is_blocked: boolean; city_code: string }[]>`
      select u.role, u.is_blocked, c.code as city_code
        from users u join cities c on c.id = u.city_id
       where u.telegram_id = ${UNKNOWN_TELEGRAM}::bigint
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.role).toBe("admin");
    expect(rows[0]?.is_blocked).toBe(false);
    const first = await sql<{ code: string }[]>`select code from cities order by code limit 1`;
    expect(rows[0]?.city_code).toBe(first[0]?.code ?? "");

    // التكرارُ لا يُنشئُ ثانياً ولا يُدقِّقُ ثانياً ولا يُعدُّ فشلاً.
    const again = await bootstrap.grant(UNKNOWN_TELEGRAM);
    expect(again.ok && again.value).toBe(false);
    const audited = await sql<{ payload: { provisioned?: boolean } }[]>`
      select payload from audit_log where action = 'identity.bootstrap_admin_granted'
    `;
    expect(audited.length).toBe(1);
    expect(audited[0]?.payload.provisioned).toBe(true);

    // والحسابُ المُنشأُ يدخلُ اللوحةَ فعلاً — هذا هو المخرجُ من الحلقةِ.
    const cookie = await login(UNKNOWN_TELEGRAM);
    const overview = await request("/admin", { cookie });
    expect(overview.status).toBe(OK);
  });

  it("ADR 0212: الإنشاءُ لا يقعُ من ساحةِ PostgREST — التنفيذُ لـservice_role وحدَه", async () => {
    const grants = await sql<{ grantee: string }[]>`
      select grantee::text from information_schema.routine_privileges
       where routine_name = 'provision_bootstrap_admin' and privilege_type = 'EXECUTE'
    `;
    const grantees = grants.map((g) => g.grantee);
    expect(grantees).not.toContain("anon");
    expect(grantees).not.toContain("authenticated");
    expect(grantees).not.toContain("PUBLIC");
  });

  // ---------------------------------------------------------------------------
  // 2) الهوية: صحيحة وخاطئة
  // ---------------------------------------------------------------------------

  it("هوية صحيحة تُصدر رمزاً إلى محادثتها وحدها وتفتح جلسة تصل للوحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect(sentCodes.length).toBe(1);
    expect(sentCodes[0]?.chatId).toBe(ADMIN_TELEGRAM);

    const overview = await request("/admin", { cookie });
    expect(overview.status).toBe(OK);

    const opened = await sql<{ action: string }[]>`
      select action from audit_log where action = 'admin.session_opened'
    `;
    expect(opened.length).toBe(1);
  });

  it("هوية غير رقمية تُرفض برسالة واضحة قبل لمس القاعدة", async () => {
    const rejected = await requestCode("not-a-number");
    expect(rejected.status).toBe(UNPROCESSABLE);
    expect(sentCodes.length).toBe(0);
    expect(noticeOf(await rejected.text())).toContain("أرقاماً فقط");

    // لم يُنشأ رمز في القاعدة أصلاً
    const codes = await sql<{ id: string }[]>`select id from admin_login_codes`;
    expect(codes.length).toBe(0);
  });

  it("مسؤول محظور لا يُصدَر له رمز ولو كانت صفته admin", async () => {
    const blocked = await auth.issueCode(BLOCKED_ADMIN_TELEGRAM, sha256Hex("123456"));
    expect(blocked.ok && !blocked.value.ok && blocked.value.error).toBe("USER_BLOCKED");

    const viaHttp = await requestCode(BLOCKED_ADMIN_TELEGRAM);
    expect(viaHttp.status).toBe(UNPROCESSABLE);
    expect(sentCodes.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3) الرمز: صحيح، خاطئ، منتهٍ، وإعادة المحاولة
  // ---------------------------------------------------------------------------

  it("رمز خاطئ يُرفض برسالة مفهومة، ثم الرمز الصحيح بعده ينجح (إعادة المحاولة)", async () => {
    sentCodes = [];
    expect((await requestCode(ADMIN_TELEGRAM)).status).toBe(SEE_OTHER);
    const correct = extractCode(sentCodes[0]?.text ?? "");
    const wrong = correct === "000000" ? "111111" : "000000";

    const failed = await verify(ADMIN_TELEGRAM, wrong);
    expect(failed.status).toBe(UNPROCESSABLE);
    expect(noticeOf(await failed.text())).toContain("رمز غير صحيح أو منتهٍ");

    // المحاولة أُحصيت، والرمز ما زال صالحاً لأنها دون الحدّ
    const attempted = await sql<{ attempts: number }[]>`
      select attempts from admin_login_codes order by created_at desc limit 1
    `;
    expect(attempted[0]?.attempts).toBe(1);

    const recovered = await verify(ADMIN_TELEGRAM, correct);
    expect(recovered.status).toBe(SEE_OTHER);
    expect(cookieFrom(recovered).startsWith(`${ADMIN_SESSION_COOKIE}=`)).toBe(true);
  });

  it("رمز منتهٍ بالوقت يُرفض ويُستهلك، فلا يُقبل بعد ذلك أبداً", async () => {
    sentCodes = [];
    await requestCode(ADMIN_TELEGRAM);
    const code = extractCode(sentCodes[0]?.text ?? "");

    // تقديم الزمن في القاعدة: الانتهاء شرط زمني لا شكلي
    await sql`update admin_login_codes set expires_at = now() - interval '1 second'`;

    const expired = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(expired.ok && !expired.value.ok && expired.value.error).toBe("CODE_EXPIRED");

    // وقد استُهلك: لا يعود صالحاً حتى لو مُدِّد الوقت لاحقاً
    await sql`update admin_login_codes set expires_at = now() + interval '10 minutes'`;
    const again = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(again.ok && again.value.ok).toBe(false);

    const viaHttp = await verify(ADMIN_TELEGRAM, code);
    expect(viaHttp.status).toBe(UNPROCESSABLE);
    expect(noticeOf(await viaHttp.text())).toContain("اطلب رمزاً جديداً");
  });

  it("رمز بطول خاطئ يُرفض شكلاً بلا استهلاك محاولة من الرمز الصالح", async () => {
    sentCodes = [];
    await requestCode(ADMIN_TELEGRAM);

    const short = await verify(ADMIN_TELEGRAM, "123");
    expect(short.status).toBe(UNPROCESSABLE);
    expect(noticeOf(await short.text())).toContain("ستّ خانات");

    // لم تُحتسب محاولة: الرفض الشكلي لا يقرّب الحساب من الإقفال
    const attempts = await sql<{ attempts: number }[]>`
      select attempts from admin_login_codes order by created_at desc limit 1
    `;
    expect(attempts[0]?.attempts).toBe(0);
  });

  it("تكرار إرسال نفس الرمز الصحيح لا يفتح جلستين", async () => {
    sentCodes = [];
    await requestCode(ADMIN_TELEGRAM);
    const code = extractCode(sentCodes[0]?.text ?? "");

    const first = await verify(ADMIN_TELEGRAM, code);
    expect(first.status).toBe(SEE_OTHER);

    const replay = await verify(ADMIN_TELEGRAM, code);
    expect(replay.status).toBe(UNPROCESSABLE);

    const sessions = await sql<{ id: string }[]>`select id from admin_sessions`;
    expect(sessions.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4) الجلسة: منتهية، مفقودة، مزوَّرة، وتمديد انزلاقي
  // ---------------------------------------------------------------------------

  it("جلسة منتهية بالوقت تسقط: الصفحة تُحوَّل والواجهة تُجيب 401", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect((await request("/admin", { cookie })).status).toBe(OK);

    await sql`update admin_sessions set expires_at = now() - interval '1 second'`;

    const page = await request("/admin", { cookie });
    expect(page.status).toBe(SEE_OTHER);
    expect(page.headers.get("location")).toBe("/admin/login");

    const api = await request("/admin/api/overview", { cookie });
    expect(api.status).toBe(UNAUTHORIZED);
  });

  it("كعكة مزوَّرة لا توجد لها جلسة تُرفض ولا تُنشئ جلسة", async () => {
    const forged = `${ADMIN_SESSION_COOKIE}=${generateSessionToken()}`;
    const page = await request("/admin", { cookie: forged });
    expect(page.status).toBe(SEE_OTHER);

    const api = await request("/admin/api/overview", { cookie: forged });
    expect(api.status).toBe(UNAUTHORIZED);

    const sessions = await sql<{ id: string }[]>`select id from admin_sessions`;
    expect(sessions.length).toBe(0);
  });

  it("كعكة تالفة أو فارغة تُعامَل كغياب جلسة لا كعطل", async () => {
    for (const value of ["", "!!!not-hex!!!", "a".repeat(500)]) {
      const page = await request("/admin", { cookie: `${ADMIN_SESSION_COOKIE}=${value}` });
      expect(page.status).toBe(SEE_OTHER);
    }
  });

  it("الجلسة تُمدَّد انزلاقياً مع كل طلب فلا تنتهي على مشغّل يعمل بلا توقّف", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const before = await sql<{ expires_at: Date }[]>`
      select expires_at from admin_sessions limit 1
    `;
    // تقريب النهاية يدوياً ثم طلب واحد يعيدها إلى المدى الكامل
    await sql`update admin_sessions set expires_at = now() + interval '1 minute'`;
    expect((await request("/admin", { cookie })).status).toBe(OK);

    const after = await sql<{ expires_at: Date }[]>`
      select expires_at from admin_sessions limit 1
    `;
    const beforeAt = before[0]?.expires_at;
    const afterAt = after[0]?.expires_at;
    expect(beforeAt).toBeDefined();
    expect(afterAt).toBeDefined();
    // عادت إلى مدى الثماني ساعات تقريباً، أي أبعد بكثير من الدقيقة المزروعة
    const remainingMinutes = (new Date(String(afterAt)).getTime() - Date.now()) / 60000;
    expect(remainingMinutes).toBeGreaterThan(60);
  });

  it("حظر المسؤول أثناء جلسة حيّة يُسقطها في الطلب التالي", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect((await request("/admin", { cookie })).status).toBe(OK);

    await sql`update users set is_blocked = true where id = ${adminUserId}`;

    expect((await request("/admin", { cookie })).status).toBe(SEE_OTHER);

    // وقد أُبطلت الجلسة في القاعدة لا في الذاكرة وحدها
    const revoked = await sql<{ revoked_at: Date | null }[]>`
      select revoked_at from admin_sessions limit 1
    `;
    expect(revoked[0]?.revoked_at).not.toBeNull();
  });

  it("الخروج بلا جلسة لا ينفجر، ويعيد إلى صفحة الدخول", async () => {
    const out = await request("/admin/logout", { method: "POST" });
    expect(out.status).toBe(SEE_OTHER);
    expect(out.headers.get("location")).toBe("/admin/login");
  });

  it("جلسة مفتوحة لا تصلح للوحة بعد سحب الصفة ولو بقيت الكعكة سليمة شكلاً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    await sql`update users set role = 'driver' where id = ${adminUserId}`;

    expect((await request("/admin", { cookie })).status).toBe(SEE_OTHER);
    expect((await request("/admin/api/overview", { cookie })).status).toBe(UNAUTHORIZED);
  });
});
