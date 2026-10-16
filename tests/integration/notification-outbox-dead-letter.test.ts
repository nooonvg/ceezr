/**
 * اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لطابورِ الموتى في صندوقِ الصادرِ
 *   (`CAP-002`/`F6-04`). العطبُ المُغطّى ههنا أنَّ `finish_notification_delivery`
 *   كانت تُعيدُ الصفَّ إلى `pending` عندَ كلِّ إخفاقٍ **بلا سقفٍ**، فصفٌّ إلى
 *   محادثةٍ حظرَتِ البوتَ يُعادُ محاولتُه أبدَ الدهرِ. و`claim` كانت تحسبُ
 *   `max_attempts` وتُعيدُها **ولا أحدَ يُنفِّذُها**.
 *
 * ولا تيليجرامَ ههنا: النداءُ على المنفذِ مباشرةً كي يُختبَرَ حكمُ القاعدةِ وحدَه
 * لا حكمُ مُرسِلٍ مزدوجٍ فوقَه.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferWriter } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const MAX_ATTEMPTS = 3;
const RETRY_SECONDS = 30;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let driverId: string;

interface OutboxRow {
  readonly status: string;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly dead_reason: string | null;
  readonly died_at: Date | null;
  readonly delay_seconds: number;
}

async function readRow(): Promise<OutboxRow> {
  const rows = await sql<OutboxRow[]>`
    select status, attempts, last_error, dead_reason, died_at,
           extract(epoch from (next_attempt_at - now()))::float8 as delay_seconds
      from notification_outbox where order_id = ${orderId}::uuid
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لا صفَّ في صندوقِ الصادرِ");
  return row;
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  // السقفُ والأساسُ يُثبَّتانِ صراحةً: اختبارٌ يعتمدُ على قيمةٍ مبذورةٍ في هجرةٍ
  // أخرى ينكسرُ يومَ تُغيَّرُ تلك القيمةُ لسببٍ لا علاقةَ له به.
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values
      (${cityId}, 'notification_delivery_max_attempts',
       to_jsonb(${MAX_ATTEMPTS}::int), 'number', 'سقفُ محاولاتِ تسليمِ الإشعارِ'),
      (${cityId}, 'notification_delivery_retry_seconds',
       to_jsonb(${RETRY_SECONDS}::int), 'number', 'أساسُ التراجعِ بينَ محاولاتِ التسليمِ')
    on conflict (city_id, key) do update set value = excluded.value
  `;

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 880012::bigint, 'راكب', '+966500880012', 'rider')
    returning id
  `;
  const rider = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid)
    returning id
  `;
  const driverUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 990011::bigint, 'سائق', '+966500990011', 'driver')
    returning id
  `;
  const drv = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUser[0]?.id ?? ""}::uuid, 'verified'::verification_status)
    returning id
  `;
  driverId = drv[0]?.id ?? "";

  const order = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (
      ${cityId}, ${rider[0]?.id ?? ""}::uuid, 'transport', 'searching',
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography
    )
    returning id
  `;
  orderId = order[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذّر تجهيز الطلب");

  const written = await createOfferWriter(sql).openRound({
    orderId: orderId as OrderId,
    cityId: cityId as CityId,
    round: 1,
    entries: [{ driverId: driverId as DriverId, score: 10, distanceKm: 1.5 as DistanceKm }],
    expiresAt: new Date(Date.now() + 45_000),
  });
  if (!written.ok || !written.value.opened) throw new Error("فشل فتح الدورة");
}

/** يُتيحُ الالتقاطَ فوراً بإلغاءِ التأجيلِ — بدلَ انتظارِ التراجعِ حقيقةً. */
async function makeClaimable(): Promise<void> {
  await sql`update notification_outbox set next_attempt_at = now() where order_id = ${orderId}::uuid`;
}

