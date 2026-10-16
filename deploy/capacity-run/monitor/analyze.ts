/**
 * CAP-RUN-20261016 — تحليل جولة من مصادر مستقلة عن المولّد: القاعدة (طلبات/عروض/صندوق إشعارات/طابور وارد)
 * وسجلّ المحاكي (ما «وصل» فعلًا) وملخص المولّد. يُكتب round-metrics.json في مجلد الجولة.
 *   RUN_DIR=... bun run analyze.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const RUN_DIR = process.env.RUN_DIR ?? "";
const EV = `${RUN_DIR}/evidence`;
const sql = postgres(`${process.env.DATABASE_URL}?application_name=cap-analyze`, { max: 2 });
const lines = (f: string) =>
  existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
const tl = lines(`${EV}/timeline.jsonl`).map((l) => JSON.parse(l));
const le = lines(`${EV}/load-events.jsonl`).map((l) => JSON.parse(l));
const zero = le.find((e) => e.event === "load.start")?.t;
const drainEv = le.find((e) => e.event === "phase.start" && e.name === "drain")?.t;
const endEv = le.find((e) => e.event === "load.end")?.t;
if (!zero) throw new Error("no load.start");
const t0 = new Date(zero);
const tLoadEnd = new Date(drainEv ?? endEv ?? Date.now());
const tEnd = new Date(endEv ?? Date.now());
const pct = (a: number[], p: number) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const at = s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return at === undefined ? null : Math.round(at * 10) / 10;
};
const q3 = (a: number[]) => ({
  n: a.length,
  p50: pct(a, 50),
  p95: pct(a, 95),
  p99: pct(a, 99),
  max: a.length ? Math.max(...a) : null,
});

// ── الطلبات المُنشأة خلال نافذة الحمل ونتائجها ──
const orders = await sql<{ service: string; status: string; n: number }[]>`
  select service::text, status::text, count(*)::int n from orders where created_at >= ${t0} and created_at < ${tLoadEnd} group by 1,2 order by 1,2`;
const matchLat = (
  await sql<{ s: number }[]>`
  select extract(epoch from (min(oo.responded_at) - o.created_at))::float8 s from orders o join order_offers oo on oo.order_id=o.id and oo.status='accepted'
   where o.created_at >= ${t0} and o.created_at < ${tLoadEnd} group by o.id`
).map((r) => r.s);
// ── العروض: مُنشأة في القاعدة مقابل مُسلَّمة في المحاكي ──
const offers = await sql<
  { status: string; n: number }[]
>`select status::text, count(*)::int n from order_offers where created_at >= ${t0} and created_at < ${tEnd} group by 1`;
const offerIds = await sql<
  { order_id: string; tg: string; created: Date }[]
>`select oo.order_id::text, u.telegram_id::text tg, oo.created_at created from order_offers oo
  join drivers d on d.id=oo.driver_id join users u on u.id=d.user_id where oo.created_at >= ${t0} and oo.created_at < ${tEnd}`;
const mock = lines(`${EV}/telegram-mock.jsonl`).map((l) => JSON.parse(l)) as {
  t: number;
  bot: string;
  method: string;
  chat_id: string;
  status: number;
  cbs?: string[];
}[];
const firstDelivered = new Map<string, number>();
const sendsByBot: Record<string, number> = {};
let mock429 = 0;
for (const m of mock) {
  if (m.t < t0.getTime() || m.t > tEnd.getTime()) continue;
  if (m.status === 429) mock429++;
  if (m.status === 200 && (m.method === "sendMessage" || m.method === "editMessageText"))
    sendsByBot[m.bot] = (sendsByBot[m.bot] ?? 0) + 1;
  if (m.bot !== "driver" || m.status !== 200) continue;
  const acc = m.cbs?.find((c) => c.startsWith("offer:accept:"));
  if (!acc) continue;
  const k = `${acc.slice(13)}:${m.chat_id}`;
  if (!firstDelivered.has(k)) firstDelivered.set(k, m.t);
}
const offerDeliveryLag: number[] = [];
let offersDelivered = 0;
for (const o of offerIds) {
  const d = firstDelivered.get(`${o.order_id}:${o.tg}`);
  if (d !== undefined) {
    offersDelivered++;
    offerDeliveryLag.push((d - o.created.getTime()) / 1000);
  }
}
// ── صندوق الإشعارات ──
const outbox = await sql<
  { kind: string; status: string; n: number }[]
>`select kind::text, status::text, count(*)::int n from notification_outbox where created_at >= ${t0} and created_at < ${tEnd} group by 1,2 order by 1,2`;
const outboxLag = (
  await sql<
    { s: number }[]
  >`select extract(epoch from delivered_at - created_at)::float8 s from notification_outbox where created_at >= ${t0} and created_at < ${tEnd} and delivered_at is not null`
).map((r) => r.s);
// ── طابور الوارد ──
const jobs = await sql<
  { bot: string; status: string; n: number; retried: number }[]
>`select bot, status, count(*)::int n, count(*) filter (where attempts>1)::int retried from telegram_update_jobs where created_at >= ${t0} and created_at < ${tEnd} group by 1,2`;
const jobLag: Record<string, ReturnType<typeof q3>> = {};
for (const b of ["driver", "rider"]) {
  const a = (
    await sql<
      { s: number }[]
    >`select extract(epoch from completed_at - created_at)::float8 s from telegram_update_jobs where bot=${b} and created_at >= ${t0} and created_at < ${tEnd} and completed_at is not null`
  ).map((r) => r.s);
  jobLag[b] = q3(a);
}
// ── القروبات ──
const groups = await sql<
  { status: string; n: number }[]
>`select n.status::text, count(*)::int n from unsubscribed_negotiations n where n.created_at >= ${t0} and n.created_at < ${tEnd} group by 1`;
const overClaims = (
  await sql<
    { n: number }[]
  >`select count(*)::int n from (select negotiation_id from unsubscribed_claims where created_at >= ${t0} group by 1 having count(*) > 3) x`
)[0]?.n;
const dupClaims = (
  await sql<
    { n: number }[]
  >`select count(*)::int n from (select negotiation_id, driver_id from unsubscribed_claims where created_at >= ${t0} group by 1,2 having count(*) > 1) x`
)[0]?.n;
// ── سلامة: إسناد مزدوج، طلبات عالقة ──
const doubleAccepted = (
  await sql<
    { n: number }[]
  >`select count(*)::int n from (select order_id from order_offers where created_at >= ${t0} and status='accepted' group by 1 having count(*)>1) x`
)[0]?.n;
const driverTwoActive = (
  await sql<
    { n: number }[]
  >`select count(*)::int n from (select assigned_driver_id from orders where status::text in ('matched','in_progress') and assigned_driver_id is not null group by 1 having count(*)>1) x`
)[0]?.n;
const stuckSending = (
  await sql<
    { n: number }[]
  >`select count(*)::int n from notification_outbox where status='sending' and claimed_at < now() - interval '5 min'`
)[0]?.n;
const gen = existsSync(`${EV}/generator-summary.gen1.json`)
  ? JSON.parse(readFileSync(`${EV}/generator-summary.gen1.json`, "utf8"))
  : null;
const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
const out = {
  round: RUN_DIR.split("/").pop(),
  window: {
    load_start: t0.toISOString(),
    load_end: tLoadEnd.toISOString(),
    drain_end: tEnd.toISOString(),
    load_minutes: Math.round(((tLoadEnd.getTime() - t0.getTime()) / 60000) * 10) / 10,
  },
  gateway_starts: lines(`${EV}/gateway-starts.jsonl`).map((l) => JSON.parse(l)),
  orders: { by_service_status: orders, total: sum(orders), order_to_accept_s: q3(matchLat) },
  offers: {
    db_by_status: offers,
    db_created: sum(offers),
    delivered_in_mock: offersDelivered,
    delivered_ratio: sum(offers) ? Math.round((offersDelivered / sum(offers)) * 1000) / 10 : null,
    create_to_mock_s: q3(offerDeliveryLag),
  },
  outbox: { by_kind_status: outbox, deliver_lag_s: q3(outboxLag) },
  telegram_updates: { by_bot_status: jobs, completion_lag_s: jobLag },
  mock: {
    sends_by_bot: sendsByBot,
    http_429: mock429,
    rate_per_s_by_bot: Object.fromEntries(
      Object.entries(sendsByBot).map(([b, n]) => [
        b,
        Math.round((n / ((tEnd.getTime() - t0.getTime()) / 1000)) * 100) / 100,
      ]),
    ),
  },
  groups: {
    negotiations_by_status: groups,
    negotiations_over_3_claims: overClaims,
    duplicate_claims_same_driver: dupClaims,
  },
  integrity: {
    orders_with_two_accepted_offers: doubleAccepted,
    drivers_with_two_active_orders_now: driverTwoActive,
    outbox_stuck_sending_gt_5min_now: stuckSending,
  },
  generator: gen && {
    http: gen.http,
    scenarios: gen.scenarios,
    biz: gen.biz,
    peakConcurrency: gen.peakConcurrency,
    outages: gen.outages,
  },
  timeline_events: tl.length,
};
writeFileSync(`${RUN_DIR}/round-metrics.json`, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      orders: out.orders.total,
      offers: out.offers,
      outbox_lag: out.outbox.deliver_lag_s,
      jobLag,
      integrity: out.integrity,
      mock: out.mock,
    },
    null,
    1,
  ).slice(0, 3000),
);
await sql.end({ timeout: 2 });
