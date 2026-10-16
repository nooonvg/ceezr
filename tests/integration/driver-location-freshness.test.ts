/**
 * الغرض: المرحلة ٨ — إثبات حَرَس عمر موقع السائق على قاعدةٍ حقيقية وبمسار البوت
 * الحقيقي، لا بتخيّلٍ في الذاكرة.
 *
 * ## العطب الذي يقيسه هذا الملف
 *
 * `rejectionReasonFor` كانت تفحص المدينة والحجب والتوثيق والتوفّر وغيابَ الموقع
 * والقدرة والاشتراك ونصفَ القطر — ولا تفحص **عمر** الموقع. فسائقٌ أرسل موقعه ثم
 * أغلق هاتفه وبقي `is_available = true` يُحسب بعد ساعاتٍ واقفاً في تلك النقطة،
 * فتُقاس مسافتُه من التقاطٍ لا يمتّ إلى مكانه بشيء ويُبثّ إليه الطلب. والعميل
 * يقرأ «سائقٌ على بُعد كيلومتر» ويقبل، فيصله من كان على بُعد عشرين.
 *
 * ## ولماذا اختبارُ تكاملٍ لا وحدة
 *
 * اختبار الوحدة يُثبت أن الدومين يرفض مرشّحاً حُقن فيه `locationAtMs` قديم — وهذا
 * نصفُ الحقيقة. والنصف الآخر أن **الاستعلام** يُسلّم الطابع أصلاً: لو نسي
 * `dispatch-adapters` قراءة `last_location_at` لكان `locationAtMs` دائماً `null`،
 * ولمرّت اختبارات الوحدة كلّها والحَرَس معطَّل في الإنتاج بلا أن يصرخ أحد. فهذا
 * الملف يقرأ بمستودع المرشّحين نفسه الذي تستعمله `matchOrder`، ويقارن ما سلّمه
 * بما في العمود.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على شروط أهليّة المرشّحين أو على كتابة
 *   `drivers.last_location`
 * ملاحظات مستقبلية: عند تفعيل الحدّ في الإنتاج (قرار مالك) تُضاف حالةٌ تؤكّد وصول
 *   تنبيهٍ للسائق المستبعد لقِدَم موقعه بدل استبعادٍ صامت.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { evaluateCandidates } from "../../packages/domain/dispatch/entity.ts";
import { parseCitySettings, toMatchingParameters } from "../../packages/domain/policy/entity.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverCandidateRepository } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { seedAcceptedDocuments } from "../support/seed-driver-documents.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_801;
const RIDER_CHAT = 220_801;
const ADMIN_TELEGRAM = 990_801;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
/** على بُعد نحو ٤٥٠ متراً من نقطة الالتقاط: داخل نصف القطر بلا لبس. */
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3998,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN_TELEGRAM),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
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
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: nextUpdateId(),
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("المرحلة ٨ — عمر موقع السائق في الإسناد", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    /**
     * جدة كسائر ملفات التكامل، لا مدينةٌ خاصّة بهذا الملف.
     *
     * جُرِّبت «المدينة المنوّرة» أولاً لعزل تعديل `platform_settings` عن الآخرين،
     * فكشفت افتراضاً عامّاً في الحزمة كلّها: اختباراتٌ تُعطّل مدينتها ثم تتوقّع أن
     * يرى المستخدم «لا مدينة مفعّلة» — أي أنها تفترض أن **لا** مدينةَ أخرى مفعّلة
     * في القاعدة. فتفعيل مدينةٍ ثانية أسقط ثلاثة اختبارات في ملفّين آخرين.
     *
     * فالاختيار بين خطرين: مشاركةُ سطر إعدادٍ مع ملفاتٍ لا تُقدِّم عمر موقعها
     * (فتمرّ من أي حدٍّ نضعه لأن مواقعها تُرسل قبل ثوانٍ)، أو خرقُ افتراضٍ عامّ
     * تعتمد عليه اختباراتٌ قائمة. والأول أقلّ ضرراً وأصدق: الحدّ يُعاد إلى صفر في
     * `beforeEach` و`afterAll`، فلا يبقى مُفعّلاً بعد أي اختبار.
     *
     * والعلّة الأصل — أن الحزمة كلّها تتقاسم قاعدةً واحدة بلا عزل — تخصّ المرحلة
     * ٢٢، ولا تُصلَح بملفٍّ واحد. تُسجَّل خطراً لا تُخبَّأ.
     */
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  /**
   * إغلاق الحاوية بعد **كل** اختبار لا بعد الملف.
   *
   * `beforeEach` تبني حاويةً جديدة، ولكل حاوية بِركةُ اتصالاتٍ سعتُها خمسة. فإغلاقٌ
   * في `afterAll` وحده يعني سبع بِرَك مفتوحة معاً — خمسةٌ وثلاثون اتصالاً من مئة
   * يسمح بها الخادم، من ملفٍ واحد. وbun يشغّل ملفات الاختبار على التوازي، فحين
   * أُضيف هذا الملف خامساً وثمانين تجاوز المجموعُ الحدّ، ففشل فتحُ الاتصال في
   * ملفاتٍ أخرى وظهر عندها «حدث عطل تقني مؤقّت» في تسجيل السائق: ١٥ اختباراً
   * ساقطاً في أربعة ملفات، ولا واحدٌ منها في هذا الملف — أي أن العَرَض يظهر بعيداً
   * عن سببه. وهذا ما يجعل تسريب البِرَك أخطر من بطئه.
   */
  afterEach(async () => {
    // إن أخفقَ التهيئةُ لم تُبنَ الحاويةُ أصلاً، وطرحُ خطأٍ ثانٍ في التفكيك يطمس الأوّل.
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    // إعادة الإعداد إلى المبذور: تركُه مُفعّلاً يجعل تشغيلاً لاحقاً يبدأ بحَرَسٍ
    // شغّله اختبارٌ لا مالك، وهو أسوأ من ألّا يُختبَر
    await setMaxAge(0);
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    /**
     * `truncate` عامّ كسائر ملفات التكامل، لا حذفٌ محصورٌ بالمدينة.
     *
     * جُرِّب الحذفُ المحصور أولاً لأنه يبدو أنظف، فأنتج الأسوأ: `truncate` في
     * الملفات المتوازية يأخذ ACCESS EXCLUSIVE على نفس الجداول، فتتقابل أقفالُه
     * مع أقفال صفوف الـ`delete` هنا في رتلٍ ينتظر بعضُه بعضاً — قفز زمن هذا
     * الملف وحده من ٠٫٩ ثانية إلى ٢١٫٩، وسقط ملفّ e2e كاملاً بعطلٍ تقني في
     * التسجيل. فمخالفةُ العُرف هنا لم تكن تحسيناً بل مصدرَ تنازع جديد.
     */
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    await setMaxAge(0);
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** ضبط الحدّ في `platform_settings` — لا ثابتٌ في الكود ولا حقنٌ في الحاوية. */
  async function setMaxAge(seconds: number): Promise<void> {
    // `${text}::jsonb` يجعل السائق يُلفّف النصّ ثانيةً فيُخزَّن jsonb من نوع
    // `string` مع value_type='number' — تلويثٌ صامت للقاعدة المشتركة. النمط
    // الصحيح `to_jsonb(int)` (أو `::text::jsonb` كما في admin/queries.ts:1436).
    await sql`
      update platform_settings set value = to_jsonb(${seconds}::int)
       where city_id = ${cityId} and key = 'driver_location_max_age_seconds'
    `;
  }

  async function admin(): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, role)
      values (${cityId}, ${ADMIN_TELEGRAM}, 'مدير الاختبار', 'admin')
      returning id
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُنشأ المدير");
    return id;
  }

  /** سائقٌ حقيقي عبر مسار التسجيل الكامل، موثّق ومتاح، وقد أرسل موقعه. */
  async function availableDriverWithLocation(): Promise<string> {
    const actorUserId = await admin();
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "خالد المطيري"));
    await post("driver", contact(DRIVER_CHAT, "0508010801"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 0801"));
    await post("driver", text(DRIVER_CHAT, "1080801080"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1080801080"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    // زرعُ وثائقَ مقبولةٍ لاجتياز حارسِ F12-21 في مسارِ الاعتمادِ
    await seedAcceptedDocuments(sql, cityId, driverId);
    const outcome = await sql<{ result: { ok: boolean } }[]>`
      select admin_set_driver_verification(
        ${actorUserId}::uuid, ${driverId}::uuid, 'verified'::text
      ) as result
    `;
    expect(outcome[0]?.result.ok).toBe(true);
    await post("driver", text(DRIVER_CHAT, "/available"));
    // الموقع يُرسل بمسار البوت الحقيقي لا بـinsert: الكاتب الوحيد لـlast_location
    // هو directories.ts (ADR-0015)، وكتابةٌ يدوية هنا كانت ستختبر SQL الاختبار
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    return driverId;
  }

  async function registerRider(): Promise<void> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
  }

  async function requestRide(): Promise<void> {
    await post("rider", callback(RIDER_CHAT, "svc:transport"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
  }

  /** تقديمُ الزمن إلى الخلف على العمود القانوني — لا حقنَ ساعةٍ مزيفة في الحاوية. */
  async function ageLocationBy(driverId: string, interval: string): Promise<void> {
    await sql`
      update drivers
         set last_location_at = now() - ${interval}::interval,
             last_location_recorded_at = now() - ${interval}::interval
       where id = ${driverId}
    `;
  }

  const offersFor = (driverId: string) =>
    sql<{ count: string }[]>`select count(*)::text from order_offers where driver_id = ${driverId}`;

  /** الأسباب كما يراها الدومين، بالإعدادات الحقيقية للمدينة لا بقيمٍ مكتوبة هنا. */
  async function rejectionReasons(): Promise<readonly string[]> {
    const settings = await createSettingsRepository(sql).findByCity(cityId as CityId);
    expect(settings.ok).toBe(true);
    if (!settings.ok) return [];
    const parsed = parseCitySettings(cityId as CityId, settings.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return [];
    const candidates = await createDriverCandidateRepository(sql).findAvailableInCity(
      cityId as CityId,
    );
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return [];
    const evaluation = evaluateCandidates(
      candidates.value,
      { cityId: cityId as CityId, service: "transport", pickup: PICKUP, excludedDriverIds: [] },
      toMatchingParameters(parsed.value),
      new Date(),
    );
    return evaluation.rejected.map((r) => r.reason);
  }

  it("١ — الاستعلام يُسلّم طابع الموقع فعلاً، ومطابقاً للعمود القانوني", async () => {
    const driverId = await availableDriverWithLocation();

    const candidates = await createDriverCandidateRepository(sql).findAvailableInCity(
      cityId as CityId,
    );
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;
    const mine = candidates.value.find((c) => String(c.driverId) === driverId);
    expect(mine?.location).not.toBeNull();

    // لو أُغفلت قراءة last_location_at في dispatch-adapters لكان هذا null، ولمرّ
    // كل اختبار وحدةٍ للحَرَس بنجاح والحَرَس معطَّل في الإنتاج
    expect(typeof mine?.locationAtMs).toBe("number");

    const stored = await sql<{ at_ms: string }[]>`
      select (extract(epoch from last_location_at) * 1000)::bigint::text as at_ms
        from drivers where id = ${driverId}
    `;
    // مصدرٌ واحد للحقيقة: ما سلّمه المستودع هو نفسه ما في العمود، لا تقريبٌ له
    expect(mine?.locationAtMs).toBe(Number(stored[0]?.at_ms));
  });

  it("٢ — بالقيمة المبذورة (صفر) يبقى السلوك كما كان: موقعٌ عمره ساعات لا يُسقِط أحداً", async () => {
    const driverId = await availableDriverWithLocation();
    await ageLocationBy(driverId, "6 hours");

    // هذا هو تعهّد الهجرة: تشغيلها لا يُغيّر سلوك الإسناد بحرفٍ واحد
    expect(await rejectionReasons()).not.toContain("STALE_LOCATION");

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBeGreaterThan(0);
  });

  it("٣ — بتفعيل الحدّ، سائقٌ موقعُه عمره ست ساعات يُستبعد بسبب مُسمّى ولا يصله عرض", async () => {
    const driverId = await availableDriverWithLocation();
    await setMaxAge(900);
    await ageLocationBy(driverId, "6 hours");

    // السبب مُسمّى لا اختفاءٌ صامت: المشغّل يقرأ «أرسل ثم انقطع» لا «لا مرشّحين»
    const reasons = await rejectionReasons();
    expect(reasons).toContain("STALE_LOCATION");
    expect(reasons).not.toContain("NO_LOCATION");

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBe(0);
  });

  it("٤ — وبتفعيل الحدّ نفسه، من موقعُه حديث يصله العرض: الحَرَس لا يُعطّل الإسناد", async () => {
    const driverId = await availableDriverWithLocation();
    await setMaxAge(900);
    // لا تقديمَ زمن: الموقع وصل قبل ثوانٍ في هذا الاختبار
    expect(await rejectionReasons()).not.toContain("STALE_LOCATION");

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBeGreaterThan(0);
  });

  it("٥ — إرسال الموقع مرّةً أخرى يُعيد الأهليّة فوراً: الاستبعاد مؤقّت لا عقوبة", async () => {
    const driverId = await availableDriverWithLocation();
    await setMaxAge(900);
    await ageLocationBy(driverId, "6 hours");
    expect(await rejectionReasons()).toContain("STALE_LOCATION");

    // بمسار البوت الحقيقي: نفس الكاتب الذي يستعمله السائق في الإنتاج
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    expect(await rejectionReasons()).not.toContain("STALE_LOCATION");

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBeGreaterThan(0);
  });

  it("٦ — الحدّ يُقرأ من إعدادات المدينة: نفس الموقع يُقبل بقيمةٍ ويُرفض بأخرى بلا نشر كود", async () => {
    const driverId = await availableDriverWithLocation();
    await ageLocationBy(driverId, "30 minutes");

    await setMaxAge(3600);
    expect(await rejectionReasons()).not.toContain("STALE_LOCATION");

    // لا شيء تغيّر إلا سطرٌ في platform_settings — لا إعادة بناء ولا إعادة تشغيل
    await setMaxAge(600);
    expect(await rejectionReasons()).toContain("STALE_LOCATION");

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBe(0);
  });

  it("٧ — موقعٌ بلا طابعٍ يُعدّ قديماً حين يكون الفحص مُفعّلاً: «لا نعلم متى» ليست «الآن»", async () => {
    const driverId = await availableDriverWithLocation();
    await setMaxAge(900);
    // صفٌّ كُتِب قبل أن يوجد العمود — الحالة التي كانت ستمرّ إلى الأبد لو افترضنا الحداثة
    await sql`update drivers set last_location_at = null where id = ${driverId}`;

    const candidates = await createDriverCandidateRepository(sql).findAvailableInCity(
      cityId as CityId,
    );
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;
    const mine = candidates.value.find((c) => String(c.driverId) === driverId);
    // الموقع موجود، والطابع غائب: لا يُستبدل الغياب بـ Date.now()
    expect(mine?.location).not.toBeNull();
    expect(mine?.locationAtMs).toBeNull();

    expect(await rejectionReasons()).toContain("STALE_LOCATION");
    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBe(0);
  });
});
