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
 *  1. الطلبُ الجديدُ (دورةُ 0) يدخلُ نافذةً يملؤها ما هو أقدمُ منه وجولتُه حيّة — كانَ يسقطُ.
 *  2. لا تجويعَ: الأقدمُ المنقضيةُ جولتُه يسبقُ الجديدَ (قابلٌ للعرضِ وأقدمُ).
 *  3. لا استبعادَ: الحيُّ يملأُ ما فضلَ من النافذةِ، والمستنفدُ يبقى آخراً.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSearchingOrderFinder } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
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
  const [u] = await sql<{ id: string }[]>`select user_id as id from drivers where id = ${driverRowId}::uuid`;
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

/** عرضٌ معلَّقٌ في الجولةِ الحاليّةِ؛ `expiresInSec` سالبٌ = انقضت مهلتُه. */
async function pendingOffer(orderId: string, round: number, expiresInSec: number): Promise<void> {
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
    values (${cityId}::uuid, ${orderId}::uuid, ${driverRowId}::uuid, ${round}, 1, 0.1, 'pending',
            now() + make_interval(secs => ${expiresInSec}))`;
}

async function window(limit: number): Promise<string[]> {
  const found = await createSearchingOrderFinder(sql).findSearching(cityId, limit, {
    maxBroadcastRounds: MAX_ROUNDS,
  });
  if (!found.ok) throw new Error(found.error.detail);
  return found.value.map((o) => o.orderId).filter((id) => created.includes(id));
}

describeIf("LOAD-01 P4 — الجولة الحية لا تحجب الطلب الذي لم يُعرَض", () => {
  it("الجديدُ يدخلُ نافذةً يملؤها أقدمُ منه جولتُه حيّة، والمنقضيةُ جولتُه تسبقُه، والحيُّ يملأُ الفائضَ", async () => {
    const live: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await order(1, 300 - i);
      await pendingOffer(id, 1, 40);
      live.push(id);
    }
    const expired = await order(1, 200);
    await pendingOffer(expired, 1, -5);
    const exhausted = await order(MAX_ROUNDS, 400);
    const fresh = await order(0, 1);

    // نافذةٌ بقدرِ الحيِّ: قبلَ الإصلاحِ = الأقدمُ الأربعةُ الحيّةُ، فلا الجديدُ ولا المنقضي.
    const narrow = await window(4);
    expect(narrow).toContain(fresh);
    expect(narrow.slice(0, 2)).toEqual([expired, fresh]);

    // نافذةٌ واسعةٌ: لا استبعاد — الحيُّ كلُّه بعدَ القابلِ للعرضِ، والمستنفدُ آخراً.
    const wide = await window(50);
    expect(wide).toEqual([expired, fresh, ...live, exhausted]);
  });
});
