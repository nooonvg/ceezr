/**
 * مسبارُ إثباتِ ترجمةِ خطأِ `I1` عبرَ HTTP — أداةُ دليلِ المرحلةِ 3 من
 * CAP-RUN-20261016-CONTINUATION (لا كودَ منتجٍ): سائقٌ يقبلُ عرضَهُ الأولَ
 * (نجاحٌ)، ثمّ يحاولُ قبولَ عرضٍ ثانٍ لطلبٍ آخرَ وهوَ ملتزمٌ — فيجبُ أن تردَّ
 * البوابةُ **409** بجسمٍ فيهِ `DRIVER_HAS_ACTIVE_ORDER` (الرمزُ النظيفُ
 * المقصودُ لا اصطدامًا خامًا)، ويبقى الطلبُ الثاني باحثًا وصفرُ التزاماتٍ مزدوجةٍ.
 *
 * يُشغَّل في البيئةِ المعزولةِ ضدَّ البوابةِ الحيةِ:
 *   DATABASE_URL=... GATEWAY_URL=http://127.0.0.1:54300 DRIVER_BOT_TOKEN=... \
 *     bun run deploy/capacity-run/load/i1-http-probe.ts
 * الحكمُ منَ القاعدةِ بعدَ الرفضِ لا من 2xx وحدها؛ والخروجُ 0 عندَ نجاحِ كلِّ
 * الخطواتِ وإلا 1. هويةُ المسبارِ معزولةٌ (تنقيةٌ موجّهةٌ لا truncate عامًّا).
 * ينتمي إلى: deploy/capacity-run/load
 */

import { createHmac } from "node:crypto";
import { createSql } from "../../../packages/infrastructure/db/client.ts";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/ceezr_cap_20261016";
const BASE = process.env.GATEWAY_URL ?? "http://127.0.0.1:54300";
const BOT = process.env.DRIVER_BOT_TOKEN ?? "";
const TG = 9_320_071;
const RIDER_TG = 9_320_072;
const sql = createSql({ connectionString: DB });

function signedInitData(telegramId: number, startParam: string): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: telegramId, first_name: "i1probe", language_code: "ar" });
  const pairs: [string, string][] = [
    ["auth_date", String(authDate)],
    ["user", user],
    ["start_param", startParam],
  ];
  const checkString = pairs
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams([...pairs, ["hash", hash]]).toString();
}

async function http(
  path: string,
  token: string | null,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* نصٌّ خام */
  }
  return { status: res.status, body: parsed };
}

