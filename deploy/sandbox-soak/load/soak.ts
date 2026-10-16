/* biome-ignore-all lint/style/noNonNullAssertion: أداةُ حملٍ تجريبيّةٌ لا شيفرةُ منتَج — البذرُ يضمنُ وجودَ الصفوفِ المقروءة، وفشلُها يُسجَّلُ استثناءً في السيناريو. */
/* biome-ignore-all lint/suspicious/noAssignInExpressions: إسنادُ حالةِ الحجزِ داخلَ تعبيراتٍ قصيرةٍ في المولّد. */
/* biome-ignore-all lint/complexity/noCommaOperator: إرجاعٌ مختصرٌ لنتيجةِ السيناريو. */
/**
 * مولّد الحمل التجريبي لمنصة «وصلة» — يعمل ضد البوّابة الحقيقية عبر HTTP (webhook تيليجرام)
 * على قاعدة Postgres محلية. كل شيء بيانات وهمية (SANDBOX).
 *
 * المراحل (بالدقائق من بدء هذا السكربت):
 *   seed        : 5 مدن مفعّلة + 20 قروب + 50 سائق + 100 زبون عبر حوار البوت الحقيقي
 *   intensive   : Delivery + Ride + Group بتوازٍ متصاعد
 *   edge        : اختبارات ضغط وحالات حدّية (إلغاء/تكرار/تضارب/انقطاع/قروب ممتلئ…)
 *   cooldown    : إيقاف الحمل وجمع المقاييس
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createSql } from "../../../packages/infrastructure/db/client.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
mkdirSync(`${ROOT}/logs`, { recursive: true });
mkdirSync(`${ROOT}/reports`, { recursive: true });
const BASE = process.env.GATEWAY_URL ?? "http://127.0.0.1:4300";
const SECRET = "sandboxWebhookSecret_0123456789abcdefXYZ";
const INTENSIVE_MIN = Number(process.env.INTENSIVE_MIN ?? 32);
const EDGE_MIN = Number(process.env.EDGE_MIN ?? 10);
const REPORT_EVERY_MIN = 10;
const DB_URL = process.env.SANDBOX_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/waslah_test";
const sql = createSql({ connectionString: `${DB_URL}?application_name=soak`, max: 10 } as never);

// ───────────────────────── قياس ─────────────────────────
const T0 = Date.now();
const mins = () => (Date.now() - T0) / 60000;
type Lat = number[];
const http = {
  total: 0,
  ok: 0,
  non2xx: 0,
  netErr: 0,
  lat: [] as Lat,
  byKind: {} as Record<string, Lat>,
};
type Sc = { started: number; ok: number; fail: number; reasons: Record<string, number>; e2e: Lat };
const sc: Record<string, Sc> = {};
const edge: { name: string; pass: boolean; detail: string; at: string }[] = [];
const errors: Record<string, number> = {};
const fixes: string[] = [];
let phase = "seed";
let concurrency = 0;
let peakConcurrency = 0;
const timeline: {
  min: number;
  phase: string;
  conc: number;
  rps: number;
  p95: number;
  okRate: number;
}[] = [];

function scen(name: string): Sc {
  return (sc[name] ??= { started: 0, ok: 0, fail: 0, reasons: {}, e2e: [] });
}
function log(event: string, data: Record<string, unknown> = {}) {
  appendFileSync(
    `${ROOT}/logs/load.jsonl`,
    `${JSON.stringify({
      t: new Date().toISOString(),
      min: +mins().toFixed(2),
      phase,
      event,
      ...data,
    })}\n`,
  );
}
function pct(a: Lat, p: number) {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!.toFixed(1);
}
function err(key: string) {
  errors[key] = (errors[key] ?? 0) + 1;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ───────────────────────── تيليجرام (تحديثات وهمية) ─────────────────────────
let updateId = Math.floor(Date.now() / 1000) * 10;
const msg = (chat: number, body: Record<string, unknown>) => ({
  update_id: ++updateId,
  message: {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chat, type: "private" },
    from: { id: chat, is_bot: false, first_name: "t", language_code: "ar" },
    ...body,
  },
});
const text = (c: number, v: string) => msg(c, { text: v });
const loc = (c: number, p: P) => msg(c, { location: { latitude: p.lat, longitude: p.lng } });
const contact = (c: number, phone: string) =>
  msg(c, { contact: { user_id: c, phone_number: phone, first_name: "t" } });
const photo = (c: number, f: string) =>
  msg(c, {
    photo: [
      { file_id: `${f}_t`, file_unique_id: `${f}_tu`, width: 90, height: 90 },
      { file_id: f, file_unique_id: `${f}_u`, width: 800, height: 600 },
    ],
  });
const cb = (c: number, data: string, chatId = c) => ({
  update_id: ++updateId,
  callback_query: {
    id: String(updateId),
    data,
    chat_instance: "x",
    from: { id: c, is_bot: false, first_name: "t", language_code: "ar" },
    message: {
      message_id: 1,
      date: 0,
      chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" },
    },
  },
});

async function post(
  bot: "driver" | "rider",
  update: unknown,
  kind: string,
  opts: { secret?: string; raw?: string } = {},
): Promise<number> {
  const t = performance.now();
  http.total++;
  try {
    const r = await fetch(`${BASE}/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": opts.secret ?? SECRET,
      },
      body: opts.raw ?? JSON.stringify(update),
      signal: AbortSignal.timeout(15000),
    });
    await r.arrayBuffer();
    const d = performance.now() - t;
    http.lat.push(d);
    (http.byKind[kind] ??= []).push(d);
    if (r.status >= 200 && r.status < 300) http.ok++;
    else {
      http.non2xx++;
      if (!opts.secret && !opts.raw) err(`http_${r.status}:${kind}`);
    }
    return r.status;
  } catch (e) {
    http.netErr++;
    err(`net:${kind}:${(e as Error).name}`);
    return 0;
  }
}

// ───────────────────────── عالم البيانات ─────────────────────────
type P = { lat: number; lng: number };
const CITIES: Record<string, { center: P; role: "core" | "group"; idx: number }> = {
  JED: { center: { lat: 21.5433, lng: 39.1728 }, role: "core", idx: 1 },
  MKK: { center: { lat: 21.4225, lng: 39.8262 }, role: "core", idx: 2 },
  RUH: { center: { lat: 24.7136, lng: 46.6753 }, role: "core", idx: 3 },
  TIF: { center: { lat: 21.2703, lng: 40.4158 }, role: "group", idx: 4 },
  MED: { center: { lat: 24.4672, lng: 39.6111 }, role: "group", idx: 5 },
};
const near = (p: P, km: number): P => ({
  lat: p.lat + rnd(-km, km) / 111,
  lng: p.lng + rnd(-km, km) / 105,
});
type Driver = {
  chat: number;
  city: string;
  service: "transport" | "delivery";
  subscribed: boolean;
  id?: string;
  busy: boolean;
  at: P;
};
type Rider = { chat: number; city: string; busy: boolean };
const cityIds: Record<string, string> = {};
const groups: { id: number; city: string; kind: string }[] = [];
const drivers: Driver[] = [];
const riders: Rider[] = [];

async function seed() {
  log("seed.start");
  // تنظيف حركة تجريبية سابقة فقط (القاعدة كلها sandbox أُنشئت في هذه الجلسة)
  await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
            unsubscribed_claims, unsubscribed_negotiations, order_offers, orders, subscriptions, driver_capabilities,
            driver_availability, drivers, riders, users restart identity cascade`;
  for (const [code, c] of Object.entries(CITIES)) {
    const g = {
      support: -(1000000000000 + c.idx * 10 + 1),
      escalation: -(1000000000000 + c.idx * 10 + 2),
      unsub: -(1000000000000 + c.idx * 10 + 3),
    };
    const [row] = await sql<{ id: string }[]>`
      update cities set is_active = true, telegram_support_group_id = ${g.support}, telegram_escalation_group_id = ${g.escalation},
             telegram_unsubscribed_drivers_group_id = ${g.unsub} where code = ${code} returning id`;
    cityIds[code] = row!.id;
    groups.push(
      { id: g.support, city: code, kind: "support" },
      { id: g.escalation, city: code, kind: "escalation" },
      { id: g.unsub, city: code, kind: "unsubscribed_drivers" },
    );
    if (c.role === "group") {
      await sql`insert into platform_settings (city_id, key, value) values (${row!.id}, 'unmatched_escalate_after_seconds', '20'::jsonb)
                on conflict do nothing`.catch(async () => {
        await sql`update platform_settings set value='20'::jsonb where city_id=${row!.id} and key='unmatched_escalate_after_seconds'`;
      });
    }
  }
  // 5 قروبات إضافية غير مسجّلة (قروبات مجتمع/أجنبية) — لاختبار رفض طلبات الانضمام لقروب مجهول
  for (let i = 1; i <= 5; i++)
    groups.push({ id: -(1000000009000 + i), city: "-", kind: "foreign_unregistered" });

  // 50 سائق: JED/MKK/RUH = 5 نقل + 4 توصيل مشتركين (27) · TIF = 12 · MED = 11 (سائق قدرة واحد مشترك + غير مشتركين للقروب)
  let chat = 7_100_000;
  for (const [code, c] of Object.entries(CITIES)) {
    if (c.role === "core") {
      for (let i = 0; i < 5; i++)
        drivers.push({
          chat: ++chat,
          city: code,
          service: "transport",
          subscribed: true,
          busy: false,
          at: near(c.center, 2),
        });
      for (let i = 0; i < 4; i++)
        drivers.push({
          chat: ++chat,
          city: code,
          service: "delivery",
          subscribed: true,
          busy: false,
          at: near(c.center, 2),
        });
    } else {
      const n = code === "TIF" ? 12 : 11;
      drivers.push({
        chat: ++chat,
        city: code,
        service: "transport",
        subscribed: true,
        busy: true,
        at: c.center,
      }); // سائق قدرة (غير متاح)
      for (let i = 0; i < n - 1; i++)
        drivers.push({
          chat: ++chat,
          city: code,
          service: "transport",
          subscribed: false,
          busy: false,
          at: near(c.center, 2),
        });
    }
  }
  const regDriver = async (d: Driver, n: number) => {
    await post("driver", text(d.chat, "/start"), "seed");
    await post("driver", text(d.chat, `سائق تجريبي ${n}`), "seed");
    await post(
      "driver",
      contact(d.chat, `+9665${String(d.chat).slice(-8).padStart(8, "0")}`),
      "seed",
    );
    await post("driver", cb(d.chat, `city:${cityIds[d.city]}`), "seed");
    await post("driver", cb(d.chat, `service:${d.service}`), "seed");
    await post("driver", cb(d.chat, "vehicle:sedan"), "seed");
    await post("driver", text(d.chat, "أ ب ج 1234"), "seed");
    await post("driver", text(d.chat, `1${String(d.chat).slice(-9).padStart(9, "0")}`), "seed");
    await post("driver", photo(d.chat, `vphoto_${d.chat}`), "seed");
    const row =
      (await waitFor(
        async () =>
          (
            await sql<
              { id: string }[]
            >`select d.id from drivers d join users u on u.id=d.user_id where u.telegram_id=${d.chat} and d.vehicle_photo_file_id is not null`
          )[0],
        120000,
        500,
      )) ??
      (await waitFor(
        async () =>
          (
            await sql<
              { id: string }[]
            >`select d.id from drivers d join users u on u.id=d.user_id where u.telegram_id=${d.chat}`
          )[0],
        5000,
        500,
      ));
    if (!row) {
      err("seed:driver_not_registered");
      return;
    }
    d.id = row.id;
    await sql`update drivers set verification_status='verified' where id=${d.id}`;
    await sql`select start_trial(${d.id}::uuid, ${d.service}::subscription_plan)`;
    if (!d.subscribed) await sql`update subscriptions set status='expired' where driver_id=${d.id}`;
    const isCapabilityOnly = d.subscribed && CITIES[d.city]!.role === "group";
    if (!isCapabilityOnly) {
      await post("driver", text(d.chat, "/available"), "seed");
      await post("driver", loc(d.chat, d.at), "seed");
    }
  };
  for (let i = 0; i < drivers.length; i += 10)
    await Promise.all(drivers.slice(i, i + 10).map((d, j) => regDriver(d, i + j + 1)));
  // 100 زبون: 20 لكل مدينة
  let rc = 7_200_000;
  for (const code of Object.keys(CITIES))
    for (let i = 0; i < 20; i++) riders.push({ chat: ++rc, city: code, busy: false });
  const regRider = async (r: Rider, n: number) => {
    await post("rider", text(r.chat, "/start"), "seed");
    await post("rider", text(r.chat, `زبون تجريبي ${n}`), "seed");
    await post("rider", cb(r.chat, `city:${cityIds[r.city]}`), "seed");
  };
  for (let i = 0; i < riders.length; i += 20)
    await Promise.all(riders.slice(i, i + 20).map((r, j) => regRider(r, i + j + 1)));
  await waitFor(
    async () =>
      (await sql<{ n: number }[]>`select count(*)::int n from riders`)[0]!.n >= riders.length,
    120000,
    1000,
  );
  await waitFor(
    async () =>
      (
        await sql<
          { n: number }[]
        >`select count(*)::int n from telegram_update_jobs where status in ('pending','claimed')`
      )[0]!.n === 0,
    120000,
    1000,
  );
  const [counts] = await sql<{ d: number; r: number; av: number }[]>`
    select (select count(*)::int from drivers) d, (select count(*)::int from riders) r,
           (select count(*)::int from driver_availability where is_available) av`;
  log("seed.done", { ...counts, groups: groups.length });
  console.log(
    `[seed] drivers=${counts!.d} riders=${counts!.r} available=${counts!.av} groups=${groups.length}`,
  );
  return counts!;
}

async function loadWorld() {
  for (const code of Object.keys(CITIES))
    cityIds[code] = (await sql<{ id: string }[]>`select id from cities where code=${code}`)[0]!.id;
  for (const [code, c] of Object.entries(CITIES)) {
    groups.push(
      { id: -(1000000000000 + c.idx * 10 + 1), city: code, kind: "support" },
      { id: -(1000000000000 + c.idx * 10 + 2), city: code, kind: "escalation" },
      { id: -(1000000000000 + c.idx * 10 + 3), city: code, kind: "unsubscribed_drivers" },
    );
  }
  for (let i = 1; i <= 5; i++)
    groups.push({ id: -(1000000009000 + i), city: "-", kind: "foreign_unregistered" });
  const ds = await sql<{ tg: string; id: string; code: string; service: string; sub: boolean }[]>`
    select u.telegram_id::text tg, d.id, c.code, (select service::text from driver_capabilities dc where dc.driver_id=d.id limit 1) service,
           exists(select 1 from subscriptions s where s.driver_id=d.id and s.status in ('trialing','active')) sub
      from drivers d join users u on u.id=d.user_id join cities c on c.id=d.city_id order by u.telegram_id`;
  for (const d of ds) {
    const capOnly = d.sub && CITIES[d.code]!.role === "group";
    drivers.push({
      chat: Number(d.tg),
      id: d.id,
      city: d.code,
      service: d.service as "transport",
      subscribed: d.sub,
      busy: capOnly,
      at: near(CITIES[d.code]!.center, 2),
    });
  }
  const rs = await sql<
    { tg: string; code: string }[]
  >`select u.telegram_id::text tg, c.code from riders r join users u on u.id=r.user_id join cities c on c.id=u.city_id`;
  for (const r of rs) riders.push({ chat: Number(r.tg), city: r.code, busy: false });
  // إنهاء أي طلبات نشطة متبقية لهؤلاء الزبائن من الجولة السابقة
  for (const r of riders) await post("rider", text(r.chat, "/cancel"), "cleanup");
  await sleep(15000);
  for (const d of drivers.filter((x) => !x.busy && x.service)) {
    await post("driver", text(d.chat, "/available"), "cleanup");
    await post("driver", loc(d.chat, d.at), "cleanup");
  }
  await sleep(10000);
  console.log(`[world] drivers=${drivers.length} riders=${riders.length}`);
}

// إبقاء مواقع السائقين المتاحين حيّة (نبض موقع كل 40ث)
let heartbeatOn = true;
async function locationHeartbeat() {
  while (heartbeatOn) {
    await Promise.all(
      drivers
        .filter((d) => !d.busy && d.id && !(d.subscribed && CITIES[d.city]!.role === "group"))
        .map((d) => post("driver", loc(d.chat, near(d.at, 0.3)), "driver_location")),
    );
    await sleep(40000);
  }
}

// ───────────────────────── أدوات الحجز ─────────────────────────
function takeRider(cities: string[]): Rider | null {
  const free = riders.filter((r) => !r.busy && cities.includes(r.city));
  if (free.length === 0) return null;
  const r = free[Math.floor(Math.random() * free.length)]!;
  r.busy = true;
  return r;
}
const byChat = (chat: number) => drivers.find((d) => d.chat === chat);
async function latestOrder(riderChat: number, sinceMs: number) {
  const rows = await sql<{ id: string; status: string; service: string }[]>`
    select o.id, o.status::text, o.service::text from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id
     where u.telegram_id=${riderChat} and o.created_at >= to_timestamp(${sinceMs / 1000}) order by o.created_at desc limit 1`;
  return rows[0];
}
async function orderStatus(id: string) {
  const [r] = await sql<{ status: string }[]>`select status::text from orders where id=${id}`;
  return r?.status;
}
async function pendingOfferDrivers(orderId: string): Promise<number[]> {
  const rows = await sql<{ tg: string }[]>`
    select u.telegram_id::text tg from order_offers oo join drivers d on d.id=oo.driver_id join users u on u.id=d.user_id
     where oo.order_id=${orderId} and oo.status='pending'`;
  return rows.map((r) => Number(r.tg));
}
async function waitFor<T>(
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs: number,
  every = 300,
): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await sleep(every);
  }
  return undefined;
}

// ───────────────────────── السيناريوهات ─────────────────────────
async function rideOrDelivery(
  kind: "ride" | "delivery",
  opts: { cancelAt?: "searching" | "matched" } = {},
) {
  const s = scen(opts.cancelAt ? `${kind}_cancel_${opts.cancelAt}` : kind);
  const rider = takeRider(["JED", "MKK", "RUH"]);
  if (!rider) {
    s.reasons.no_free_rider = (s.reasons.no_free_rider ?? 0) + 1;
    await sleep(500);
    return;
  }
  s.started++;
  const t = Date.now();
  const city = CITIES[rider.city]!;
  const fail = (why: string) => {
    s.fail++;
    s.reasons[why] = (s.reasons[why] ?? 0) + 1;
    log(`${kind}.fail`, { why, rider: rider.chat });
  };
  let acceptedBy: Driver | undefined;
  try {
    const pickup = near(city.center, 1.5);
    const drop = near(city.center, 4);
    if (kind === "ride") {
      await post("rider", text(rider.chat, "/ride"), "rider_ride_cmd");
      await post("rider", loc(rider.chat, pickup), "rider_pickup");
      await post("rider", loc(rider.chat, drop), "rider_dropoff");
    } else {
      await post("rider", text(rider.chat, "/start"), "rider_menu");
      await post("rider", cb(rider.chat, "svc:delivery"), "rider_svc_delivery");
      await post("rider", loc(rider.chat, pickup), "rider_pickup");
      await post("rider", loc(rider.chat, drop), "rider_dropoff");
      await post(
        "rider",
        text(
          rider.chat,
          ["كيس ملابس", "مستندات مهمة", "علبة هدايا", "طلب صيدلية"][Math.floor(Math.random() * 4)]!,
        ),
        "rider_parcel",
      );
    }
    const order = await waitFor(() => latestOrder(rider.chat, t - 1000), 20000, 250);
    if (!order) return fail("order_not_created");
    if (order.status !== "searching" && order.status !== "matched")
      return fail(`unexpected_status_${order.status}`);
    if (opts.cancelAt === "searching") {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      const st = await waitFor(
        async () => ((await orderStatus(order.id)) === "cancelled" ? "cancelled" : null),
        10000,
      );
      return st ? (s.ok++, s.e2e.push(Date.now() - t)) : fail("cancel_not_applied");
    }
    // انتظار عرض ثم قبول من السائق المعروض عليه (الإرسال الحقيقي يحسم السائق الأقرب)
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline && !acceptedBy) {
      const offered = await pendingOfferDrivers(order.id);
      for (const chat of offered) {
        const d = byChat(chat);
        if (!d || d.busy) continue;
        d.busy = true;
        await post("driver", cb(chat, `offer:accept:${order.id}`), "driver_accept");
        await waitFor(
          async () => {
            const q = await sql<
              { s: string }[]
            >`select status::text s from order_offers where order_id=${order.id} and driver_id=${d.id!} order by created_at desc limit 1`;
            return q[0] && q[0].s !== "pending";
          },
          10000,
          200,
        );
        const st = await orderStatus(order.id);
        const [m] = await sql<
          { tg: string }[]
        >`select u.telegram_id::text tg from orders o join drivers d on d.id=o.assigned_driver_id join users u on u.id=d.user_id where o.id=${order.id}`;
        if (st === "matched" && m && Number(m.tg) === chat) {
          acceptedBy = d;
          break;
        }
        d.busy = false;
      }
      if (!acceptedBy) await sleep(700);
    }
    if (!acceptedBy) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("no_driver_within_75s");
    }
    if (opts.cancelAt === "matched") {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      const st = await waitFor(async () => {
        const x = await orderStatus(order.id);
        return x === "cancelled" ? x : null;
      }, 10000);
      return st
        ? (s.ok++, s.e2e.push(Date.now() - t))
        : fail(`cancel_after_match_status_${await orderStatus(order.id)}`);
    }
    await sleep(rnd(300, 1500)); // طريق إلى الالتقاط
    await post("driver", cb(acceptedBy.chat, `ride:start:${order.id}`), "driver_start");
    await waitFor(async () => (await orderStatus(order.id)) === "in_progress", 10000, 200);
    await sleep(rnd(500, 2500)); // الرحلة
    await post("driver", cb(acceptedBy.chat, `ride:complete:${order.id}`), "driver_complete");
    const st =
      (await waitFor(
        async () => {
          const x = await orderStatus(order.id);
          return x === "completed" ? x : null;
        },
        10000,
        200,
      )) ?? (await orderStatus(order.id));
    if (st !== "completed") return fail(`not_completed_status_${st}`);
    await post(
      "rider",
      cb(rider.chat, `rate:${3 + Math.floor(Math.random() * 3)}:${order.id}`),
      "rider_rate",
    );
    await post("driver", cb(acceptedBy.chat, `rate:5:${order.id}`), "driver_rate");
    s.ok++;
    s.e2e.push(Date.now() - t);
  } catch (e) {
    err(`scenario_exc:${kind}:${(e as Error).message.slice(0, 60)}`);
    fail("exception");
  } finally {
    // تأكد أن السائق عاد متاحاً بعد الرحلة (السلوك المتوقع تلقائياً)
    if (acceptedBy) {
      const [a] = await sql<
        { is_available: boolean }[]
      >`select is_available from driver_availability where driver_id=${acceptedBy.id!}`;
      if (a && !a.is_available) {
        err(`${kind}:driver_not_auto_available_after_trip`);
        await post("driver", text(acceptedBy.chat, "/available"), "driver_available");
        await post("driver", loc(acceptedBy.chat, acceptedBy.at), "driver_location");
      }
      acceptedBy.busy = false;
    }
    rider.busy = false;
  }
}

/** قروب السائقين غير المشتركين: طلب بلا مشترك متاح ← العامل ينشره في القروب ← مطالبات ← اتفاق ← رحلة. */
async function groupScenario(opts: { overfill?: boolean } = {}) {
  const s = scen(opts.overfill ? "group_full" : "group");
  const rider = takeRider(["TIF", "MED"]);
  if (!rider) {
    s.reasons.no_free_rider = (s.reasons.no_free_rider ?? 0) + 1;
    await sleep(500);
    return;
  }
  s.started++;
  const t = Date.now();
  const city = CITIES[rider.city]!;
  const unsubGroup = groups.find(
    (g) => g.city === rider.city && g.kind === "unsubscribed_drivers",
  )!.id;
  const claimers: Driver[] = [];
  const fail = (why: string) => {
    s.fail++;
    s.reasons[why] = (s.reasons[why] ?? 0) + 1;
    log("group.fail", { why, rider: rider.chat });
  };
  try {
    await post("rider", text(rider.chat, "/ride"), "rider_ride_cmd");
    await post("rider", loc(rider.chat, near(city.center, 1.5)), "rider_pickup");
    await post("rider", loc(rider.chat, near(city.center, 4)), "rider_dropoff");
    const order = await waitFor(() => latestOrder(rider.chat, t - 1000), 20000, 250);
    if (!order) return fail("order_not_created");
    // انتظار نشر بطاقة الطلب في قروب المدينة (العامل: sweep كل 60ث بعد 20ث سكون)
    const neg = await waitFor(
      async () => {
        const [n] = await sql<
          { id: string }[]
        >`select id from unsubscribed_negotiations where order_id=${order.id} and status in ('collecting','negotiating') order by created_at desc limit 1`;
        return n;
      },
      150000,
      1000,
    );
    if (!neg) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("not_published_to_group_150s");
    }
    const pool = drivers.filter((d) => d.city === rider.city && !d.subscribed && !d.busy && d.id);
    const want = opts.overfill
      ? Math.min(5, pool.length)
      : Math.min(1 + Math.floor(Math.random() * 3), pool.length);
    for (const d of pool.sort(() => Math.random() - 0.5).slice(0, want)) {
      d.busy = true;
      claimers.push(d);
    }
    if (claimers.length === 0) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("no_free_group_driver");
    }
    await Promise.all(
      claimers.map((d) =>
        post("driver", cb(d.chat, `unsub:claim:${neg.id}`, unsubGroup), "group_claim"),
      ),
    );
    await waitFor(
      async () =>
        (
          await sql<
            { n: number }[]
          >`select count(*)::int n from unsubscribed_claims where negotiation_id=${neg.id}`
        )[0]!.n >= Math.min(3, claimers.length),
      10000,
      250,
    );
    await sleep(1500);
    const [cc] = await sql<
      { n: number }[]
    >`select count(*)::int n from unsubscribed_claims where negotiation_id=${neg.id}`;
    if (opts.overfill) {
      const ok = cc!.n <= 3;
      edge.push({
        name: "قروب ممتلئ: 5 مطالبات على 3 مقاعد",
        pass: ok,
        detail: `claims=${cc!.n}`,
        at: new Date().toISOString(),
      });
      if (!ok) return fail(`overfill_claims_${cc!.n}`);
    } else if (cc!.n !== claimers.length)
      return fail(`claims_mismatch_${cc!.n}_vs_${claimers.length}`);
    // محادثة قصيرة ثم الاتفاق
    await post("rider", cb(rider.chat, `unsub:sel:${neg.id}:1`), "group_select");
    const [first] = await sql<
      { tg: string }[]
    >`select u.telegram_id::text tg from unsubscribed_claims c join drivers d on d.id=c.driver_id join users u on u.id=d.user_id where c.negotiation_id=${neg.id} order by position limit 1`;
    const firstChat = Number(first!.tg);
    await post("driver", text(firstChat, "أوصلك بثلاثين ريال"), "group_chat");
    await post("rider", text(rider.chat, "تمام اتفقنا"), "group_chat");
    await post("rider", cb(rider.chat, `unsub:agree:${neg.id}`), "group_agree");
    const st = await waitFor(
      async () => ((await orderStatus(order.id)) === "matched" ? "m" : null),
      12000,
    );
    if (!st) return fail(`agree_not_matched_${await orderStatus(order.id)}`);
    await post("driver", cb(firstChat, `ride:start:${order.id}`), "driver_start");
    await waitFor(async () => (await orderStatus(order.id)) === "in_progress", 10000, 200);
    await sleep(rnd(300, 1500));
    await post("driver", cb(firstChat, `ride:complete:${order.id}`), "driver_complete");
    const fin =
      (await waitFor(
        async () => {
          const x = await orderStatus(order.id);
          return x === "completed" ? x : null;
        },
        10000,
        200,
      )) ?? (await orderStatus(order.id));
    if (fin !== "completed") return fail(`group_ride_not_completed_${fin}`);
    s.ok++;
    s.e2e.push(Date.now() - t);
  } catch (e) {
    err(`scenario_exc:group:${(e as Error).message.slice(0, 60)}`);
    fail("exception");
  } finally {
    for (const d of claimers) d.busy = false;
    rider.busy = false;
  }
}