describeIf("طابورُ الموتى في صندوقِ الصادرِ على PostgreSQL فعلية (CAP-002)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  }, 60_000);

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  // مهلةُ الخُطّافِ صريحةٌ: `beforeEach` هنا يُفرِّغُ سبعةَ جداولٍ ويبذُرُ مدينةً
  // وراكباً وسائقاً وطلباً ودورةَ عرضٍ، وذاكَ يتجاوزُ خمسَ ثوانٍ — مهلةَ الخُطّافِ
  // الافتراضيّةَ — على وصلةٍ بعيدةٍ أو عاملٍ مزدحمٍ. ومهلةٌ ضيقةٌ تُخفِقُ لبطءِ
  // بيئةٍ فتُقرأُ كعطبٍ في المنطقِ وهو سليمٌ.
  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;
    await createFixture();
  }, 60_000);

  it("الإخفاقُ دونَ السقفِ يُعيدُ الصفَّ pending ويحفظُ آخرَ خطأٍ", async () => {
    const outbox = createNotificationOutboxPort(sql);
    const claimed = await outbox.claim();
    expect(claimed.ok).toBe(true);
    if (!claimed.ok || claimed.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");

    const finished = await outbox.finish({
      deliveryId: claimed.value.delivery.deliveryId,
      claimToken: claimed.value.delivery.claimToken,
      messageId: null,
      error: "انقطاعُ شبكةٍ",
    });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.value.outcome).toBe("retried");

    const row = await readRow();
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    // السببُ محفوظٌ لا مُلقًى في سجلٍّ يُدوَّرُ: من نظرَ في الصفِّ عرفَ لمَ تأخّرَ.
    expect(row.last_error).toBe("انقطاعُ شبكةٍ");
    expect(row.died_at).toBeNull();
  });

  it("التراجعُ أُسّيٌّ: المحاولةُ الثانيةُ تُؤجَّلُ أطولَ من الأولى", async () => {
    const outbox = createNotificationOutboxPort(sql);
    const delays: number[] = [];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await makeClaimable();
      const claimed = await outbox.claim();
      if (!claimed.ok || claimed.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");
      await outbox.finish({
        deliveryId: claimed.value.delivery.deliveryId,
        claimToken: claimed.value.delivery.claimToken,
        messageId: null,
        error: `إخفاقٌ ${attempt}`,
      });
      delays.push((await readRow()).delay_seconds);
    }

    // الأساسُ ثلاثونَ ثانيةً، والرَّجرجةُ تُضيفُ حتى ربعِ الفترةِ ولا تُنقِصُ منها.
    // فالمدى مُحكَمٌ لا رقمٌ واحدٌ — والرَّجرجةُ مقصودةٌ ضدَّ عودةِ القطيعِ معاً.
    const first = delays[0] ?? 0;
    const second = delays[1] ?? 0;
    expect(first).toBeGreaterThanOrEqual(RETRY_SECONDS - 1);
    expect(first).toBeLessThanOrEqual(RETRY_SECONDS * 1.25 + 1);
    expect(second).toBeGreaterThanOrEqual(RETRY_SECONDS * 2 - 1);
    expect(second).toBeLessThanOrEqual(RETRY_SECONDS * 2 * 1.25 + 1);
  });

  it("استنفادُ السقفِ يُميتُ الصفَّ بـMAX_ATTEMPTS ولا يُلتقَطُ بعدَها أبداً", async () => {
    const outbox = createNotificationOutboxPort(sql);
    const outcomes: (string | null)[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await makeClaimable();
      const claimed = await outbox.claim();
      if (!claimed.ok || claimed.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");
      expect(claimed.value.delivery.maxAttempts).toBe(MAX_ATTEMPTS);
      const finished = await outbox.finish({
        deliveryId: claimed.value.delivery.deliveryId,
        claimToken: claimed.value.delivery.claimToken,
        messageId: null,
        error: "المستخدمُ حظرَ البوتَ",
      });
      if (!finished.ok) throw new Error("تعذّرَ إعلانُ النتيجةِ");
      outcomes.push(finished.value.outcome);
    }

    expect(outcomes).toEqual(["retried", "retried", "dead"]);

    const row = await readRow();
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.dead_reason).toBe("MAX_ATTEMPTS");
    expect(row.died_at).not.toBeNull();
    expect(row.last_error).toBe("المستخدمُ حظرَ البوتَ");

    // وهذا صميمُ CAP-002: الميّتُ لا يُلتقَطُ ثانيةً مهما مضى من وقتٍ.
    await makeClaimable();
    const again = await outbox.claim();
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.delivery).toBeNull();
  });

  it("التخلّي الصريحُ يُسجِّلُ سببَه ولحظتَه", async () => {
    const outbox = createNotificationOutboxPort(sql);
    const claimed = await outbox.claim();
    if (!claimed.ok || claimed.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");

    const abandoned = await outbox.abandon({
      deliveryId: claimed.value.delivery.deliveryId,
      claimToken: claimed.value.delivery.claimToken,
      reason: "العرضُ انتهت مهلتُه",
    });
    expect(abandoned.ok).toBe(true);

    const row = await readRow();
    expect(row.status).toBe("dead");
    expect(row.dead_reason).toBe("العرضُ انتهت مهلتُه");
    expect(row.died_at).not.toBeNull();
  });

  it("التسليمُ الناجحُ يمسحُ آخرَ خطأٍ فلا يبقى أثرُ إخفاقٍ عولِجَ", async () => {
    const outbox = createNotificationOutboxPort(sql);

    const first = await outbox.claim();
    if (!first.ok || first.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");
    await outbox.finish({
      deliveryId: first.value.delivery.deliveryId,
      claimToken: first.value.delivery.claimToken,
      messageId: null,
      error: "عطلٌ عابرٌ",
    });
    expect((await readRow()).last_error).toBe("عطلٌ عابرٌ");

    await makeClaimable();
    const second = await outbox.claim();
    if (!second.ok || second.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");
    const finished = await outbox.finish({
      deliveryId: second.value.delivery.deliveryId,
      claimToken: second.value.delivery.claimToken,
      messageId: "msg-9",
      error: null,
    });
    if (!finished.ok) throw new Error("تعذّرَ إعلانُ النتيجةِ");

    expect(finished.value.outcome).toBe("delivered");
    const row = await readRow();
    expect(row.status).toBe("delivered");
    expect(row.last_error).toBeNull();
  });

  it("رمزٌ لا يملكُ الصفَّ يُرفَضُ ولا يُغيِّرُ حالاً", async () => {
    const outbox = createNotificationOutboxPort(sql);
    const claimed = await outbox.claim();
    if (!claimed.ok || claimed.value.delivery === null) throw new Error("لم يُلتقَط صفٌّ");

    const rows = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select finish_notification_delivery(
        ${claimed.value.delivery.deliveryId}::uuid,
        gen_random_uuid(), null::text, false, 'دخيلٌ'::text
      ) result
    `;
    expect(rows[0]?.result.ok).toBe(false);
    expect(rows[0]?.result.error).toBe("NOT_CLAIMED_BY_CALLER");

    // الصفُّ ما زالَ محجوزاً لصاحبِه: لا مُنتحِلٌ يُميتُ صفَّ غيرِه.
    const row = await readRow();
    expect(row.status).toBe("sending");
    expect(row.last_error).toBeNull();
  });
});