// ── البذرُ: سائقٌ موثّقٌ بقدرةٍ واشتراكٍ تجريبيٍّ + راكبٌ + طلبانِ + عرضانِ
const city = (await sql<{ id: string }[]>`select id from cities order by created_at limit 1`)[0].id;
await sql`delete from audit_log where actor_user_id in (select id from users where telegram_id in (${TG}::bigint, ${RIDER_TG}::bigint))`;
await sql`update orders set assigned_driver_id = null, status = 'cancelled' where assigned_driver_id in (select id from drivers where user_id in (select id from users where telegram_id = ${TG}::bigint))`;
await sql`delete from order_offers where driver_id in (select id from drivers where user_id in (select id from users where telegram_id = ${TG}::bigint))`;
await sql`delete from notification_outbox where order_id in (select id from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id = ${RIDER_TG}::bigint)))`;
await sql`delete from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id = ${RIDER_TG}::bigint))`;
await sql`delete from driver_capabilities where driver_id in (select id from drivers where user_id in (select id from users where telegram_id = ${TG}::bigint))`;
await sql`delete from subscriptions where driver_id in (select id from drivers where user_id in (select id from users where telegram_id = ${TG}::bigint))`;
await sql`delete from drivers where user_id in (select id from users where telegram_id = ${TG}::bigint)`;
await sql`delete from riders where user_id in (select id from users where telegram_id = ${RIDER_TG}::bigint)`;
await sql`delete from users where telegram_id in (${TG}::bigint, ${RIDER_TG}::bigint)`;
const du = (
  await sql<
    { id: string }[]
  >`insert into users (city_id, telegram_id, full_name, phone, language_code, role) values (${city}::uuid, ${TG}::bigint, 'سائق المسبار', '+96659320071', 'ar', 'driver'::user_role) returning id`
)[0].id;
const ru = (
  await sql<
    { id: string }[]
  >`insert into users (city_id, telegram_id, full_name, phone, language_code, role) values (${city}::uuid, ${RIDER_TG}::bigint, 'راكب المسبار', '+96659320072', 'ar', 'rider'::user_role) returning id`
)[0].id;
const d = (
  await sql<
    { id: string }[]
  >`insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type) values (${city}::uuid, ${du}::uuid, 'verified'::verification_status, 'ر س ق 71', 'sedan') returning id`
)[0].id;
const r = (
  await sql<
    { id: string }[]
  >`insert into riders (city_id, user_id) values (${city}::uuid, ${ru}::uuid) returning id`
)[0].id;
await sql`insert into driver_capabilities (driver_id, city_id, service) values (${d}::uuid, ${city}::uuid, 'transport'::service_type)`;
await sql`insert into subscriptions (driver_id, city_id, plan, status, trial_ends_at) values (${d}::uuid, ${city}::uuid, 'transport'::subscription_plan, 'trialing'::subscription_status, now() + interval '14 days')`;
const orders: string[] = [];
for (let i = 0; i < 2; i += 1) {
  const o = (
    await sql<
      { id: string }[]
    >`insert into orders (city_id, rider_id, service, status, pickup) values (${city}::uuid, ${r}::uuid, 'transport'::service_type, 'searching'::order_status, st_setsrid(st_makepoint(39.17, 21.54), 4326)::geography) returning id`
  )[0].id;
  orders.push(o);
  await sql`insert into order_offers (city_id, order_id, driver_id, round, status, expires_at) values (${city}::uuid, ${o}::uuid, ${d}::uuid, 1, 'pending'::offer_status, now() + interval '45 minutes')`;
}
const offers = (
  await sql<
    { id: string }[]
  >`select id::text as id from order_offers where order_id = any(${orders}::uuid[]) order by created_at`
).map((x) => x.id);

// ── ١) الجلسةُ الموقعةُ
const session = await http("/v1/session/telegram", null, {
  initData: signedInitData(TG, "i1-probe"),
});
const token = (session.body as { accessToken?: string } | null)?.accessToken ?? null;
console.log(JSON.stringify({ step: "session", status: session.status, hasToken: token !== null }));
if (token === null) process.exit(1);

// ── ٢) القبولُ الأولُ: نجاحٌ متوقعٌ
const first = await http(`/v1/driver/offers/${offers[0]}/accept`, token, {});
console.log(JSON.stringify({ step: "accept-first", status: first.status, body: first.body }));

// ── ٣) القبولُ الثاني وهوَ ملتزمٌ: 409 DRIVER_HAS_ACTIVE_ORDER متوقعٌ
const second = await http(`/v1/driver/offers/${offers[1]}/accept`, token, {});
console.log(JSON.stringify({ step: "accept-second", status: second.status, body: second.body }));

// ── ٤) الحكمُ منَ القاعدةِ بعدَ الرفضِ
const state = await sql<{ status: string; assigned: string | null }[]>`
  select status::text as status, assigned_driver_id::text as assigned from orders where id = any(${orders}::uuid[]) order by created_at`;
const dup = await sql<{ n: number }[]>`
  select count(*)::int as n from (
    select assigned_driver_id from orders
     where assigned_driver_id = ${d}::uuid and is_driver_engaged_order_status(status)
     group by assigned_driver_id having count(*) > 1) as x`;
console.log(JSON.stringify({ step: "db-after", orders: state, duplicates: dup[0]?.n ?? -1 }));

const verdict =
  first.status === 200 &&
  second.status === 409 &&
  (second.body as { error?: string } | null)?.error === "DRIVER_HAS_ACTIVE_ORDER" &&
  state[0]?.status === "matched" &&
  state[1]?.status === "searching" &&
  (dup[0]?.n ?? 1) === 0;
console.log(JSON.stringify({ step: "VERDICT", pass: verdict }));
await sql.end({ timeout: 3 });
process.exit(verdict ? 0 : 1);
