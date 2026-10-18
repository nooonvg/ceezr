/**
 * `LOAD-01 · P4` — انحدارُ عنقِ موجةِ 500: الجولةُ الحيّةُ لا تحجبُ الطلبَ الذي لم يُعرَض.
 *
 * السببُ المقيسُ (موجةُ 500 على `1ac6b860`، الأثرُ في
 * `docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/b9-trace500/`):
 * النافذةُ العادلةُ (أقدمُ 50 غيرِ مستنفدٍ) كانت تُقدِّمُ الطلبَ الأقدمَ ولو كانت جولتُه
 * الأخيرةُ حيّةً (عرضٌ معلَّقٌ لم تنقضِ مهلتُه 45ث)، فذهبَ 38.6% من مقاعدِ الشوطِ إلى
 * إعادةِ بثِّها بعدَ ≤3.8ث من سابقتِها، وانتظرَ الطلبُ الجديدُ ~35ث قبلَ أوّلِ معالجةٍ.
 *
 * يُثبَتُ هنا على القاعدةِ الحقيقيّةِ:
 *  1. الطلبُ الجديدُ (دورةُ 0) يدخلُ نافذةً يملؤها أقدمُ منه جولتُه حيّةٌ حديثةٌ — كانَ يسقطُ.
 *  2. لا تجويعَ: الحيُّ بعدَ مهلةِ السماحِ (فاتَت جولتُه سائقَه) والمنقضيةُ جولتُه يسبقانِ الأحدثَ.
 *  3. لا استبعادَ: الحيُّ الحديثُ يملأُ ما فضلَ من النافذةِ، والمستنفدُ يبقى آخراً.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  LIVE_ROUND_ESCALATION_GRACE_SECONDS,
  redispatchSearchingOrders,
} from "../../packages/application/dispatch/redispatch-searching-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import { type CityId, systemClock } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const describeIf = DATABASE_URL === "" ? describe.skip : describe;

let sql: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let driverUserId: string;
let driverRowId: string;
const created: string[] = [];
const TG_RIDER = 8_817_001;
const TG_DRIVER = 8_817_101;
const MAX_ROUNDS = 3;
const PICKUP = "SRID=4326;POINT(39.1728 21.5433)";

beforeAll(async () => {
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  city = await ensureActiveCity(sql);
  cityId = city.cityId as CityId;
  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG_RIDER})
      on conflict (telegram_id) do update set telegram_id = excluded.telegram_id returning id`;
  if (rider === undefined) throw new Error("users: لم يُدرَج الصفُّ");
  const [riderRow] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}::uuid, ${rider.id}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
  if (riderRow === undefined) throw new Error("riders: لم يُدرَج الصفُّ");
  riderId = riderRow.id;
  // عزلٌ: طلباتُ المدينةِ الباحثةُ الأخرى تُفسدُ ترتيبَ النافذةِ — لا يُقرأُ إلّا ما أنشأه الاختبار.
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from orders where rider_id = ${riderId}::uuid`;
  driverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER,
    name: "سائق أولوية الجولة الحية",
  });
  const [u] = await sql<
    { id: string }[]
  >`select user_id as id from drivers where id = ${driverRowId}::uuid`;
  if (u === undefined) throw new Error("drivers: الصف غير موجود");
  driverUserId = u.id;
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  if (created.length) {
    await sql`delete from notification_outbox where order_id = any(${created}::uuid[])`;
    await sql`delete from order_offers where order_id = any(${created}::uuid[])`;
    await sql`delete from orders where id = any(${created}::uuid[])`;
  }
  await sql`delete from driver_availability where driver_id = ${driverRowId}::uuid`;
  await sql`delete from drivers where id = ${driverRowId}::uuid`;
  await sql`delete from riders where id = ${riderId}::uuid`;
  await sql`delete from users where id in (${driverUserId}::uuid) or telegram_id = ${TG_RIDER}`;
  await restoreCityBaseline(sql, city);
  await sql.end();
});

async function order(round: number, agoSec: number): Promise<string> {
  const at = new Date(Date.now() - agoSec * 1000);
  const [o] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
    values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${PICKUP}::geography,
            ${round}, ${at}, ${at})
    returning id`;
  if (o === undefined) throw new Error("orders: لم يُدرَج الطلبُ");
  created.push(o.id);
  return o.id;
}

/**
 * عرضٌ معلَّقٌ في الجولةِ الحاليّةِ؛ `expiresInSec` سالبٌ = انقضت مهلتُه، و`openedAgoSec`
 * عمرُ الجولةِ (حديثةٌ دونَ مهلةِ السماحِ أو أقدمُ منها).
 */