// ───────────────────────── الحالات الحدّية ─────────────────────────
async function edgeCase(name: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [pass, detail] = await fn();
    edge.push({ name, pass, detail, at: new Date().toISOString() });
    log("edge", { name, pass, detail });
  } catch (e) {
    edge.push({
      name,
      pass: false,
      detail: `exception: ${(e as Error).message.slice(0, 120)}`,
      at: new Date().toISOString(),
    });
  }
}
async function newSearchingOrder(cities = ["JED", "MKK", "RUH"]) {
  const r = takeRider(cities);
  if (!r) return null;
  const t = Date.now();
  await post("rider", text(r.chat, "/ride"), "rider_ride_cmd");
  await post("rider", loc(r.chat, near(CITIES[r.city]!.center, 1)), "rider_pickup");
  await post("rider", loc(r.chat, near(CITIES[r.city]!.center, 3)), "rider_dropoff");
  const o = await waitFor(() => latestOrder(r.chat, t - 1000), 20000, 250);
  return o ? { rider: r, order: o } : ((r.busy = false), null);
}
async function runEdgeSuite(round: number) {
  await edgeCase(`[${round}] سرّ ويبهوك خاطئ يُرفض`, async () => {
    const st = await post("rider", text(7_299_999, "/start"), "edge", {
      secret: "wrong-secret-wrong-secret-wrong-secret",
    });
    return [st === 401 || st === 403, `status=${st}`];
  });
  await edgeCase(`[${round}] JSON مشوّه لا يُسقط الخادم`, async () => {
    const st = await post("rider", null, "edge", { raw: "{not json" });
    const h = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.status)
      .catch(() => 0);
    return [st >= 400 && st < 500 && h === 200, `status=${st} health=${h}`];
  });
  await edgeCase(
    `[${round}] تكرار نفس update_id (إعادة تسليم تيليجرام) لا يضاعف القبول`,
    async () => {
      const x = await newSearchingOrder();
      if (!x) return [false, "no rider"];
      try {
        const offered = await waitFor(
          async () => (await pendingOfferDrivers(x.order.id)).find((c) => !byChat(c)?.busy),
          8000,
        );
        if (!offered) {
          await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
          return [true, "skipped: no offer (supply busy)"];
        }
        const d = byChat(offered)!;
        d.busy = true;
        const u = cb(offered, `offer:accept:${x.order.id}`);
        const [a, b] = await Promise.all([
          post("driver", u, "edge_dup"),
          post("driver", u, "edge_dup"),
        ]);
        await waitFor(async () => (await orderStatus(x.order.id)) === "matched", 10000, 200);
        await sleep(1500);
        const [n] = await sql<
          { n: number }[]
        >`select count(*)::int n from order_offers where order_id=${x.order.id} and status='accepted'`;
        await post("driver", cb(offered, `ride:start:${x.order.id}`), "driver_start");
        await waitFor(async () => (await orderStatus(x.order.id)) === "in_progress", 10000, 200);
        await post("driver", cb(offered, `ride:complete:${x.order.id}`), "driver_complete");
        await waitFor(async () => (await orderStatus(x.order.id)) === "completed", 10000, 200);
        // تكرار الإنهاء (idempotent)
        const c = await post("driver", cb(offered, `ride:complete:${x.order.id}`), "edge_dup");
        await sleep(1500);
        const st = await orderStatus(x.order.id);
        d.busy = false;
        return [
          n!.n === 1 && st === "completed" && c === 200,
          `http=${a},${b} accepted=${n!.n} final=${st} dupComplete=${c}`,
        ];
      } finally {
        x.rider.busy = false;
      }
    },
  );
  await edgeCase(`[${round}] تضارب: سائقان يقبلان نفس الطلب في نفس اللحظة`, async () => {
    const x = await newSearchingOrder();
    if (!x) return [false, "no rider"];
    try {
      const offered = await waitFor(async () => {
        const o = (await pendingOfferDrivers(x.order.id)).filter((c) => !byChat(c)?.busy);
        return o.length ? o : null;
      }, 8000);
      if (!offered) {
        await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
        return [true, "skipped: no offer"];
      }
      const other = drivers.find(
        (d) =>
          d.city === x.rider.city &&
          !d.busy &&
          d.subscribed &&
          d.service === "transport" &&
          d.chat !== offered[0],
      );
      const racers = [offered[0]!, ...(offered[1] ? [offered[1]] : other ? [other.chat] : [])];
      for (const c of racers) byChat(c)!.busy = true;
      await Promise.all(
        racers.map((c) => post("driver", cb(c, `offer:accept:${x.order.id}`), "edge_race")),
      );
      await waitFor(async () => (await orderStatus(x.order.id)) === "matched", 10000, 200);
      await sleep(2000);
      const [o] = await sql<
        { status: string; assigned_driver_id: string | null }[]
      >`select status::text, assigned_driver_id from orders where id=${x.order.id}`;
      const [n] = await sql<
        { n: number }[]
      >`select count(*)::int n from order_offers where order_id=${x.order.id} and status='accepted'`;
      await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
      for (const c of racers) byChat(c)!.busy = false;
      for (const c of racers) {
        await post("driver", text(c, "/available"), "driver_available");
        await post("driver", loc(c, byChat(c)!.at), "driver_location");
      }
      return [
        o!.status === "matched" && n!.n === 1,
        `racers=${racers.length} status=${o!.status} accepted_offers=${n!.n}`,
      ];
    } finally {
      x.rider.busy = false;
    }
  });
  await edgeCase(`[${round}] زبون يطلب مشواراً ثانياً وله طلب نشط`, async () => {
    const x = await newSearchingOrder();
    if (!x) return [false, "no rider"];
    try {
      const t = Date.now();
      await post("rider", text(x.rider.chat, "/ride"), "edge_double");
      await post("rider", loc(x.rider.chat, near(CITIES[x.rider.city]!.center, 1)), "edge_double");
      await post("rider", loc(x.rider.chat, near(CITIES[x.rider.city]!.center, 3)), "edge_double");
      await sleep(4000);
      const [n] = await sql<
        { n: number }[]
      >`select count(*)::int n from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id where u.telegram_id=${x.rider.chat} and o.status in ('searching','matched','in_progress')`;
      await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
      await sleep(300);
      await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
      return [n!.n <= 1, `active_orders=${n!.n} (since ${Date.now() - t}ms)`];
    } finally {
      x.rider.busy = false;
    }
  });
  await edgeCase(`[${round}] سائق غير متاح لا تصله عروض`, async () => {
    const d = drivers.find(
      (x) => x.city === "JED" && x.service === "transport" && !x.busy && x.subscribed,
    );
    if (!d) return [true, "skipped: all busy"];
    d.busy = true;
    await post("driver", text(d.chat, "/unavailable"), "driver_unavailable");
    await waitFor(
      async () =>
        (
          await sql<
            { a: boolean }[]
          >`select is_available a from driver_availability where driver_id=${d.id!}`
        )[0]?.a === false,
      8000,
      250,
    );
    const [a] = await sql<
      { is_available: boolean }[]
    >`select is_available from driver_availability where driver_id=${d.id!}`;
    const x = await newSearchingOrder(["JED"]);
    await sleep(1500);
    let got = 0;
    if (x) {
      got = (await pendingOfferDrivers(x.order.id)).filter((c) => c === d.chat).length;
      await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
      x.rider.busy = false;
    }
    await post("driver", text(d.chat, "/available"), "driver_available");
    await post("driver", loc(d.chat, d.at), "driver_location");
    d.busy = false;
    return [
      a?.is_available === false && got === 0,
      `is_available=${a?.is_available} offers_to_unavailable=${got}`,
    ];
  });
  await edgeCase(`[${round}] مطالبة مكررة من نفس السائق في القروب`, async () => {
    const x = await newSearchingOrder(["TIF", "MED"]);
    if (!x) return [false, "no group rider"];
    try {
      const neg = await waitFor(
        async () =>
          (
            await sql<
              { id: string }[]
            >`select id from unsubscribed_negotiations where order_id=${x.order.id} limit 1`
          )[0],
        150000,
        1000,
      );
      if (!neg) return [false, "not published within 150s"];
      const g = groups.find(
        (q) => q.city === x.rider.city && q.kind === "unsubscribed_drivers",
      )!.id;
      const d = drivers.find((q) => q.city === x.rider.city && !q.subscribed && !q.busy)!;
      d.busy = true;
      await Promise.all(
        [1, 2, 3].map(() =>
          post("driver", cb(d.chat, `unsub:claim:${neg.id}`, g), "edge_dup_claim"),
        ),
      );
      await sleep(4000);
      const [n] = await sql<
        { n: number }[]
      >`select count(*)::int n from unsubscribed_claims where negotiation_id=${neg.id} and driver_id=${d.id!}`;
      d.busy = false;
      return [n!.n === 1, `claims_by_same_driver=${n!.n}`];
    } finally {
      await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
      x.rider.busy = false;
    }
  });
  await edgeCase(`[${round}] طلبات انضمام القروبات (موثّق/زبون/قروب مجهول)`, async () => {
    const before = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.status,
    );
    const unsub = groups.find((g) => g.city === "TIF" && g.kind === "unsubscribed_drivers")!.id;
    const foreign = groups.find((g) => g.kind === "foreign_unregistered")!.id;
    const jr = (user: number, chat: number) => ({
      update_id: ++updateId,
      chat_join_request: {
        chat: { id: chat, type: "supergroup", title: "g" },
        from: { id: user, is_bot: false, first_name: "t" },
        user_chat_id: user,
        date: Math.floor(Date.now() / 1000),
      },
    });
    const d = drivers.find((q) => q.city === "TIF" && !q.subscribed)!;
    const s1 = await post("driver", jr(d.chat, unsub), "group_join");
    const s2 = await post("driver", jr(riders[0]!.chat, unsub), "group_join");
    const s3 = await post("driver", jr(d.chat, foreign), "group_join");
    const after = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.status,
    );
    return [
      s1 === 200 && s2 === 200 && s3 === 200 && before === 200 && after === 200,
      `driver=${s1} rider=${s2} foreign=${s3}`,
    ];
  });
}

