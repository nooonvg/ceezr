/**
 * اختبار قاعدة حقيقية للبثّ الجماعي: اختيارُ الجمهور، والعدُّ الذي يساوي ما يُنشأ،
 * ولا رسالةَ مكرّرة، وإعادةُ المحاولة على الفشل العابر لا الدائم، والإلغاءُ الذي
 * يمسّ ما لم يُرسَل فقط، والصلاحيةُ المفروضة في القاعدة لا في المسار.
 *
 * لا يوجد Telegram فعلي هنا: الناشرُ المزدوج يُثبت أثرَ الإرسال وحكمَ الدوام فقط،
 * وكلُّ ما عداه — الاختيارُ والقفلُ والتقدّم — يُنفَّذ على PostgreSQL حقيقية.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverBroadcastBatch } from "../../packages/application/broadcast/deliver-broadcast.ts";
import type {
  BroadcastAudience,
  BroadcastPublisher,
  BroadcastRecipient,
} from "../../packages/application/broadcast/ports.ts";
import {
  createBroadcastAdminPort,
  createBroadcastDeliveryPort,
} from "../../packages/infrastructure/broadcast/broadcast-adapters.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let adminUserId: string;
let plainUserId: string;
/** سائقٌ موثَّق، في تجربةٍ مجانية، ومتاح. */
let verifiedDriverUserId: string;
/** سائقٌ بانتظار التوثيق، بلا اشتراك، وغير متاح. */
let pendingDriverUserId: string;
let riderWithOrderUserId: string;
let riderWithoutOrderUserId: string;

let admin: ReturnType<typeof createBroadcastAdminPort>;
let deliveries: ReturnType<typeof createBroadcastDeliveryPort>;

