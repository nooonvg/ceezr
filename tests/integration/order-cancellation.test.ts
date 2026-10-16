/**
 * الغرض: إثبات العطب الذي وقع فعلاً في الإنتاج يوم 2026-08-11، وإثبات زواله.
 *
 *   عميل واحد (rider b7b95840 في قاعدة الإنتاج) كان يملك طلبين نشطين معاً:
 *   مشوار أُنشئ 05:29 وطرد أُنشئ 05:37. ضغط /cancel مرّة، فقرأ النظام «آخر طلب»
 *   بـ limit 1 فألغى الطرد — الأحدث — وردّ عليه بـ «تم إلغاء طلبك» بلا تسمية.
 *   فخرج العميل ظانّاً أن مشواره انتهى، والمشوار باقٍ 'searching' خمس ساعات،
 *   ظاهراً في لوحة الإدارة تحت «طلبات تبحث عن سائق». وهو ما اشتكى منه المالك.
 *
 *   والعطب الثاني في المسار نفسه: الإلغاء كان تحديثاً منفرداً لصفّ orders. لا
 *   العروض المعلّقة تُلغى — فيبقى بوسع سائق أن يرى بطاقة عرض لطلب انتهى — ولا
 *   السائق المُسنَد يُخبَر وهو في طريقه، ولا يبقى للحدث أثر في audit_log.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: يُوسَّع حين يُسحب نصّ بطاقة القروب من القروب بعد الإلغاء.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { listLiveOrders } from "../../apps/gateway/src/admin/queries.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import {
  cancellationHandlers,
  drainNotificationOutbox,
} from "../support/drain-notification-outbox.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "cancel-secret";
const RIDER_CHAT = 270_001;
const DRIVER_CHAT = 270_002;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1902 };

const config: AppConfig = testConfig({
  port: 3995,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let riderSent: SentMessage[];
let driverSent: SentMessage[];
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
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

async function riderRegisters(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/start"));
  await post("rider", text(RIDER_CHAT, "عبدالله"));
  await post("rider", contact(RIDER_CHAT, "+966500000270"));
  await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
}

/** مشوار كامل حتى يصير الطلب 'searching'. */
async function orderRide(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/ride"));
  await post("rider", callback(RIDER_CHAT, "svc:transport"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
}

/** طرد: نقطة واحدة ووصف — لا وجهة ثانية. */
async function orderDelivery(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/delivery"));
  await post("rider", callback(RIDER_CHAT, "svc:delivery"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
  await post("rider", text(RIDER_CHAT, "شاورما"));
}

async function orderRows(): Promise<{ id: string; service: string; status: string }[]> {
  return sql<{ id: string; service: string; status: string }[]>`
    select id, service, status from orders order by created_at asc`;
}

describeIf("إلغاء الطلب: أي طلب أُلغي، ومن عَلِم به", () => {
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
    // تنظيفُ بياناتِ آخرِ اختبارٍ: الـbeforeEach يقتلعُ كلَّ شيءٍ قبلَ كلِّ
    // اختبارٍ لكن لا شيءَ يقتلعُه بعدَ الأخيرِ — فيبقى سائقُ التوصيلِ المبذورُ
    // (270098) يعلنُ المدينةَ خادمةً للتوصيلِ فيفشلُ quote اللاحقُ.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  }, 30_000);

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    /*
     * بعد D-01، إنشاء الطلب يمرّ عبر `request_ride()` التي تتحقَّقُ من قدرةِ
     * المدينةِ (`city_served_services`): سائقٌ موثَّقٌ مشترِكٌ قادرٌ. الاختباراتُ
     * هنا لا تُنشئ سائقاً بهذا المسارِ (إلّا واحدٌ)، فيُبذَرُ هنا سائقٌ قادرٌ لكنَّهُ
     * غيرُ متاحٍ ولا يملكُ موقعاً حيًّا — فيُشبِعُ شرطَ القدرةِ ويتركُ الطلبَ في
     * `searching` بلا إسنادٍ، وهو ما يحتاجهُ كلُّ اختبارٍ في الملفّ.
     */
    await seedCapableDriver({
      sql,
      cityId,
      service: "transport",
      telegramId: 270_099,
    });
    await seedCapableDriver({
      sql,
      cityId,
      service: "delivery",
      telegramId: 270_098,
    });
    riderSent = [];
    driverSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("طلب واحد: التأكيد يسمّي ما أُلغي، لا «تم إلغاء طلبك» المجرّدة", async () => {
    await riderRegisters();
    await orderRide();

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");

    // النصّ يذكر نوع الخدمة على الأقل: العميل يجب أن يعرف ما الذي انتهى
    const last = riderSent.at(-1)?.text ?? "";
    expect(last).toContain("نقل أشخاص");
  });

  it("العطب الأصلي: طلبان نشطان — /cancel لا يختار عن العميل", async () => {
    await riderRegisters();
    await orderRide();
    await orderDelivery();

    const before = await orderRows();
    expect(before).toHaveLength(2);
    expect(before.every((row) => row.status === "searching")).toBe(true);

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    // قبل الإصلاح: كان يُلغى الأحدث (الطرد) صامتاً ويُقال «تم إلغاء طلبك».
    // بعده: لا يُلغى شيء قبل أن يختار العميل.
    const afterPrompt = await orderRows();
    expect(afterPrompt.every((row) => row.status === "searching")).toBe(true);

    const prompt = riderSent.at(-1);
    expect(prompt?.text).toContain("أكثر من طلب");
    // زرّ لكل طلب — لا زرّ واحد يخفي الآخر
    const keyboard =
      (prompt?.markup as { inline_keyboard?: { callback_data?: string }[][] } | null)
        ?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(2);
    const targets = keyboard.flat().map((button) => button.callback_data);
    expect(targets).toContain(`cancel:${before[0]?.id}`);
    expect(targets).toContain(`cancel:${before[1]?.id}`);
  });

  it("الاختيار يُلغي الطلب المقصود وحده — والمشوار لا يُترك يبحث", async () => {
    await riderRegisters();
    await orderRide();
    await orderDelivery();

    const rows = await orderRows();
    const ride = rows.find((row) => row.service === "transport");
    const delivery = rows.find((row) => row.service === "delivery");
    if (ride === undefined || delivery === undefined) throw new Error("لم يُنشأ الطلبان");

    await post("rider", text(RIDER_CHAT, "/cancel"));
    await post("rider", callback(RIDER_CHAT, `cancel:${ride.id}`));

    const after = await orderRows();
    const rideAfter = after.find((row) => row.id === ride.id);
    const deliveryAfter = after.find((row) => row.id === delivery.id);

    // هذا هو جوهر شكوى المالك: المشوار هو ما أُلغي، لا الطرد
    expect(rideAfter?.status).toBe("cancelled");
    expect(deliveryAfter?.status).toBe("searching");
  });

  it("الإلغاء يترك أثراً في audit_log — لم يكن يترك شيئاً", async () => {
    await riderRegisters();
    await orderRide();
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const logged = await sql<{ action: string; payload: Record<string, unknown> }[]>`
      select action, payload from audit_log where action = 'order.cancelled'`;
    expect(logged).toHaveLength(1);
    expect(logged[0]?.payload.reason).toBe("rider_cancelled");
    expect(logged[0]?.payload.previous_status).toBe("searching");
  });

  it("السائق صاحب العرض المعلّق يُخبَر، ولا يبقى عرضه معلّقاً", async () => {
    // سائق مكتمل التسجيل ومتاح، ليصله عرض حقيقي
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "فهد العتيبي"));
    await post("driver", contact(DRIVER_CHAT, "+966500000271"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000000270"));
    await post("driver", photo(DRIVER_CHAT, "photo_270"));
    await sql`update drivers set verification_status = 'verified'`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial((select id from drivers where user_id = (select id from users where telegram_id = ${DRIVER_CHAT}::bigint))::uuid, 'transport') as result`;
    await post("driver", location(DRIVER_CHAT, PICKUP));
    await post("driver", text(DRIVER_CHAT, "/available"));

    await riderRegisters();
    await orderRide();

    const pending = await sql<{ count: string }[]>`
      select count(*) from order_offers where status = 'pending'`;
    // إن لم يصل عرض فالاختبار لا يقيس ما يدّعي قياسه — نكشف ذلك بدل تمريره
    expect(Number(pending[0]?.count)).toBeGreaterThan(0);

    driverSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const stillPending = await sql<{ count: string }[]>`
      select count(*) from order_offers where status = 'pending'`;
    expect(Number(stillPending[0]?.count)).toBe(0);

    // منذُ BUG-004 يُودَعُ إخطارُ السائقِ في معاملةِ الإلغاءِ ويُسلَّمُ بعدَها من
    // العامل: فيُفرَّغُ الصفُّ هنا كما يُفرِّغُه هو، وإلّا قِيسَ ما لم يُنفَّذْ بعدُ.
    await drainNotificationOutbox(
      sql,
      capturing(driverSent),
      cancellationHandlers(capturing(driverSent)),
    );

    // السائق عَلِم فعلاً — لا مجرّد صفّ تغيّر في القاعدة
    const told = driverSent.some((sent) => sent.text.includes("أُلغي"));
    expect(told).toBe(true);
  });

  /**
   * البند 6.1 — الطلب الملغى يخرج من لوحة الإدارة، لا يبقى «يبحث عن سائق».
   *
   * شكوى المالك يوم 2026-08-11 كانت مركّبة: طلبٌ ظنّ العميل أنه ألغاه بقي
   * 'searching' خمس ساعات، فظلّ ظاهراً في اللوحة. الاختبارات فوق تُثبت أن الصفّ
   * صار 'cancelled'، وهذا يُثبت الشقّ الثاني — أن ما تقرأه اللوحة يتبع الصفّ
   * فعلاً — لأن الحالتين قد تنفصلان: استعلامٌ يقرأ `assigned_driver_id is null`
   * أو `is_active` بدل الحالة يُظهر الملغى إلى الأبد وكل الاختبارات فوقه خضراء.
   */
  it("الطلب الملغى يغيب عن «الطلبات الحية» في لوحة الإدارة", async () => {
    await riderRegisters();
    await orderRide();

    const before = await listLiveOrders(sql, null);
    expect(before).toHaveLength(1);
    const orderId = before[0]?.orderId;
    if (orderId === undefined) throw new Error("لم يُنشأ الطلب");
    expect(before[0]?.status).toBe("searching");

    await post("rider", text(RIDER_CHAT, "/cancel"));

    // الصفّ أُلغي فعلاً — وإلّا فالاختبار التالي يمرّ بلا معنى
    const rows = await orderRows();
    expect(rows[0]?.status).toBe("cancelled");

    const after = await listLiveOrders(sql, null);
    expect(after.map((row) => row.orderId)).not.toContain(orderId);
    expect(after).toHaveLength(0);
  });

  /**
   * البند 5 — دورة الطلب تُغلق بأثرٍ يراه العميل لا بصمت.
   *
   * السطر الذي يُختبر هنا لا تكفيه اختبارات الوحدة: `createPastOrdersLookup`
   * يقرأ `o.status in ('completed','cancelled','failed')` و`coalesce(completed_at,
   * updated_at)` و`ratings.direction`، وكلّها أسماءٌ في القاعدة لا في التايبسكربت.
   * منفذٌ مزدوج يمرّ وإن كان العمود غير موجود أو الحالة غير مسمّاة كما ظنّنا.
   */
  it("الطلب الملغى يظهر في «طلباتي السابقة» بعد الإلغاء لا يختفي", async () => {
    await riderRegisters();
    await orderRide();

    const { createPastOrdersLookup } = await import(
      "../../packages/infrastructure/transport/order-adapters.ts"
    );
    const pastOrdersOf = createPastOrdersLookup(sql);
    const rows = await orderRows();
    const riderId = (await sql<{ rider_id: string }[]>`select rider_id from orders limit 1`)[0]
      ?.rider_id;
    if (riderId === undefined) throw new Error("لم يُنشأ الطلب");

    // قبل الإلغاء: الطلب حيٌّ فلا مكان له في السجلّ — وإلّا فالسجلّ يعرض الجاري
    expect(await pastOrdersOf(riderId as never)).toHaveLength(0);
    expect(rows[0]?.status).toBe("searching");

    await post("rider", text(RIDER_CHAT, "/cancel"));

    const past = await pastOrdersOf(riderId as never);
    expect(past).toHaveLength(1);
    expect(past[0]?.status).toBe("cancelled");
    // لحظة الانتهاء موجودة فعلاً: الملغى لا completed_at له، و`coalesce` هو ما يحميه
    expect(past[0]?.endedAt).not.toBeNull();
    expect(past[0]?.driverName).toBeNull();
    expect(past[0]?.ratingStars).toBeNull();

    // ويُعرض للعميل نفسه عبر /history لا عبر المنفذ وحده
    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/history"));
    expect(riderSent.some((sent) => sent.text.includes("طلباتك السابقة"))).toBe(true);
  });

  it("تصفية المدينة لا تُخفي طلباً حيّاً ولا تُظهر ملغىً", async () => {
    // اللوحة تُفتح مصفّاةً بالمدينة أكثر ممّا تُفتح على «كل المدن»، فالتصفية
    // مسارٌ مستقلّ يجب أن يحمل نفس شرط الحالة لا أن يسقطه مع شرط المدينة
    await riderRegisters();
    await orderRide();
    expect(await listLiveOrders(sql, cityId)).toHaveLength(1);

    await post("rider", text(RIDER_CHAT, "/cancel"));
    expect(await listLiveOrders(sql, cityId)).toHaveLength(0);
  });
});
