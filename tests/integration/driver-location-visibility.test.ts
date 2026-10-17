/**
 * الغرض: البندان 2.3 و3 من التوجيه التنفيذي.
 *
 *   2.3 — «الطلبات لا تصل السائقين». التشخيص على قاعدة الإنتاج الحيّة أثبت أن
 *   السائق الوحيد كان `verification_status='verified'` و`is_available=true` وله
 *   اشتراك `trialing` وقدرة `transport` وفي مدينة الطلب نفسها، ومع ذلك صفر أسطر
 *   في `order_offers` وصفر أسباب رفض. العلّة الوحيدة: `last_location = NULL`،
 *   وكان استعلام المرشّحين يشترط `and d.last_location is not null` في SQL،
 *   فيختفي السائق **قبل** أن يراه الدومين، فلا يُسمّى سببه لأحد: لا للمشغّل في
 *   `evaluation.rejected` ولا في `NoEligibleDriverError`. الإدارة ترى «لا
 *   مرشّحين» ولا تعرف لماذا، والسائق ينتظر عملاً لا يأتي.
 *
 *   3 — التحقّق أن مسار الكتابة `POST /admin/drivers/:id/verification` يكتب في
 *   نفس العمود الذي تقرؤه المطابقة. هذا الملف يُثبته على قاعدة حقيقية بدل
 *   الاستدلال من الكود: يكتب بالدالة الذرّية `admin_set_driver_verification`
 *   ثم يقرأ بمستودع المرشّحين نفسه الذي تستعمله `matchOrder`.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على شروط أهليّة المرشّحين أو على التوثيق
 * ملاحظات مستقبلية: عند إضافة تذكير آليّ للسائق المتاح بلا موقع، يُؤكَّد هنا وصوله.
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
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
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
const DRIVER_CHAT = 120_501;
const RIDER_CHAT = 220_501;
const ADMIN_TELEGRAM = 990_501;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3993,
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

describeIf("ظهور السائق بلا موقع، ووحدة مصدر التوثيق", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  /**
   * إغلاقُ حاويةِ السيناريو عقب كلِّ اختبار لا مرّةً واحدةً في النهاية: الحاويةُ
   * تُنشئ حوضَ اتّصالاتٍ خاصّاً بها، وبناؤها في `beforeEach` مع إغلاقٍ وحيدٍ في
   * `afterAll` يُراكم أحواضاً بعددِ اختباراتِ الملفّ. القاعدةُ المحلّية كانت تحتمل
   * التراكمَ بسعتها الأوسع، أمّا خدمةُ PostgreSQL في آلةِ التكامل فتقف عند حدّها
   * الافتراضيّ فتردّ «sorry, too many clients already» — فيُخفق سربٌ من اختباراتٍ
   * سليمةٍ لا علاقةَ لها بالعيب، ويُحوّل الحمرةَ إلى ضجيجٍ يُخفي الأعطالَ الحقيقية.
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

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
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

  /** مدير حقيقي في القاعدة: `admin_set_driver_verification` ترفض غير المدير. */
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

  /**
   * تسجيل سائق كامل ثم توثيقه، بلا إرسال موقع.
   * `/available` هنا مقصود: الكود يجعله `is_available = true` ثم يطلب منه موقعه،
   * فيبقى متاحاً بلا موقع — وهذه بالضبط حالة الإنتاج المرصودة.
   */
  async function verifiedDriverWithoutLocation(actorUserId: string): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "خالد المطيري"));
    await post("driver", contact(DRIVER_CHAT, "0501110501"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001501"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001501"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");

    // زرعُ وثائقَ مقبولةٍ لاجتياز حارسِ F12-21 في مسارِ الاعتمادِ
    await seedAcceptedDocuments(sql, cityId, driverId);

    // التوثيق بنفس الدالة التي يناديها POST /admin/drivers/:id/verification — لا update مباشر
    const outcome = await sql<{ result: { ok: boolean; status?: string } }[]>`
      select admin_set_driver_verification(
        ${actorUserId}::uuid, ${driverId}::uuid, 'verified'::text
      ) as result
    `;
    expect(outcome[0]?.result.ok).toBe(true);

    await post("driver", text(DRIVER_CHAT, "/available"));
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

  const offersFor = (driverId: string) =>
    sql<{ count: string }[]>`select count(*)::text from order_offers where driver_id = ${driverId}`;

  /**
   * `LOAD-01` (الدفعةُ الرابعةُ) — إعادةُ العرضِ عندَ صيرورةِ السائقِ حيًّا صارت
   * **خلفيّةً مخفوضةً** لا متزامنةً معَ ردِّ الموقعِ (جدولةٌ + خفضُ ثانيتينِ)، فلم
   * يبقَ العقدُ «العرضُ في النداءِ نفسِهِ» بل «العرضُ خلالَ نافذةٍ محدودةٍ». هذا
   * الانتظارُ يُثبتُ العقدَ الجديدَ: يستقبلُ السائقُ عرضَهُ خلالَ ثوانٍ معدودةٍ
   * لا أنَّ الاستجابةَ تنتظرُ شوطَ مطابقةِ المدينةِ (العلّةُ التي أُصلِحتْ).
   */
  async function offersForEventually(driverId: string, timeoutMs = 6_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await offersFor(driverId);
      if (Number(rows[0]?.count) > 0) return;
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it("خطّ الأساس: التوثيق بالدالة الذرّية وحده يكفي لوصول العرض — مصدر واحد للتوثيق (البند 3)", async () => {
    const actorUserId = await admin();
    const driverId = await verifiedDriverWithoutLocation(actorUserId);
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));

    // القراءة بنفس مستودع المرشّحين الذي تستعمله matchOrder: لو كان التوثيق يُكتب
    // في عمود ويُقرأ من آخر لظهر هنا isVerified = false مع verified في القاعدة
    const candidates = await createDriverCandidateRepository(sql).findAvailableInCity(
      cityId as CityId,
    );
    expect(candidates.ok).toBe(true);
    const mine = candidates.ok
      ? candidates.value.find((c) => String(c.driverId) === driverId)
      : undefined;
    expect(mine?.isVerified).toBe(true);

    await registerRider();
    await requestRide();
    // العقدُ الجديدُ (`LOAD-01`): العرضُ خلالَ النافذةِ لا في النداءِ نفسِهِ.
    await offersForEventually(driverId);
    const rows = await offersFor(driverId);
    // لو فشل هذا فالخلل في التهيئة أو في التوثيق، والاختبار التالي بلا معنى
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });

  it("السائق المتاح بلا موقع لا يصله عرض — كما كان", async () => {
    const actorUserId = await admin();
    const driverId = await verifiedDriverWithoutLocation(actorUserId);

    const stored = await sql<{ has_location: boolean; is_available: boolean }[]>`
      select (d.last_location is not null) as has_location, a.is_available
        from drivers d join driver_availability a on a.driver_id = d.id
       where d.id = ${driverId}
    `;
    // إثبات أن حالة الإنتاج أُعيد إنتاجها حرفياً: متاح، موثّق، بلا موقع
    expect(stored[0]?.has_location).toBe(false);
    expect(stored[0]?.is_available).toBe(true);

    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBe(0);
  });

  it("لكنّه يظهر الآن في المرشّحين بسبب مُسمّى NO_LOCATION بدل أن يختفي صامتاً (البند 2.3)", async () => {
    const actorUserId = await admin();
    const driverId = await verifiedDriverWithoutLocation(actorUserId);

    const candidates = await createDriverCandidateRepository(sql).findAvailableInCity(
      cityId as CityId,
    );
    expect(candidates.ok).toBe(true);
    if (!candidates.ok) return;

    // قبل الإصلاح كان هذا صفراً: الشرط في SQL كان يحجبه قبل الدومين
    const mine = candidates.value.find((c) => String(c.driverId) === driverId);
    expect(mine).toBeDefined();
    expect(mine?.location).toBeNull();
    expect(mine?.isVerified).toBe(true);
    expect(mine?.isAvailable).toBe(true);

    // الإعدادات بمستودع الإنتاج ومحلّله: لا قيمة تجارية مكتوبة في هذا الاختبار،
    // ولو تغيّر نصف القطر أو الوزنان في القاعدة تغيّر معهما بلا تعديل كود
    const rawSettings = await createSettingsRepository(sql).findByCity(cityId as CityId);
    expect(rawSettings.ok).toBe(true);
    if (!rawSettings.ok) return;
    const parsed = parseCitySettings(cityId as CityId, rawSettings.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const params = toMatchingParameters(parsed.value);

    const evaluation = evaluateCandidates(
      candidates.value,
      {
        cityId: cityId as CityId,
        service: "transport",
        pickup: PICKUP,
        excludedDriverIds: [],
      },
      params,
      new Date(),
    );

    expect(evaluation.eligible).toHaveLength(0);
    expect(evaluation.rejected).toContainEqual({
      driverId: driverId as DriverId,
      reason: "NO_LOCATION",
    });
  });

  it("إرسال الموقع بعده يُنهي الاستبعاد فوراً: نفس السائق يصله عرض", async () => {
    const actorUserId = await admin();
    const driverId = await verifiedDriverWithoutLocation(actorUserId);
    await registerRider();
    await requestRide();
    expect(Number((await offersFor(driverId))[0]?.count)).toBe(0);

    // الموقع هو الفرق الوحيد بين الحالتين — لا إعادة تسجيل ولا تبديل توافر
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await requestRide();
    // العقدُ الجديدُ: العرضُ يصلُ خلالَ النافذةِ لا في النداءِ نفسِهِ.
    await offersForEventually(driverId);
    expect(Number((await offersFor(driverId))[0]?.count)).toBeGreaterThan(0);
  });
});
