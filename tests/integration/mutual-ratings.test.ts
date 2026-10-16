/**
 * الغرض: التقييم المتبادل كاملاً على قاعدة PostgreSQL فعلية عبر الـ webhook الحقيقي:
 *   سائق يقبل طلباً ← يبدأ الرحلة بزرّ ← ينهيها ← يصل ملخّص للطرفين وطلب تقييم لكلٍّ
 *   بلغته ← كلٌّ يضغط نجمة ← يُخزَّن التقييم ويتحرّك المتوسط فعلاً.
 *   والأهمّ (شرط قبول التوجيه): إثبات أن فارق تقييم حقيقي يغيّر ترتيب order_offers.score
 *   قياساً، وأن من دون عتبة الثقة يُعامَل بالتقييم الافتراضي لا بمتوسطه الهشّ.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على معادلة المطابقة
 * ملاحظات مستقبلية: عند إضافة أبعاد للتقييم يُضاف تأكيد على كل بُعد لا اختبار موازٍ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const SUPPORT_GROUP = "-1001";
const DRIVER_A = 350_001;
const DRIVER_B = 350_002;
const RIDER = 350_201;
const SUPPORT_CHAT = 350_301;
const BOOTSTRAP_ADMIN_CHAT = 350_401;

/** نقطة الالتقاط ونقطتان متساويتا البعد عنها تماماً — فلا يبقى فارق إلا التقييم. */
const PICKUP = { latitude: 21.5471, longitude: 39.1751 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1901 };
const EQUIDISTANT_NORTH = { latitude: 21.5571, longitude: 39.1751 };
const EQUIDISTANT_SOUTH = { latitude: 21.5371, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3995,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(BOOTSTRAP_ADMIN_CHAT),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
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
const privateCallback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("التقييم المتبادل وأثره في المطابقة على قاعدة حقيقية", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: SUPPORT_GROUP, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    // إعادة الإعدادات إلى قيم البذر: platform_settings لا يُفرَّغ، فتسرّب القيم بين التشغيلات
    await sql`
      update platform_settings
         set value = case key
                       when 'rating_min_count_for_trust' then '3'
                       when 'rating_prompt_window_hours' then '48'
                       when 'match_weight_proximity'     then '0.7'
                       when 'match_weight_rating'        then '0.3'
                       when 'search_radius_km'           then '10'
                       else value
                     end
       where city_id = ${cityId}
         and key in ('rating_min_count_for_trust', 'rating_prompt_window_hours',
                     'match_weight_proximity', 'match_weight_rating', 'search_radius_km')
    `;

    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** سائق مسجَّل، متحقَّق، مشترك، متاح وله موقع — أدنى حالة يصله فيها عرض. */
  async function registerDriver(
    chatId: number,
    name: string,
    phone: string,
    at: { latitude: number; longitude: number },
  ): Promise<string> {
    await post("driver", text(chatId, "/start"));
    await post("driver", text(chatId, name));
    await post("driver", contact(chatId, phone));
    await post("driver", privateCallback(chatId, `city:${cityId}`));
    await post("driver", privateCallback(chatId, "service:transport"));
    await post("driver", privateCallback(chatId, "vehicle:sedan"));
    await post("driver", text(chatId, "أ ب ج 1234"));
    await post("driver", text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post("driver", photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error(`لم يُسجَّل السائق ${chatId}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, at));
    return driverId;
  }

  async function registerRider(chatId: number, name: string, phone: string): Promise<string> {
    await post("rider", text(chatId, "/start"));
    await post("rider", text(chatId, name));
    await post("rider", contact(chatId, phone));
    await post("rider", privateCallback(chatId, `city:${cityId}`));
    const rows = await sql<{ id: string }[]>`
      select r.id from riders r join users u on u.id = r.user_id where u.telegram_id = ${chatId}
    `;
    const riderId = rows[0]?.id;
    if (riderId === undefined) throw new Error(`لم يُسجَّل العميل ${chatId}`);
    return riderId;
  }

  /** طلب نقل كامل من العميل حتى بثّ العروض. */
  async function placeOrder(chatId: number): Promise<string> {
    // ‏/ride يفتح مسار النقل مباشرةً؛ فلا تعتمد الإعادة على زر خدمة قديم بعد
    // مسح جلسة الطلب السابق.
    await post("rider", text(chatId, "/ride"));
    await post("rider", location(chatId, PICKUP));
    await post("rider", location(chatId, DROPOFF));
    const rows = await sql<{ id: string }[]>`
      select id from orders order by created_at desc limit 1
    `;
    const orderId = rows[0]?.id;
    if (orderId === undefined) throw new Error("لم يُنشأ الطلب");
    return orderId;
  }

  const driverMessages = (chatId: number) => driverSent.filter((m) => m.chatId === String(chatId));
  const riderMessages = (chatId: number) => riderSent.filter((m) => m.chatId === String(chatId));

  it("الرحلة تبدأ وتنتهي، ويُطلب التقييم من الطرفين، ويتحرّك المتوسط فعلاً", async () => {
    const driverId = await registerDriver(DRIVER_A, "خالد السائق", "+966500000101", PICKUP);
    await registerRider(RIDER, "منى العميلة", "+966500000201");
    const orderId = await placeOrder(RIDER);

    await post("driver", privateCallback(DRIVER_A, `offer:accept:${orderId}`));
    /**
     * لم يعد نصّ القبول آخر رسالة: بطاقة الرحلة ودبّوسها يليانه (المرحلة ١٢).
     * فيُنتقى بنصّه لا بموضعه، لأنّ التثبيت على الموضع يكسر عند كل إضافة صحيحة.
     */
    const accepted = driverMessages(DRIVER_A).find((m) => m.text === ar("driver.offer_accepted"));
    expect(accepted).toBeDefined();
    const cardAfterAccept = driverMessages(DRIVER_A).find((m) =>
      m.text.includes(ar("driver.trip_header")),
    );
    expect(cardAfterAccept?.text).toContain(ar("driver.trip_leg_to_pickup"));
    // زرّ البدء يخرج مع القبول: السائق لا يُطالَب بحفظ معرّف الطلب
    const acceptMarkup = accepted?.markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(acceptMarkup.inline_keyboard).toEqual([
      [{ text: ar("rating.start_button"), callback_data: `ride:start:${orderId}` }],
    ]);

    await post("driver", privateCallback(DRIVER_A, `ride:start:${orderId}`));
    const [started] = await sql<{ status: string; started_at: Date | null }[]>`
      select status, started_at from orders where id = ${orderId}
    `;
    expect(started?.status).toBe("in_progress");
    expect(started?.started_at).not.toBeNull();

    // البند ب.2 على قاعدة حقيقية: العميل يعلم أن سائقه انطلق، لا ينتظر إلى الوصول
    expect(riderMessages(RIDER).at(-1)?.text).toBe(
      ar("rating.started_rider", { driver: "خالد السائق", order: String(orderId).slice(0, 8) }),
    );

    await post("driver", privateCallback(DRIVER_A, `ride:complete:${orderId}`));
    const [completed] = await sql<{ status: string; completed_at: Date | null }[]>`
      select status, completed_at from orders where id = ${orderId}
    `;
    expect(completed?.status).toBe("completed");
    expect(completed?.completed_at).not.toBeNull();

    // السائق عاد متاحاً تلقائياً: من أنهى رحلة يجب أن يستقبل التالية بلا أمر إضافي
    const [availability] = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(availability?.is_available).toBe(true);

    // طلب التقييم وصل الطرفين، كلٌّ على بوته، بخمسة أزرار نجوم
    const driverPrompt = driverMessages(DRIVER_A).at(-1);
    expect(driverPrompt?.text).toBe(ar("rating.ask_rating_rider", { rider: "منى العميلة" }));
    const driverStars = driverPrompt?.markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    expect(driverStars.inline_keyboard[0]).toHaveLength(5);
    expect(driverStars.inline_keyboard[0]?.map((b) => b.callback_data)).toEqual([
      `rate:1:${orderId}`,
      `rate:2:${orderId}`,
      `rate:3:${orderId}`,
      `rate:4:${orderId}`,
      `rate:5:${orderId}`,
    ]);

    const riderPrompt = riderMessages(RIDER).at(-1);
    expect(riderPrompt?.text).toBe(ar("rating.ask_rating_driver", { driver: "خالد السائق" }));
    const riderStars = riderPrompt?.markup as { inline_keyboard: unknown[][] };
    expect(riderStars.inline_keyboard[0]).toHaveLength(5);

    // كلٌّ يقيّم الآخر — والاتجاه يُستنتج في القاعدة من هوية الضاغط لا من بيانات الزرّ
    await post("rider", privateCallback(RIDER, `rate:4:${orderId}`));
    await post("driver", privateCallback(DRIVER_A, `rate:5:${orderId}`));

    const stored = await sql<{ direction: string; stars: number }[]>`
      select direction, stars from ratings where order_id = ${orderId} order by direction
    `;
    // الترتيب بترتيب قيم النوع المُعدَّد: rider_to_driver مُعرَّف أولاً
    expect(stored.map((r) => ({ ...r }))).toEqual([
      { direction: "rider_to_driver", stars: 4 },
      { direction: "driver_to_rider", stars: 5 },
    ]);

    const [driverRow] = await sql<{ rating_average: string; rating_count: number }[]>`
      select rating_average, rating_count from drivers where id = ${driverId}
    `;
    expect(Number(driverRow?.rating_average)).toBeCloseTo(4, 2);
    expect(driverRow?.rating_count).toBe(1);
  });

  it("لا يقيّم أحد مرّتين ولا يقيّم رحلة لم تنتهِ", async () => {
    await registerDriver(DRIVER_A, "خالد السائق", "+966500000101", PICKUP);
    await registerRider(RIDER, "منى العميلة", "+966500000201");
    const orderId = await placeOrder(RIDER);
    await post("driver", privateCallback(DRIVER_A, `offer:accept:${orderId}`));

    // قبل الإنهاء: مرفوض
    await post("rider", privateCallback(RIDER, `rate:5:${orderId}`));
    expect(riderMessages(RIDER).at(-1)?.text).toBe(ar("rating.ride_not_completed"));

    await post("driver", privateCallback(DRIVER_A, `ride:start:${orderId}`));
    await post("driver", privateCallback(DRIVER_A, `ride:complete:${orderId}`));

    await post("rider", privateCallback(RIDER, `rate:5:${orderId}`));
    expect(riderMessages(RIDER).at(-1)?.text).toBe(ar("rating.thanks", { bar: "★★★★★" }));

    await post("rider", privateCallback(RIDER, `rate:1:${orderId}`));
    expect(riderMessages(RIDER).at(-1)?.text).toBe(ar("rating.already_rated"));

    // ولا يتغيّر المخزَّن بالمحاولة الثانية
    const rows = await sql<{ stars: number }[]>`
      select stars from ratings where order_id = ${orderId} and direction = 'rider_to_driver'
    `;
    expect(rows.map((r) => ({ ...r }))).toEqual([{ stars: 5 }]);
  });

  it("رحلة لا يملكها السائق لا تبدأ، ورحلة لم تبدأ لا تنتهي", async () => {
    await registerDriver(DRIVER_A, "خالد السائق", "+966500000101", PICKUP);
    await registerDriver(DRIVER_B, "سالم السائق", "+966500000102", EQUIDISTANT_NORTH);
    await registerRider(RIDER, "منى العميلة", "+966500000201");
    const orderId = await placeOrder(RIDER);
    await post("driver", privateCallback(DRIVER_A, `offer:accept:${orderId}`));

    await post("driver", privateCallback(DRIVER_B, `ride:start:${orderId}`));
    expect(driverMessages(DRIVER_B).at(-1)?.text).toBe(ar("rating.ride_not_startable"));

    await post("driver", privateCallback(DRIVER_A, `ride:complete:${orderId}`));
    expect(driverMessages(DRIVER_A).at(-1)?.text).toBe(ar("rating.ride_not_completable"));
  });

  /**
   * شرط القبول الحرفي في التوجيه: فارق تقييم حقيقي يغيّر ترتيب order_offers.score قياساً.
   * السائقان على بُعدين متساويين تماماً من نقطة الالتقاط، فالفارق الوحيد هو التقييم.
   */
  it("فارق التقييم الحقيقي يغيّر ترتيب order_offers.score فعلاً", async () => {
    const high = await registerDriver(DRIVER_A, "خالد السائق", "+966500000101", EQUIDISTANT_NORTH);
    const low = await registerDriver(DRIVER_B, "سالم السائق", "+966500000102", EQUIDISTANT_SOUTH);
    await registerRider(RIDER, "منى العميلة", "+966500000201");

    // تقييمات حقيقية فوق عتبة الثقة (3): لا نكتب المتوسط يدوياً بل نبني السجلّ
    await sql`
      update drivers set rating_average = 4.90, rating_count = 12 where id = ${high}
    `;
    await sql`
      update drivers set rating_average = 3.10, rating_count = 12 where id = ${low}
    `;

    const orderId = await placeOrder(RIDER);
    const offers = await sql<{ driver_id: string; score: string }[]>`
      select driver_id, score from order_offers where order_id = ${orderId} order by score desc
    `;
    expect(offers).toHaveLength(2);
    expect(offers[0]?.driver_id).toBe(high);
    expect(offers[1]?.driver_id).toBe(low);

    // الفارق قياسي لا رمزي: وزن التقييم 0.3 × فارق (4.9−3.1)/5 = 0.108
    const gap = Number(offers[0]?.score) - Number(offers[1]?.score);
    expect(gap).toBeCloseTo(0.3 * ((4.9 - 3.1) / 5), 3);

    // ثم نقلب التقييمين وحدهما — بلا أيّ تعديل كود ولا تحريك موقع — فينقلب الترتيب
    await sql`truncate table order_offers, orders restart identity cascade`;
    await sql`update drivers set rating_average = 3.10 where id = ${high}`;
    await sql`update drivers set rating_average = 4.90 where id = ${low}`;
    await sql`update driver_availability set is_available = true`;

    const secondOrder = await placeOrder(RIDER);
    const flipped = await sql<{ driver_id: string }[]>`
      select driver_id from order_offers where order_id = ${secondOrder} order by score desc
    `;
    expect(flipped[0]?.driver_id).toBe(low);
    expect(flipped[1]?.driver_id).toBe(high);
  });

  /**
   * الوجه الآخر من المعادلة: متوسط هشّ لا يُرتَّب به أحد. تقييم واحد بخمس نجوم
   * لا يقدّم صاحبه على متوسط 4.6 مبنيّ على أربعين تقييماً.
   */
  it("من دون عتبة الثقة يُعامَل بالتقييم الافتراضي لا بمتوسطه الهشّ", async () => {
    const fragile = await registerDriver(
      DRIVER_A,
      "خالد السائق",
      "+966500000101",
      EQUIDISTANT_NORTH,
    );
    const trusted = await registerDriver(
      DRIVER_B,
      "سالم السائق",
      "+966500000102",
      EQUIDISTANT_SOUTH,
    );
    await registerRider(RIDER, "منى العميلة", "+966500000201");

    // خمس نجوم من تقييم واحد (تحت العتبة 3) في مواجهة 4.60 من أربعين
    await sql`update drivers set rating_average = 5.00, rating_count = 1 where id = ${fragile}`;
    await sql`update drivers set rating_average = 4.60, rating_count = 40 where id = ${trusted}`;

    const orderId = await placeOrder(RIDER);
    const offers = await sql<{ driver_id: string; score: string }[]>`
      select driver_id, score from order_offers where order_id = ${orderId} order by score desc
    `;
    expect(offers[0]?.driver_id).toBe(trusted);

    // صاحب التقييم الهشّ يُحسب بالافتراضي 4.5 بالضبط، لا بخمسته
    const gap = Number(offers[0]?.score) - Number(offers[1]?.score);
    expect(gap).toBeCloseTo(0.3 * ((4.6 - 4.5) / 5), 4);
  });

  it("إعادة الحساب تصحّح انحرافاً حقيقياً بعد تعليم تقييم مُسيء", async () => {
    const driverId = await registerDriver(DRIVER_A, "خالد السائق", "+966500000101", PICKUP);
    await registerRider(RIDER, "منى العميلة", "+966500000201");
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${SUPPORT_CHAT}, 'سعيد الدعم', '+966500000009', 'support')
    `;

    const orderId = await placeOrder(RIDER);
    await post("driver", privateCallback(DRIVER_A, `offer:accept:${orderId}`));
    await post("driver", privateCallback(DRIVER_A, `ride:start:${orderId}`));
    await post("driver", privateCallback(DRIVER_A, `ride:complete:${orderId}`));
    await post("rider", privateCallback(RIDER, `rate:1:${orderId}`));

    const [before] = await sql<{ rating_average: string; rating_count: number }[]>`
      select rating_average, rating_count from drivers where id = ${driverId}
    `;
    expect(Number(before?.rating_average)).toBeCloseTo(1, 2);

    const [rating] = await sql<{ id: string }[]>`
      select id from ratings where order_id = ${orderId} and direction = 'rider_to_driver'
    `;
    const ratingId = rating?.id;
    if (ratingId === undefined) throw new Error("لم يُخزَّن تقييم العميل للسائق");
    await sql`select flag_rating(${ratingId}::uuid, ${SUPPORT_CHAT}::bigint)`;

    const [stillThere] = await sql<{ is_flagged: boolean }[]>`
      select is_flagged from ratings where id = ${ratingId}
    `;
    // المُسيء يُعلَّم ولا يُمحى: السجلّ يبقى للمراجعة، والمتوسط وحده يُصحَّح
    expect(stillThere?.is_flagged).toBe(true);

    // تحديث مقصود لهذا التأكيد بتاريخ 2026-08-13 (بوابة D): كان هنا تأكيدٌ على أن
    // «التعليم وحده لا يمسّ المتوسط» فيبقى 1.00 حتى تمرّ المهمة الدورية. وذلك
    // وصفٌ لعيب لا عقد: قرار الشطب غرضه كلّه رفع أثر تقييم عابث، فبقاؤه بلا أثر
    // إلى حين المهمة الدورية يعني أن المتضرِّر يحمل وزر التقييم المشطوب مدّةً
    // كاملة. أُصلح ذلك في هجرة 20260813000000 بجعل flag_rating تُعيد الحساب فوراً،
    // فصار التأكيد هنا على العقد الصحيح: الأثر فوريّ.
    const [immediate] = await sql<{ rating_average: string | null; rating_count: number }[]>`
      select rating_average, rating_count from drivers where id = ${driverId}
    `;
    expect(immediate?.rating_average).toBeNull();
    expect(immediate?.rating_count).toBe(0);

    // ويبقى غرض المهمة الدورية قائماً ومُختبَراً: الانحراف لا يأتي من الشطب وحده،
    // بل من أي كتابة تتجاوز الدالّات — ترحيل بيانات، أو إصلاح يدويّ، أو هجرة
    // تاريخية. فنصنع انحرافاً بكتابة مباشرة، ثم نُثبت أن المهمة تُرجعه إلى الحقيقة.
    await sql`
      update drivers set rating_average = 4.75, rating_count = 9 where id = ${driverId}
    `;
    const [fixed] = await sql<{ result: { drivers_updated: number } }[]>`
      select recompute_rating_averages() as result
    `;
    expect(fixed?.result.drivers_updated).toBe(1);
    const [after] = await sql<{ rating_average: string | null; rating_count: number }[]>`
      select rating_average, rating_count from drivers where id = ${driverId}
    `;
    expect(after?.rating_average).toBeNull();
    expect(after?.rating_count).toBe(0);

    // وتشغيلها ثانياً لا يجد ما يصحّحه — صفرٌ هو الحالة السليمة لا فشل صامت
    const [again] = await sql<{ result: { drivers_updated: number } }[]>`
      select recompute_rating_averages() as result
    `;
    expect(again?.result.drivers_updated).toBe(0);
  });
});