async function chaosGatewayRestart() {
  await edgeCase("انقطاع: قتل البوّابة (SIGKILL) أثناء الحمل ثم إعادة تشغيلها", async () => {
    const pid = spawnSync("pgrep", ["-f", "apps/gateway/src/index.ts"])
      .stdout.toString()
      .trim()
      .split("\n")[0];
    const t = Date.now();
    spawnSync("kill", ["-9", pid ?? ""]);
    await sleep(3000);
    // مُنفصلٌ بلا أنابيب: spawnSync كانَ ينتظرُ صدفةً أبًا تُمسكُ أنبوبَ الإخراجِ ما عاشت البوّابة،
    // فتجمّدَ المولّدُ مرّتين في جلسةِ 2026-10-15 بعدَ اختبارِ القتل.
    spawn(`${ROOT}/run_services.sh`, ["gateway"], { detached: true, stdio: "ignore" }).unref();
    const up = await waitFor(
      async () =>
        (await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.status)
          .catch(() => 0)) === 200,
      60000,
      250,
    );
    const rec = Date.now() - t;
    fixes.push(`استعادة بعد انقطاع البوّابة خلال ${rec}ms`);
    return [!!up, `pid=${pid} recovered_in=${rec}ms (incl. 3s down)`];
  });
}
async function chaosDbDisconnect() {
  await edgeCase(
    "انقطاع قاعدة البيانات: إنهاء كل اتصالات البوّابة (pg_terminate_backend)",
    async () => {
      const [k] = await sql<
        { n: number }[]
      >`select count(*)::int n from (select pg_terminate_backend(pid) from pg_stat_activity
      where datname=current_database() and pid<>pg_backend_pid() and application_name not like '%soak%' and backend_type='client backend') x`;
      await sleep(500);
      const ok = await waitFor(
        async () =>
          (await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(2000) })
            .then((r) => r.status)
            .catch(() => 0)) === 200,
        30000,
        250,
      );
      const x = await newSearchingOrder();
      const created = !!x;
      if (x) {
        await post("rider", text(x.rider.chat, "/cancel"), "rider_cancel");
        x.rider.busy = false;
      }
      return [!!ok && created, `terminated=${k!.n} ready_after=${!!ok} new_order_after=${created}`];
    },
  );
}

