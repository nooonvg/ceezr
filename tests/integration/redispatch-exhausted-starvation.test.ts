/**
 * الغرض: D8 (CAP-RUN-20261015) — تجويع إعادة العرض بالطلبات المستنفِدة دوراتِها.
 *
 *   `findSearching` كان يرتّب `created_at asc limit N` بلا اعتبارٍ لعدد الدورات. والطلبُ
 *   الذي استنفد دوراتِه (3 من 3) يبقى `searching` حتى يلغيه الراكب أو الموظف — فإذا
 *   تراكم منها N في مدينةٍ ملأت نافذةَ الفحص في كلّ شوط («examined=50 rebroadcast=0
 *   exhausted=50» في gateway.log للجولة)، ولا يُفحَص الطلبُ الجديد أبداً فلا دورةَ ثانيةً له
 *   (الحالة الحدّية A6 فشلت بهذا السبب على النظام الحيّ).
 *
 *   الإصلاح ترتيبٌ لا فتوى: `order by broadcast_round asc, created_at asc` — من بقيت له
 *   دوراتٌ يُقدَّم، والمجالُ (`hasExhaustedBroadcastRounds`) يبقى الحَكَم الوحيد.
 *
 *   الاختبار يزرع 60 طلباً مستنفِداً أقدمَ من كلّ شيء وطلباً جديداً بدورةٍ واحدة، ثم يطلب
 *   نافذةً تتّسع لما سبقه من طلبات الدورة الأولى فحسب: قبل الإصلاح يغيب الجديد، وبعده يحضر.
 *   ويحذف في النهاية ما زرعه وحده (بالمعرّفات).
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

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const describeIf = DATABASE_URL === "" ? describe.skip : describe;

let sql: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let userId: string;
const created: string[] = [];
const TG = 8_815_001;

describeIf("D8 redispatch starvation by exhausted searching orders", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL });
    city = await ensureActiveCity(sql);
    cityId = city.cityId as CityId;
    const [u] = await sql<{ id: string }[]>`
      insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG})
      on conflict (telegram_id) do update set telegram_id = excluded.telegram_id returning id`;
    if (u === undefined) throw new Error("users: لم يُدرَج الصفُّ — الاختبارُ لا معنى له");
    userId = u.id;
    const [r] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}::uuid, ${userId}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
    if (r === undefined) throw new Error("riders: لم يُدرَج الصفُّ — الاختبارُ لا معنى له");
    riderId = r.id;
  });

  afterAll(async () => {
    if (created.length) await sql`delete from orders where id = any(${created}::uuid[])`;
    await restoreCityBaseline(sql, city);
    await sql.end();
  });

  it("طلبٌ جديد بدورةٍ واحدة يدخل نافذة الفحص رغم 60 طلباً مستنفِداً أقدم منه", async () => {
    const pickup = "SRID=4326;POINT(39.1728 21.5433)";
    for (let i = 0; i < 60; i++) {
      const [o] = await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
        values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${pickup}::geography, 3,
                now() - interval '10 days' + make_interval(secs => ${i}), now() - interval '10 days')
        returning id`;
      if (o === undefined) throw new Error("orders: لم يُدرَج الصفُّ — الاختبارُ لا معنى له");
      created.push(o.id);
    }
    const [fresh] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, searching_since)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${pickup}::geography, 1, now())
      returning id`;
    if (fresh === undefined) throw new Error("orders: لم يُدرَج الطلبُ الجديدُ");
    created.push(fresh.id);

    // طلبات الدورة ≤ 1 الأخرى في المدينة (من اختباراتٍ أخرى) تسبق الجديدَ بحقّ — النافذةُ تتّسع لها وله فقط.
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int n from orders o
       where o.city_id = ${cityId}::uuid and o.status = 'searching' and o.assigned_driver_id is null
         and (o.candidate_expires_at is null or o.candidate_expires_at <= now())
         and o.broadcast_round <= 1 and o.id <> ${fresh?.id}::uuid`;
    if (row === undefined) throw new Error("orders: لم يُعَدَّ الصفُّ — الاختبارُ لا معنى له");
    const n = row.n;
    const finder = createSearchingOrderFinder(sql);
    const res = await finder.findSearching(cityId, n + 1);
    expect(res.ok).toBe(true);
    const ids = res.ok ? res.value.map((r) => String(r.orderId)) : [];
    expect(ids).toContain(fresh?.id);
  });
});