async function pendingOffer(
  orderId: string,
  round: number,
  expiresInSec: number,
  openedAgoSec = 0,
): Promise<void> {
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, score, distance_km, status, expires_at, created_at)
    values (${cityId}::uuid, ${orderId}::uuid, ${driverRowId}::uuid, ${round}, 1, 0.1, 'pending',
            now() + make_interval(secs => ${expiresInSec}), now() - make_interval(secs => ${openedAgoSec}))`;
}

async function window(limit: number): Promise<string[]> {
  const found = await createSearchingOrderFinder(sql).findSearching(cityId, limit, {
    maxBroadcastRounds: MAX_ROUNDS,
    liveRoundGraceSeconds: LIVE_ROUND_ESCALATION_GRACE_SECONDS,
  });
  if (!found.ok) throw new Error(found.error.detail);
  return found.value.map((o) => o.orderId).filter((id) => created.includes(id));
}

describeIf("LOAD-01 P4 — الجولة الحية لا تحجب الطلب الذي لم يُعرَض", () => {
  it("الجولةُ الحيّةُ الحديثةُ تتأخّرُ، والحيّةُ بعدَ مهلةِ السماحِ والمنقضيةُ والجديدُ بترتيبِ العمرِ، والمستنفدُ آخراً", async () => {
    const freshLive: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await order(1, 300 - i);
      await pendingOffer(id, 1, 44, 0); // فُتحت للتوِّ: سائقُها لم يرَها بعدُ
      freshLive.push(id);
    }
    // فاتَتْ جولتُها سائقَها: حيّةٌ (35ث باقيةٌ) لكنْ أقدمُ من مهلةِ السماحِ — مستحقّةٌ الآنَ.
    const staleLive = await order(1, 250);
    await pendingOffer(staleLive, 1, 35, LIVE_ROUND_ESCALATION_GRACE_SECONDS + 7);
    const expired = await order(1, 200);
    await pendingOffer(expired, 1, -5, 50);
    const exhausted = await order(MAX_ROUNDS, 400);
    const fresh = await order(0, 1);

    // نافذةٌ بقدرِ الحيِّ الحديثِ: قبلَ الإصلاحِ = الأربعةُ الأقدمُ الحديثةُ الجولةِ وحدَها،
    // وتأخيرُ كلِّ حيٍّ حتى انقضائِه (التجربةُ «أ») كانَ يُسقِطُ staleLive خلفَ الجديدِ.
    const narrow = await window(4);
    expect(narrow.slice(0, 3)).toEqual([staleLive, expired, fresh]);

    // نافذةٌ واسعةٌ: لا استبعاد.
    const wide = await window(50);
    expect(wide).toEqual([staleLive, expired, fresh, ...freshLive, exhausted]);
  });

  it("الشوطُ يقرأُ إعداداتِ المدينةِ مرّةً واحدةً مهما عدَدُ طلباتِه (لا رحلةَ لكلِّ طلبٍ)", async () => {
    const ids = [await order(0, 30), await order(0, 20), await order(0, 10)];
    const settings = createSettingsRepository(sql);
    let reads = 0;
    const counted = {
      ...settings,
      findByCity: (id: Parameters<typeof settings.findByCity>[0]) => {
        reads += 1;
        return settings.findByCity(id);
      },
    };
    const report = await redispatchSearchingOrders(cityId, {
      finder: createSearchingOrderFinder(sql),
      broadcast: {
        orders: createOrderRepository(sql),
        offers: createOfferRepository(sql),
        candidates: createDriverCandidateRepository(sql),
        settings: counted,
        offerWriter: createOfferWriter(sql),
        clock: systemClock,
      },
      limit: 50,
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // الطلباتُ الثلاثةُ فُحصت فعلاً (لا سائقَ متاحاً قربَها في هذا الاختبارِ فلا عرضَ)،
    // وقبلَ الإصلاحِ كانت القراءاتُ 1 + عددَ المفحوصِ (13 على قاعدةِ الاختبارِ المشتركةِ).
    expect(report.value.examined).toBeGreaterThanOrEqual(ids.length);
    expect(reads).toBe(1);
  });
});