// ───────────────────────── التقارير ─────────────────────────
async function dbSnapshot() {
  const byStatus = await sql<
    { service: string; status: string; n: number }[]
  >`select service::text, status::text, count(*)::int n from orders group by 1,2 order by 1,2`;
  const neg = await sql<
    { status: string; n: number }[]
  >`select status::text, count(*)::int n from unsubscribed_negotiations group by 1`;
  const [misc] = await sql<
    { offers: number; ratings: number; outbox_pending: number; conns: number; stuck: number }[]
  >`
    select (select count(*)::int from order_offers) offers, (select count(*)::int from ratings) ratings,
           (select count(*)::int from notification_outbox where delivered_at is null) outbox_pending,
           (select count(*)::int from pg_stat_activity where datname=current_database()) conns,
           (select count(*)::int from orders where status in ('matched','in_progress') and updated_at < now() - interval '5 minutes') stuck`.catch(
    async () => [{ offers: -1, ratings: -1, outbox_pending: -1, conns: -1, stuck: -1 }],
  );
  return { byStatus, neg, misc };
}
function telegramStats() {
  try {
    return JSON.parse(readFileSync(`${ROOT}/logs/telegram-mock-stats.json`, "utf8"));
  } catch {
    return null;
  }
}
let lastHttp = 0,
  lastT = Date.now(),
  lastLatIdx = 0;