async function firstId(rows: { id: string }[], what: string): Promise<string> {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر تجهيز ${what}`);
  return id;
}

async function seedUser(
  telegramId: number,
  role: string,
  name: string,
  language = "ar",
): Promise<string> {
  return await firstId(
    await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, ${telegramId}::bigint, ${name}, ${`+96650077${telegramId}`},
              ${role}::user_role, ${language})
      returning id
    `,
    `المستخدم ${name}`,
  );
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = await firstId(city, "مدينة جدة");
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  adminUserId = await seedUser(9001, "admin", "مسؤول البثّ");
  plainUserId = await seedUser(9002, "rider", "راكب لا يملك صفة");

  verifiedDriverUserId = await seedUser(9101, "driver", "سائق موثّق");
  const verifiedDriverId = await firstId(
    await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${verifiedDriverUserId}::uuid, 'verified', 'sedan', 'BC-9101')
      returning id
    `,
    "السائق الموثّق",
  );
  await sql`
    insert into driver_availability (city_id, driver_id, is_available)
    values (${cityId}, ${verifiedDriverId}::uuid, true)
  `;
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount)
    values (${cityId}, ${verifiedDriverId}::uuid, 'transport', 'trialing',
            now() + interval '20 days', 400)
  `;

  pendingDriverUserId = await seedUser(9102, "driver", "سائق بانتظار التوثيق", "ur");
  await sql`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${pendingDriverUserId}::uuid, 'pending', 'sedan', 'BC-9102')
  `;

  riderWithOrderUserId = await seedUser(9201, "rider", "راكب طلب حديثاً");
  const riderWithOrderId = await firstId(
    await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderWithOrderUserId}::uuid)
      returning id
    `,
    "الراكب الطالب",
  );
  await sql`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (${cityId}, ${riderWithOrderId}::uuid, 'transport', 'searching',
            ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography)
  `;

  riderWithoutOrderUserId = await seedUser(9202, "rider", "راكب لم يطلب");
  await sql`
    insert into riders (city_id, user_id) values (${cityId}, ${riderWithoutOrderUserId}::uuid)
  `;
}

/** ناشرٌ يسجّل ما أُرسل، ويُخفق بحسب جدولٍ يُملى عليه — لا شبكةَ ولا تلغرام. */
function fakePublisher(options: {
  readonly failures?: Map<string, { code: string; permanent: boolean }>;
  readonly sent: string[];
}): BroadcastPublisher {
  let sequence = 0;
  return {
    publish: async (recipient: BroadcastRecipient) => {
      const failure = options.failures?.get(recipient.chatId);
      if (failure !== undefined) {
        options.failures?.delete(recipient.chatId);
        return err(failure);
      }
      sequence += 1;
      options.sent.push(`${recipient.chatId}:${recipient.body}`);
      return ok({ messageId: String(5000 + sequence) });
    },
  };
}

function publishers(publisher: BroadcastPublisher): Record<BroadcastAudience, BroadcastPublisher> {
  return { drivers: publisher, riders: publisher };
}

describeIf("البثّ الجماعي على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, broadcast_campaigns, subscriptions, order_offers,
        orders, driver_availability, drivers, riders, users, audit_log
        restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, broadcast_campaigns, subscriptions, order_offers,
        orders, driver_availability, drivers, riders, users, audit_log
        restart identity cascade
    `;
    await createFixture();
    admin = createBroadcastAdminPort(sql);
    deliveries = createBroadcastDeliveryPort(sql);
  });

  it("العدّ يساوي ما يُنشأ فعلاً، ولا يخلط جمهوراً بجمهور", async () => {
    const counted = await admin.count({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
    });
    expect(counted.ok).toBe(true);
    if (!counted.ok || "error" in counted.value) throw new Error("تعذّر العدّ");
    expect(counted.value.total).toBe(2);

    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "تحديث تشغيلي للسائقين",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");
    // العددُ المُعاين والمُنشأ من نفس الدالّة: لو اختلفا لكان المسؤول يوافق على
    // رقمٍ ويُرسل إلى غيره — وهو أسوأ عطبٍ ممكن في رسالةٍ جماعية.
    expect(created.value.total).toBe(counted.value.total);

    const rows = await sql<{ user_id: string }[]>`
      select r.recipient_user_id as user_id from notification_outbox r
      join broadcast_campaigns c on c.id = r.broadcast_campaign_id
      where r.kind = 'broadcast_recipient' and c.batch_id = ${created.value.batchId}::uuid
    `;
    const ids = new Set(rows.map((row) => row.user_id));
    expect(ids.size).toBe(2);
    expect(ids.has(verifiedDriverUserId)).toBe(true);
    expect(ids.has(pendingDriverUserId)).toBe(true);
    expect(ids.has(riderWithOrderUserId)).toBe(false);
    expect(ids.has(adminUserId)).toBe(false);
  });

  it("المرشّحات تُضيّق الجمهور فعلاً: توثيق، واشتراك، وجاهزية، ولغة", async () => {
    const count = async (
      filters: Parameters<typeof admin.count>[0]["filters"],
    ): Promise<number> => {
      const result = await admin.count({
        actorUserId: adminUserId,
        cityId,
        audience: "drivers",
        filters,
      });
      if (!result.ok || "error" in result.value) throw new Error("تعذّر العدّ");
      return result.value.total;
    };

    expect(await count({ verification: ["verified"] })).toBe(1);
    expect(await count({ verification: ["pending"] })).toBe(1);
    expect(await count({ verification: ["rejected"] })).toBe(0);
    expect(await count({ subscription: ["trialing"] })).toBe(1);
    expect(await count({ subscription: ["none"] })).toBe(1);
    expect(await count({ subscription: ["none", "trialing"] })).toBe(2);
    expect(await count({ availability: "available" })).toBe(1);
    expect(await count({ availability: "unavailable" })).toBe(1);
    expect(await count({ languages: ["ur"] })).toBe(1);
    expect(await count({ languages: ["ar", "ur"] })).toBe(2);

    const riders = async (
      filters: Parameters<typeof admin.count>[0]["filters"],
    ): Promise<number> => {
      const result = await admin.count({
        actorUserId: adminUserId,
        cityId,
        audience: "riders",
        filters,
      });
      if (!result.ok || "error" in result.value) throw new Error("تعذّر العدّ");
      return result.value.total;
    };
    // ثلاثةُ ركّاب: اثنان مزروعان بملفّ راكب، والمسؤولُ ليس راكباً فلا يُحتسب.
    expect(await riders({})).toBe(2);
    expect(await riders({ activity: "ordered_recently" })).toBe(1);
    expect(await riders({ activity: "never_ordered" })).toBe(1);
  });

  it("المحظور لا يُراسَل ولو طابق المرشّحات", async () => {
    await sql`update users set is_blocked = true where id = ${pendingDriverUserId}::uuid`;
    const counted = await admin.count({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
    });
    if (!counted.ok || "error" in counted.value) throw new Error("تعذّر العدّ");
    expect(counted.value.total).toBe(1);
  });

  it("جمهورٌ فارغ يُرفض ولا يُنشئ حملةً بلا مستقبِلين", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: { verification: ["rejected"] },
      body: "رسالة لا تجد أحداً",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok) throw new Error("تعذّر النداء");
    expect("error" in created.value ? created.value.error : "").toBe("EMPTY_AUDIENCE");
    const campaigns = await sql<{ count: string }[]>`select count(*) from broadcast_campaigns`;
    expect(Number(campaigns[0]?.count ?? -1)).toBe(0);
  });

  it("من ليس مسؤولاً لا يُنشئ بثّاً ولا يعدّ جمهوراً ولا يُلغي", async () => {
    const counted = await admin.count({
      actorUserId: plainUserId,
      cityId,
      audience: "drivers",
      filters: {},
    });
    if (!counted.ok) throw new Error("تعذّر النداء");
    expect("error" in counted.value ? counted.value.error : "").toBe("NOT_ADMIN");

    const created = await admin.create({
      actorUserId: plainUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "محاولة من غير مسؤول",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok) throw new Error("تعذّر النداء");
    expect("error" in created.value ? created.value.error : "").toBe("NOT_ADMIN");
  });

  it("الرابط يُرفض إن كان بلا نصّ زرّ، أو بغير https", async () => {
    const attempt = async (linkLabel: string | null, linkUrl: string | null): Promise<string> => {
      const result = await admin.create({
        actorUserId: adminUserId,
        cityId,
        audience: "drivers",
        filters: {},
        body: "رسالة بزرّ",
        linkLabel,
        linkUrl,
        silent: false,
        sendAfter: null,
      });
      if (!result.ok) throw new Error("تعذّر النداء");
      return "error" in result.value ? result.value.error : "OK";
    };

    expect(await attempt("اضغط", null)).toBe("INCOMPLETE_LINK");
    expect(await attempt(null, "https://example.com")).toBe("INCOMPLETE_LINK");
    expect(await attempt("اضغط", "http://example.com")).toBe("INVALID_LINK_URL");
    expect(await attempt("اضغط", "https://example.com")).toBe("OK");
  });

  it("يسلّم كل مستقبِل مرّة واحدة، ثم لا يجد ما يسلّمه", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "رسالة تُسلَّم مرّة واحدة",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    const sent: string[] = [];
    const first = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!first.ok) throw new Error("تعذّر التسليم");
    expect(first.value).toEqual({ claimed: 2, sent: 2, failed: 0, retried: 0 });

    // الشوطُ الثاني هو الاختبار الحقيقي: صفٌّ سُلّم ثم عاد `pending` يعني رسالةً
    // جماعية مكرّرة على كلّ سائقٍ في المدينة، وهو عطبٌ لا يُغتفر تجارياً.
    const second = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!second.ok) throw new Error("تعذّر التسليم");
    expect(second.value.claimed).toBe(0);
    expect(sent.length).toBe(2);

    const campaign = await sql<{ status: string; recipients_total: number }[]>`
      select status, recipients_total from broadcast_campaigns
      where batch_id = ${created.value.batchId}::uuid
    `;
    // الحملةُ تُغلق نفسها في القاعدة: «جارٍ الإرسال» أبديّة تكذب على المشغّل.
    expect(campaign[0]?.status).toBe("completed");
    expect(Number(campaign[0]?.recipients_total)).toBe(2);
  });

  it("الفشل العابر يُعاد، والفشل الدائم لا يُعاد", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "رسالة تُخفق مرّة",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    const sent: string[] = [];
    const failures = new Map([
      ["9101", { code: "429", permanent: false }],
      ["9102", { code: "403", permanent: true }],
    ]);
    const first = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ failures, sent })),
    });
    if (!first.ok) throw new Error("تعذّر التسليم");
    expect(first.value).toEqual({ claimed: 2, sent: 0, failed: 1, retried: 1 });

    const rows = await sql<{ chat_id: string; status: string; attempts: number }[]>`
      select chat_id::text, status, attempts from notification_outbox
      where kind = 'broadcast_recipient'
      order by chat_id
    `;
    expect(rows.map((row) => `${row.chat_id}:${row.status}`)).toEqual([
      "9101:pending",
      "9102:failed",
    ]);

    // موعدُ الإعادة يُقرأ من إعدادات المدينة، فالشوطُ التالي لا يلتقط الصفَّ قبله.
    const tooEarly = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!tooEarly.ok) throw new Error("تعذّر التسليم");
    expect(tooEarly.value.claimed).toBe(0);

    await sql`update notification_outbox set next_attempt_at = now() where kind = 'broadcast_recipient' and status = 'pending'`;
    const retried = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!retried.ok) throw new Error("تعذّر التسليم");
    expect(retried.value).toEqual({ claimed: 1, sent: 1, failed: 0, retried: 0 });
    expect(sent).toEqual(["9101:رسالة تُخفق مرّة"]);

    const campaign = await sql<{ status: string }[]>`
      select status from broadcast_campaigns where batch_id = ${created.value.batchId}::uuid
    `;
    // فشلٌ دائمٌ لواحد لا يُبقي الحملة معلّقةً إلى الأبد.
    expect(campaign[0]?.status).toBe("completed");
  });

  it("الإلغاء يمسّ ما لم يُرسَل فقط، ولا يلمس ما سُلّم", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "رسالة تُلغى في منتصفها",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    // مستقبِلٌ واحدٌ فقط يُسلَّم: نُبعِد موعدَ الآخر كي يبقى `pending`.
    await sql`
      update notification_outbox set next_attempt_at = now() + interval '1 hour'
      where kind = 'broadcast_recipient' and chat_id = 9102
    `;
    const sent: string[] = [];
    const run = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!run.ok) throw new Error("تعذّر التسليم");
    expect(run.value.sent).toBe(1);

    const canceled = await admin.cancel({
      actorUserId: adminUserId,
      batchId: created.value.batchId,
    });
    if (!canceled.ok || "error" in canceled.value) throw new Error("تعذّر الإلغاء");
    expect(canceled.value.canceled).toBe(1);

    const rows = await sql<{ chat_id: string; status: string }[]>`
      select chat_id::text, status from notification_outbox
      where kind = 'broadcast_recipient' order by chat_id
    `;
    expect(rows.map((row) => `${row.chat_id}:${row.status}`)).toEqual([
      "9101:delivered",
      "9102:canceled",
    ]);

    const campaign = await sql<{ status: string }[]>`
      select status from broadcast_campaigns where batch_id = ${created.value.batchId}::uuid
    `;
    expect(campaign[0]?.status).toBe("canceled");

    // وبعد الإلغاء لا يُسلَّم شيء: إلغاءٌ يُعلَن ثم تُرسَل الرسالة بعده أسوأ من لا إلغاء.
    const after = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!after.ok) throw new Error("تعذّر التسليم");
    expect(after.value.claimed).toBe(0);
    expect(sent.length).toBe(1);
  });

  it("بثٌّ إلى كلّ المدن يُنشئ صفّاً لكلّ مدينة بمعرّف دفعةٍ واحد", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId: null,
      audience: "drivers",
      filters: {},
      body: "رسالة لكلّ المدن",
      linkLabel: null,
      linkUrl: null,
      silent: true,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");
    // سائقو جدّة وحدهم مزروعون، فمدنٌ بلا سائقٍ لا تُنشئ صفّاً فارغاً.
    expect(created.value.cities.length).toBe(1);
    expect(created.value.total).toBe(2);

    const audits = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'broadcast.created'
    `;
    expect(Number(audits[0]?.count ?? 0)).toBe(1);
  });

  it("الجدولة تُؤخّر الالتقاط إلى موعدها", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "riders",
      filters: {},
      body: "رسالة مجدولة",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    const sent: string[] = [];
    const early = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!early.ok) throw new Error("تعذّر التسليم");
    expect(early.value.claimed).toBe(0);
    expect(sent.length).toBe(0);
  });
  /**
   * عاملٌ حجز رسالةً ثمّ مات قبل أن يُعلن نتيجتها — نشرٌ، أو إعادةُ تشغيل، أو
   * نفادُ ذاكرة. الصفُّ كان يبقى في `sending` إلى الأبد: الحجزُ لا يلتقط إلّا
   * `pending`، والإلغاءُ لا يمسّ `sending`، والحملةُ لا تُختم لأنّ ختمَها محسوبٌ
   * على «لا معلَّقٌ ولا جارٍ». فرسالةٌ لا تصل وحملةٌ معلَّقةٌ في اللوحة أبداً.
   */
  it("الحجزُ المتروك بعد موتِ العامل يُسترجَع فتصل الرسالة وتُختم الحملة", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "drivers",
      filters: {},
      body: "رسالة يُهجَر حجزُها",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    // شوطٌ يحجز ثمّ يموت: نحجز عبر الميناء نفسه ولا نُعلن شيئاً.
    const abandoned = await deliveries.claim(cityId);
    if (!abandoned.ok) throw new Error("تعذّر الحجز");
    expect(abandoned.value.length).toBe(2);

    const stuck = await sql<{ count: string }[]>`
      select count(*) from notification_outbox where kind = 'broadcast_recipient' and status = 'sending'
    `;
    expect(Number(stuck[0]?.count)).toBe(2);

    // شوطٌ تالٍ قبل انقضاء المهلة لا يسحب الصفَّ من عاملٍ قد يكون حيّاً.
    const tooEarly = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent: [] })),
    });
    if (!tooEarly.ok) throw new Error("تعذّر التسليم");
    expect(tooEarly.value.claimed).toBe(0);

    // نُقدّم لحظةَ الحجز إلى ما قبل المهلة: هذا هو مرورُ الوقت في الاختبار.
    await sql`
      update notification_outbox
         set claimed_at = now() - make_interval(secs => 1200)
       where kind = 'broadcast_recipient' and status = 'sending'
    `;

    const sent: string[] = [];
    const recovered = await deliverBroadcastBatch(cityId, {
      deliveries,
      publishers: publishers(fakePublisher({ sent })),
    });
    if (!recovered.ok) throw new Error("تعذّر التسليم");
    expect(recovered.value).toEqual({ claimed: 2, sent: 2, failed: 0, retried: 0 });
    expect(sent.length).toBe(2);

    const rows = await sql<{ status: string; attempts: number; claimed_at: Date | null }[]>`
      select status, attempts, claimed_at from notification_outbox
      where kind = 'broadcast_recipient'
    `;
    for (const row of rows) {
      expect(row.status).toBe("delivered");
      // المحاولةُ تُعدّ عند الاسترجاع كذلك: سقفُ المحاولات يحدّ الاسترجاعَ
      // فلا يدور صفٌّ معطوبٌ بلا نهاية.
      expect(row.attempts).toBe(2);
      // لحظةُ الحجز تُخلى بعد الإعلان، فلا تُحسب مهلةٌ من حجزٍ قديم.
      expect(row.claimed_at).toBeNull();
    }

    const campaign = await sql<{ status: string }[]>`
      select status from broadcast_campaigns where batch_id = ${created.value.batchId}::uuid
    `;
    expect(campaign[0]?.status).toBe("completed");
  });

  /**
   * العاملُ الميّت لو عاد إلى الحياة بعد الاسترجاع وأعلن نتيجته، لأعلن فوق حجزٍ
   * لم يبقَ له — فيُسلّم صفّاً يُسلّمه غيرُه الآن. الرمزُ الجديد يمنعه.
   */
  it("العاملُ العائد بعد الاسترجاع لا يُعلن فوق حجزٍ لم يبقَ له", async () => {
    const created = await admin.create({
      actorUserId: adminUserId,
      cityId,
      audience: "riders",
      filters: {},
      body: "رسالة يعود عاملُها متأخّراً",
      linkLabel: null,
      linkUrl: null,
      silent: false,
      sendAfter: null,
    });
    if (!created.ok || "error" in created.value) throw new Error("تعذّر إنشاء البثّ");

    const stale = await deliveries.claim(cityId);
    if (!stale.ok) throw new Error("تعذّر الحجز");
    const first = stale.value[0];
    if (first === undefined) throw new Error("لا مستقبِل");

    await sql`
      update notification_outbox
         set claimed_at = now() - make_interval(secs => 1200)
       where kind = 'broadcast_recipient' and status = 'sending'
    `;
    const fresh = await deliveries.claim(cityId);
    if (!fresh.ok) throw new Error("تعذّر الحجز الثاني");
    expect(fresh.value.length).toBeGreaterThan(0);

    const late = await deliveries.finish({
      recipientId: first.recipientId,
      claimToken: first.claimToken,
      messageId: "999",
      delivered: true,
      permanent: false,
      errorCode: null,
    });
    expect(late.ok).toBe(false);

    const row = await sql<{ status: string; message_id: string | null }[]>`
      select status, delivered_message_id as message_id from notification_outbox
      where kind = 'broadcast_recipient' and id = ${first.recipientId}
    `;
    // ما زال محجوزاً للشوط الجديد: إعلانُ العامل المتأخّر لم يمرّ.
    expect(row[0]?.status).toBe("sending");
    expect(row[0]?.message_id).toBeNull();
  });
});