function tick() {
  const now = Date.now();
  const rps = (http.total - lastHttp) / ((now - lastT) / 1000);
  const recent = http.lat.slice(lastLatIdx);
  timeline.push({
    min: +mins().toFixed(1),
    phase,
    conc: concurrency,
    rps: +rps.toFixed(1),
    p95: pct(recent, 95),
    okRate: http.total ? +((100 * http.ok) / http.total).toFixed(2) : 0,
  });
  lastHttp = http.total;
  lastT = now;
  lastLatIdx = http.lat.length;
}
async function report(label: string) {
  const snap = await dbSnapshot();
  const out = {
    label,
    at: new Date().toISOString(),
    minute: +mins().toFixed(1),
    phase,
    concurrency,
    peakConcurrency,
    http: {
      total: http.total,
      ok: http.ok,
      non2xx: http.non2xx,
      netErr: http.netErr,
      p50: pct(http.lat, 50),
      p95: pct(http.lat, 95),
      p99: pct(http.lat, 99),
      max: pct(http.lat, 100),
    },
    perKind: Object.fromEntries(
      Object.entries(http.byKind).map(([k, v]) => [
        k,
        { n: v.length, p50: pct(v, 50), p95: pct(v, 95), max: pct(v, 100) },
      ]),
    ),
    scenarios: Object.fromEntries(
      Object.entries(sc).map(([k, v]) => [
        k,
        {
          started: v.started,
          ok: v.ok,
          fail: v.fail,
          successRate: v.ok + v.fail ? +((100 * v.ok) / (v.ok + v.fail)).toFixed(1) : null,
          e2e_p50_ms: pct(v.e2e, 50),
          e2e_p95_ms: pct(v.e2e, 95),
          reasons: v.reasons,
        },
      ]),
    ),
    edge,
    errors,
    fixes,
    db: snap,
    telegram: telegramStats(),
    timeline,
  };
  writeFileSync(`${ROOT}/reports/${label}.json`, JSON.stringify(out, null, 2));
  writeFileSync(`${ROOT}/reports/latest.json`, JSON.stringify(out, null, 2));
  console.log(
    `[report ${label}] min=${out.minute} phase=${phase} conc=${concurrency} http=${http.total} ok%=${http.total ? ((100 * http.ok) / http.total).toFixed(2) : 0} p95=${out.http.p95}ms`,
    Object.entries(out.scenarios)
      .map(([k, v]) => `${k}:${v.ok}/${v.ok + v.fail}`)
      .join(" "),
  );
}

// ───────────────────────── المنسّق ─────────────────────────
let running = true;
async function worker(id: number, getTarget: () => number, mix: () => Promise<void>) {
  while (running) {
    if (id >= getTarget()) {
      await sleep(500);
      continue;
    }
    concurrency++;
    peakConcurrency = Math.max(peakConcurrency, concurrency);
    try {
      await mix();
    } catch (e) {
      err(`worker_exc:${(e as Error).message.slice(0, 60)}`);
    }
    concurrency--;
    await sleep(rnd(50, 400));
  }
}
const intensiveMix = async () => {
  const x = Math.random();
  if (x < 0.42) return rideOrDelivery("ride");
  if (x < 0.8) return rideOrDelivery("delivery");
  return groupScenario();
};
const edgeMix = async () => {
  const x = Math.random();
  if (x < 0.25) return rideOrDelivery("ride");
  if (x < 0.45) return rideOrDelivery("delivery");
  if (x < 0.6)
    return rideOrDelivery(Math.random() < 0.5 ? "ride" : "delivery", { cancelAt: "searching" });
  if (x < 0.75) return rideOrDelivery("ride", { cancelAt: "matched" });
  if (x < 0.88) return groupScenario();
  return groupScenario({ overfill: true });
};

async function main() {
  console.log(
    `[soak] start ${new Date().toISOString()} intensive=${INTENSIVE_MIN}m edge=${EDGE_MIN}m`,
  );
  if (process.env.EDGE_ONLY) {
    phase = "edge";
    await loadWorld();
    void locationHeartbeat();
    let target = 12;
    running = true;
    void Array.from({ length: 12 }, (_, i) =>
      worker(
        i,
        () => target,
        () => edgeMix(),
      ),
    );
    await runEdgeSuite(2);
    await chaosGatewayRestart();
    await sleep(20000);
    running = false;
    heartbeatOn = false;
    target = 0;
    await waitFor(async () => concurrency === 0, 120000, 500);
    await report("edge_round2");
    await sql.end({ timeout: 5 });
    process.exit(0);
  }
  await seed();
  const seedEnd = mins();
  if (process.env.SMOKE) {
    await Promise.all([
      rideOrDelivery("ride"),
      rideOrDelivery("delivery"),
      process.env.SMOKE === "2" ? groupScenario() : Promise.resolve(),
    ]);
    await report("smoke");
    console.log(JSON.stringify({ sc, errors }, null, 1));
    await sql.end({ timeout: 5 });
    process.exit(0);
  }
  void locationHeartbeat();
  let reportN = 0;
  const reporter = setInterval(() => {
    tick();
  }, 30000);
  const tenMin = setInterval(() => {
    reportN++;
    void report(`report_${String(reportN * REPORT_EVERY_MIN).padStart(2, "0")}min`);
  }, REPORT_EVERY_MIN * 60000);

  // المرحلة المكثفة: تصاعد التوازي 4 → 8 → 12 → 16 → 20 → 24 كل ~5 دقائق
  phase = "intensive";
  let target = 4;
  const steps = [4, 8, 12, 16, 20, 24];
  const stepMs = (INTENSIVE_MIN * 60000) / steps.length;
  void Array.from({ length: 40 }, (_, i) =>
    worker(
      i,
      () => target,
      () => (phase === "edge" ? edgeMix() : intensiveMix()),
    ),
  );
  for (const s of steps) {
    target = s;
    log("ramp", { target });
    console.log(`[ramp] target concurrency=${s} at min ${mins().toFixed(1)}`);
    await sleep(stepMs);
  }

  // مرحلة الضغط والحالات الحدّية
  phase = "edge";
  target = 30;
  log("phase.edge");
  console.log(`[edge] start at min ${mins().toFixed(1)}`);
  const edgeEnd = Date.now() + EDGE_MIN * 60000;
  // دفقة: 40 طلب متزامن
  target = 40;
  await sleep(60000);
  target = 30;
  await runEdgeSuite(1);
  await chaosDbDisconnect();
  await chaosGatewayRestart();
  await runEdgeSuite(2);
  while (Date.now() < edgeEnd) await sleep(2000);

  // إيقاف الحمل
  phase = "cooldown";
  running = false;
  heartbeatOn = false;
  target = 0;
  console.log(`[cooldown] draining at min ${mins().toFixed(1)}`);
  await waitFor(async () => concurrency === 0, 120000, 500);
  clearInterval(reporter);
  clearInterval(tenMin);
  tick();
  await sleep(5000);
  await report("final");
  log("done", { seedMinutes: +seedEnd.toFixed(2) });
  await sql.end({ timeout: 5 });
  process.exit(0);
}
main().catch(async (e) => {
  console.error("[soak] fatal", e);
  await report("crash").catch(() => {});
  process.exit(1);
});
