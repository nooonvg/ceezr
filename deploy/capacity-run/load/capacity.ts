/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * CAP-RUN-20261016 — مولّد حمل مستقل للبوابة الحقيقية (webhook تيليجرام عبر HTTP).
 *
 * مبادئ:
 * 1) قبول السائق للعرض مشروط بوصول رسالة العرض (زر `offer:accept:<orderId>`) إلى صندوقه في
 *    محاكي تيليجرام. المولّد لا يقرأ order_offers من القاعدة أبدًا لاكتشاف العروض.
 *    القاعدة تُقرأ فقط للتحقق (حالة الطلب، السائق المُسنَد) ولربط بطاقة القروب بطلبها.
 * 2) لا spawnSync ولا عمليات فرعية: الفوضى (قتل البوابة…) يحقنها منسّق مستقل. المولّد يكتشف موت
 *    البوابة من فشل الشبكة، فيوقف الإرسال ويعيد المحاولة بنفس update_id (idempotent) بعد عودتها.
 * 3) كل نداء له مهلة (AbortSignal.timeout)، ولا انتظار بلا سقف.
 * 4) التزامن الفعلي = عدد السيناريوهات الجارية في اللحظة (كلٌّ يملك زبونًا مستقلًا)، ويُسجَّل كل 10ث
 *    مع عدد طلبات HTTP قيد التنفيذ ومعدل الطلبات.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { type DriverOnboardingRecord, onboardDriverViaApp } from "./driver-onboarding.ts";

// ───────── إعداد ─────────
const RUN_DIR = process.env.RUN_DIR ?? "/tmp/cap-run";
const EV = `${RUN_DIR}/evidence`;
mkdirSync(EV, { recursive: true });
const BASE = process.env.GATEWAY_URL ?? "http://127.0.0.1:54300";
const MOCK = process.env.MOCK_TELEGRAM_URL ?? "http://127.0.0.1:58090";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;
const DB_URL = process.env.DATABASE_URL!;
const N_DRIVERS = Number(process.env.N_DRIVERS ?? 1000);
const N_RIDERS = Number(process.env.N_RIDERS ?? 1000);
const SEED = process.env.SEED === "1";
const GEN_ID = process.env.GEN_ID ?? "gen1";
type Phase = { name: string; sec: number; conc: number };
const PROFILE: Phase[] = JSON.parse(
  process.env.PROFILE ?? '[{"name":"smoke","sec":120,"conc":10}]',
);
const MIX = JSON.parse(process.env.MIX ?? '{"ride":0.47,"delivery":0.38,"group":0.15}') as Record<
  string,
  number
>;
const MATCH_WAIT_MS = Number(process.env.MATCH_WAIT_MS ?? 120_000);
const sql = postgres(`${DB_URL}?application_name=${GEN_ID}`, {
  max: 8,
  idle_timeout: 20,
  connect_timeout: 10,
});

const T0 = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
let phase = "init";
function ev(event: string, data: Record<string, unknown> = {}) {
  appendFileSync(
    `${EV}/load-events.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), s: +((Date.now() - T0) / 1000).toFixed(1), gen: GEN_ID, phase, event, ...data })}\n`,
  );
}

// ───────── قياس ─────────
class Hist {
  // مخطط دلاء لوغاريتمية (1ms..10min) — دقيق بما يكفي لـ p50/p95/p99 بلا ذاكرة متنامية
  b = new Float64Array(400);
  n = 0;
  add(ms: number) {
    const i = Math.min(
      399,
      Math.max(0, Math.floor(Math.log(Math.max(ms, 0.1) * 10) / Math.log(1.06))),
    );
    this.b[i]!++;
    this.n++;
  }
  q(p: number) {
    if (this.n === 0) return 0;
    let acc = 0;
    const target = this.n * p;
    for (let i = 0; i < 400; i++) {
      acc += this.b[i]!;
      if (acc >= target) return +(1.06 ** (i + 1) / 10).toFixed(1);
    }
    return 0;
  }
  sum() {
    return { n: this.n, p50: this.q(0.5), p95: this.q(0.95), p99: this.q(0.99) };
  }
}
const http = {
  total: 0,
  ok: 0,
  non2xx: 0,
  netErr: 0,
  timeouts: 0,
  refused: 0,
  retried: 0,
  inflight: 0,
  peakInflight: 0,
};
const httpHist = new Hist();
const httpWin = { hist: new Hist(), n: 0 };
const byKind: Record<string, Hist> = {};
type Sc = { started: number; ok: number; fail: number; reasons: Record<string, number>; e2e: Hist };
const sc: Record<string, Sc> = {};
const scen = (n: string) =>
  (sc[n] ??= { started: 0, ok: 0, fail: 0, reasons: {}, e2e: new Hist() });
const biz = {
  createToOrder: new Hist(), // إرسال الطلب حتى ظهور الطلب في القاعدة
  orderToOfferSeen: new Hist(), // إنشاء الطلب (أول ظهور) حتى وصول أول عرض لصندوق سائق في المحاكي
  offerSeenToAccept: new Hist(), // وصول العرض حتى إرسال القبول
  acceptToMatched: new Hist(),
  groupCardWait: new Hist(),
  offersSeen: 0,
  offersAcceptedSent: 0,
  offersRejectedSent: 0,
  offersIgnored: 0,
  offersWhileBusy: 0,
  acceptLost: 0,
  duplicateUpdatesSent: 0,
};
const errors: Record<string, number> = {};
const errc = (k: string) => (errors[k] = (errors[k] ?? 0) + 1);
let concurrency = 0;
let peakConcurrency = 0;
let target = 0;

// ───────── تحديثات تيليجرام ─────────
let updateId = (Math.floor(Date.now() / 1000) % 100_000_000) * 20 + (GEN_ID === "gen1" ? 0 : 7);
const nextId = () => (updateId += 1);
const from = (c: number) => ({ id: c, is_bot: false, first_name: "sbx", language_code: "ar" });
const msg = (c: number, body: Record<string, unknown>) => {
  const id = nextId();
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: c, type: "private" },
      from: from(c),
      ...body,
    },
  };
};
const text = (c: number, v: string) => msg(c, { text: v });
type P = { lat: number; lng: number };
const loc = (c: number, p: P) => msg(c, { location: { latitude: p.lat, longitude: p.lng } });
const cb = (c: number, data: string, chatId = c) => {
  const id = nextId();
  return {
    update_id: id,
    callback_query: {
      id: String(id),
      data,
      chat_instance: "sbx",
      from: from(c),
      message: {
        message_id: 1,
        date: 0,
        chat: { id: chatId, type: chatId < 0 ? "supergroup" : "private" },
      },
    },
  };
};

// ───────── HTTP مع اكتشاف موت البوابة ─────────
let gatewayDownSince: number | null = null;
const outages: { from: string; to: string; ms: number }[] = [];
let _healthLoop: Promise<void> | null = null;
function markDown() {
  if (gatewayDownSince !== null) return;
  gatewayDownSince = Date.now();
  ev("gateway.down_detected");
  _healthLoop ??= (async () => {
    while (gatewayDownSince !== null) {
      try {
        const r = await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(1500) });
        if (r.status === 200) {
          const ms = Date.now() - gatewayDownSince;
          outages.push({
            from: new Date(gatewayDownSince).toISOString(),
            to: new Date().toISOString(),
            ms,
          });
          ev("gateway.up_detected", { downMs: ms });
          gatewayDownSince = null;
          break;
        }
      } catch {}
      await sleep(300);
    }
    _healthLoop = null;
  })();
}
async function waitUp(maxMs: number) {
  const end = Date.now() + maxMs;
  while (gatewayDownSince !== null && Date.now() < end) await sleep(200);
  return gatewayDownSince === null;
}

async function post(
  bot: "driver" | "rider",
  update: unknown,
  kind: string,
  opts: { secret?: string; raw?: string; noRetry?: boolean } = {},
): Promise<number> {
  const body = opts.raw ?? JSON.stringify(update);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (gatewayDownSince !== null && !opts.noRetry) {
      if (!(await waitUp(60_000))) break;
    }
    const t = performance.now();
    http.total++;
    http.inflight++;
    if (http.inflight > http.peakInflight) http.peakInflight = http.inflight;
    try {
      const r = await fetch(`${BASE}/webhook/telegram/${bot}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": opts.secret ?? SECRET,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await r.arrayBuffer();
      const d = performance.now() - t;
      httpHist.add(d);
      httpWin.hist.add(d);
      httpWin.n++;
      const hist = byKind[kind] ?? new Hist();
      byKind[kind] = hist;
      hist.add(d);
      if (r.status >= 200 && r.status < 300) http.ok++;
      else {
        http.non2xx++;
        if (!opts.secret && !opts.raw) errc(`http_${r.status}:${kind}`);
        if (r.status >= 500 && !opts.noRetry) {
          http.retried++;
          await sleep(500 * (attempt + 1));
          continue;
        }
      }
      return r.status;
    } catch (e) {
      const name = (e as Error).name;
      const m = String((e as Error).message ?? "");
      http.netErr++;
      if (name === "TimeoutError") http.timeouts++;
      if (/refused|ECONNREFUSED|Unable to connect/i.test(m)) http.refused++;
      errc(`net:${name}`);
      if (opts.noRetry) return 0;
      markDown();
      http.retried++;
      await sleep(300);
    } finally {
      http.inflight--;
    }
  }
  errc(`post_gave_up:${kind}`);
  return 0;
}

// ───────── صندوق الوارد من المحاكي ─────────
type MockEv = {
  seq: number;
  t: number;
  bot: string;
  method: string;
  chat_id: string;
  message_id: number | null;
  status: number;
  text?: string;
  cbs?: string[];
};
type Listener = (e: MockEv) => boolean; // true = استُهلك وأُزيل
const listeners = new Map<string, Set<Listener>>();
let mockCursor = Number(process.env.MOCK_CURSOR ?? -1);
let mockDown = 0;
function listen(chat: string, fn: Listener) {
  let s = listeners.get(chat);
  if (!s) {
    s = new Set();
    listeners.set(chat, s);
  }
  s.add(fn);
  return () => s!.delete(fn);
}
function waitInbox(chat: string, pred: (e: MockEv) => boolean, ms: number): Promise<MockEv | null> {
  return new Promise((resolve) => {
    let done = false;
    const off = listen(chat, (e) => {
      if (done || !pred(e)) return false;
      done = true;
      clearTimeout(tm);
      off();
      resolve(e);
      return true;
    });
    const tm = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(null);
    }, ms);
  });
}
const driverOfferHandlers: ((e: MockEv) => void)[] = [];
async function inboxLoop() {
  if (mockCursor < 0) {
    const j = (await (await fetch(`${MOCK}/health`)).json()) as { seq: number };
    mockCursor = j.seq;
  }
  for (;;) {
    try {
      const j = (await (
        await fetch(`${MOCK}/events?after=${mockCursor}&limit=20000`, {
          signal: AbortSignal.timeout(5000),
        })
      ).json()) as { seq: number; events: MockEv[] };
      for (const e of j.events) {
        mockCursor = e.seq;
        if (e.status !== 200) continue;
        if (e.bot === "driver" && e.cbs?.some((c) => c.startsWith("offer:accept:")))
          for (const h of driverOfferHandlers) h(e);
        const s = listeners.get(e.chat_id);
        if (s) for (const fn of [...s]) fn(e);
      }
      if (j.events.length < 20000) await sleep(150);
    } catch {
      mockDown++;
      await sleep(500);
    }
  }
}

// ───────── لوحة الحالة (قراءة تحقق مجمّعة من القاعدة) ─────────
type OrderRow = { id: string; status: string; driver_tg: string | null };
const tracked = new Map<string, OrderRow>();
const watchers = new Map<string, Set<() => void>>();
const awaitingOrder = new Map<number, { since: number; resolve: (o: OrderRow | null) => void }[]>();
async function boardLoop() {
  for (;;) {
    try {
      const ids = [...tracked.keys()];
      if (ids.length) {
        const rows = await sql<OrderRow[]>`
          select o.id::text, o.status::text, u.telegram_id::text driver_tg from orders o
            left join drivers d on d.id = o.assigned_driver_id left join users u on u.id = d.user_id
           where o.id = any(${ids}::uuid[])`;
        for (const r of rows) {
          const prev = tracked.get(r.id);
          if (prev && (prev.status !== r.status || prev.driver_tg !== r.driver_tg)) {
            tracked.set(r.id, r);
            const w = watchers.get(r.id);
            if (w) for (const f of w) f();
          }
        }
      }
      const riders = [...awaitingOrder.keys()];
      if (riders.length) {
        const minSince = Math.min(
          ...riders.flatMap((r) => awaitingOrder.get(r)!.map((x) => x.since)),
        );
        const rows = await sql<(OrderRow & { tg: string; created: Date })[]>`
          select distinct on (u.telegram_id) u.telegram_id::text tg, o.id::text, o.status::text, o.created_at created, null::text driver_tg
            from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id
           where u.telegram_id = any(${riders.map(String)}::bigint[]) and o.created_at >= to_timestamp(${minSince / 1000})
           order by u.telegram_id, o.created_at desc`;
        for (const r of rows) {
          const w = awaitingOrder.get(Number(r.tg));
          if (!w) continue;
          const keep = w.filter((x) => {
            if (r.created.getTime() >= x.since) {
              x.resolve({ id: r.id, status: r.status, driver_tg: null });
              return false;
            }
            return true;
          });
          if (keep.length) awaitingOrder.set(Number(r.tg), keep);
          else awaitingOrder.delete(Number(r.tg));
        }
      }
    } catch (e) {
      errc(`board:${(e as Error).message.slice(0, 40)}`);
      await sleep(1000);
    }
    await sleep(400);
  }
}
function track(id: string, status = "?") {
  if (!tracked.has(id)) tracked.set(id, { id, status, driver_tg: null });
}
function untrack(id: string) {
  tracked.delete(id);
  watchers.delete(id);
}
function waitOrderCreated(riderChat: number, since: number, ms: number): Promise<OrderRow | null> {
  return new Promise((resolve) => {
    const entry = {
      since,
      resolve: (o: OrderRow | null) => {
        clearTimeout(tm);
        resolve(o);
      },
    };
    const list = awaitingOrder.get(riderChat) ?? [];
    list.push(entry);
    awaitingOrder.set(riderChat, list);
    const tm = setTimeout(() => {
      const l = awaitingOrder.get(riderChat)?.filter((x) => x !== entry) ?? [];
      if (l.length) awaitingOrder.set(riderChat, l);
      else awaitingOrder.delete(riderChat);
      resolve(null);
    }, ms);
  });
}
function waitOrder(
  id: string,
  pred: (o: OrderRow) => boolean,
  ms: number,
): Promise<OrderRow | null> {
  track(id);
  const cur = tracked.get(id)!;
  if (pred(cur)) return Promise.resolve(cur);
  return new Promise((resolve) => {
    let s = watchers.get(id);
    if (!s) {
      s = new Set();
      watchers.set(id, s);
    }
    const f = () => {
      const o = tracked.get(id);
      if (o && pred(o)) {
        clearTimeout(tm);
        s!.delete(f);
        resolve(o);
      }
    };
    s.add(f);
    const tm = setTimeout(() => {
      s!.delete(f);
      resolve(null);
    }, ms);
  });
}

// ───────── العالم ─────────
const CITIES: Record<
  string,
  { center: P; role: "core" | "group"; idx: number; drivers: [number, number]; riders: number }
> = {
  JED: {
    center: { lat: 21.5433, lng: 39.1728 },
    role: "core",
    idx: 1,
    drivers: [160, 100],
    riders: 250,
  },
  MKK: {
    center: { lat: 21.4225, lng: 39.8262 },
    role: "core",
    idx: 2,
    drivers: [120, 80],
    riders: 200,
  },
  RUH: {
    center: { lat: 24.7136, lng: 46.6753 },
    role: "core",
    idx: 3,
    drivers: [150, 90],
    riders: 250,
  },
  TIF: {
    center: { lat: 21.2703, lng: 40.4158 },
    role: "group",
    idx: 4,
    drivers: [150, 0],
    riders: 150,
  },
  MED: {
    center: { lat: 24.4672, lng: 39.6111 },
    role: "group",
    idx: 5,
    drivers: [150, 0],
    riders: 150,
  },
};
const near = (p: P, km: number): P => ({
  lat: p.lat + rnd(-km, km) / 111,
  lng: p.lng + rnd(-km, km) / 105,
});
type DState = "standby" | "idle" | "accepting" | "trip" | "claiming" | "unavailable" | "reserved";
type Driver = {
  chat: number;
  city: string;
  service: "transport" | "delivery";
  subscribed: boolean;
  id?: string;
  state: DState;
  at: P;
  offersSeen: number;
};
type Rider = { chat: number; city: string; busy: boolean };
const cityIds: Record<string, string> = {};
const unsubGroup: Record<string, number> = {};
const drivers: Driver[] = [];
const driverByChat = new Map<number, Driver>();
const riders: Rider[] = [];

function buildWorld() {
  let dc = 7_300_000;
  let rc = 7_600_000;
  const scale = N_DRIVERS / 1000;
  const rscale = N_RIDERS / 1000;
  for (const [code, c] of Object.entries(CITIES)) {
    unsubGroup[code] = -(1000000000000 + c.idx * 10 + 3);
    const [tr, dl] = c.drivers.map((x) => Math.round(x * scale)) as [number, number];
    for (let i = 0; i < tr + dl; i++) {
      const d: Driver = {
        chat: ++dc,
        city: code,
        service: i < tr ? "transport" : "delivery",
        subscribed: c.role === "core",
        state: "idle",
        at: near(c.center, 2.5),
        offersSeen: 0,
      };
      // سائقان مشتركان «خارج الخدمة» في كل مدينة قروب: شرطُ قبولِ الطلب (city_served_services يتطلب سائقًا موثّقًا
      // مشتركًا قادرًا)، ولا يُتاحان أبدًا فيُصعَّد الطلب للقروب بعد 30ث. مستبعَدان من كل نشاط المولّد.
      if (c.role === "group" && i >= tr + dl - 2)
        Object.assign(d, { subscribed: true, state: "standby" });
      drivers.push(d);
      driverByChat.set(d.chat, d);
    }
    for (let i = 0; i < Math.round(c.riders * rscale); i++)
      riders.push({ chat: ++rc, city: code, busy: false });
  }
}

async function poolMap<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k]!, k);
      }
    }),
  );
}

async function seed() {
  phase = "seed";
  ev("seed.start", { drivers: drivers.length, riders: riders.length });
  for (const code of Object.keys(CITIES))
    cityIds[code] = (
      await sql<{ id: string }[]>`select id::text from cities where code=${code}`
    )[0]!.id;
  const t = Date.now();
  // المرحلة 1 (ADR 0286): تسجيلُ السائقِ منَ onboarding/API لا من حوارِ البوتِ —
  // البوتُ في وضعِ miniapp يرفضُ أزرارَ الأعمالِ أصلاً فكانَ هذا البذرُ معطلًا.
  // الوحدةُ تنتظرُ كلَّ مهمةٍ وتحكمُ منَ القاعدةِ (pending) وتوثّقُ خطواتِ المشرفِ.
  // لاحظ: صورةُ المركبةِ ليست في واجهةِ onboarding — إشارةُ اكتمالِ التسجيلِ صارت
  // الحكمَ المتزامنَ للوحدةِ نفسِها لا عدَّ الصورِ.
  let onboarded = 0;
  const onboardingFailures: DriverOnboardingRecord[] = [];
  await poolMap(drivers, 60, async (d) => {
    const record = await onboardDriverViaApp({
      telegramId: d.chat,
      cityId: cityIds[d.city],
      service: d.service,
    });
    if (record.ok) onboarded += 1;
    else onboardingFailures.push(record);
  });
  ev("seed.drivers_onboarded", {
    ok: onboarded,
    failed: onboardingFailures.length,
    ms: Date.now() - t,
  });
  if (process.env.SEED_SKIP_RIDERS !== "1")
    await poolMap(riders, 150, async (r, n) => {
      await post("rider", text(r.chat, "/start"), "seed");
      await post("rider", text(r.chat, `زبون تجريبي ${n + 1}`), "seed");
      await post("rider", cb(r.chat, `city:${cityIds[r.city]}`), "seed");
    });
  ev("seed.rider_updates_posted", { ms: Date.now() - t });
  // انتظار اكتمال تسجيل الجميع (المستنزف يعالج بترتيب كل مستخدم)
  const deadline = Date.now() + 25 * 60_000;
  for (;;) {
    const [c] = await sql<{ d: number; r: number; q: number }[]>`
      select (select count(*)::int from drivers d join users u on u.id = d.user_id
               where u.telegram_id = any(${drivers.map((x) => x.chat)}::bigint[]) and d.verification_status = 'verified') d,
             (select count(*)::int from riders) r,
             (select count(*)::int from telegram_update_jobs where status in ('pending','claimed')) q`;
    ev("seed.progress", c!);
    console.log(
      `[seed] drivers=${c!.d}/${drivers.length} riders=${c!.r}/${riders.length} queue=${c!.q}`,
    );
    if ((c!.d >= drivers.length && c!.r >= riders.length) || Date.now() > deadline) break;
    if (c!.q === 0 && Date.now() - t > 60_000) break;
    await sleep(5000);
  }
  // اعتماد الوثائق وبدء التجربة كما يفعل المشرف (اختصار معلن: KYC اليدوي ليس موضوع هذا الاختبار)
  await sql`update drivers set verification_status='verified' where verification_status <> 'verified'`;
  await sql`select start_trial(d.id, (select dc.service::text from driver_capabilities dc where dc.driver_id=d.id limit 1)::subscription_plan)
              from drivers d where not exists (select 1 from subscriptions s where s.driver_id=d.id)`;
  await sql`update subscriptions s set status='expired' from drivers d join cities c on c.id=d.city_id
             where s.driver_id=d.id and c.code in ('TIF','MED') and (select u.telegram_id from users u where u.id=d.user_id) not in (7300849,7300850,7300999,7301000)`;
  ev("seed.verified");
  await loadIds();
  await poolMap(
    drivers.filter((d) => d.id && d.state !== "standby"),
    100,
    async (d) => {
      await post("driver", text(d.chat, "/available"), "seed");
      await post("driver", loc(d.chat, d.at), "seed");
    },
  );
  ev("seed.done", { ms: Date.now() - t });
}

async function reseedMissing() {
  phase = "reseed";
  for (const code of Object.keys(CITIES))
    cityIds[code] = (
      await sql<{ id: string }[]>`select id::text from cities where code=${code}`
    )[0]!.id;
  const have = new Set(
    (await sql<{ tg: string }[]>`select telegram_id::text tg from users`).map((r) => Number(r.tg)),
  );
  const md = drivers.filter((d) => !have.has(d.chat));
  const haveR = new Set(
    (
      await sql<
        { tg: string }[]
      >`select u.telegram_id::text tg from riders r join users u on u.id=r.user_id`
    ).map((r) => Number(r.tg)),
  );
  const mr = riders.filter((r) => !haveR.has(r.chat));
  ev("reseed.start", { drivers: md.length, riders: mr.length });
  let reOnboarded = 0;
  await poolMap(md, 40, async (d) => {
    const record = await onboardDriverViaApp({
      telegramId: d.chat,
      cityId: cityIds[d.city],
      service: d.service,
    });
    if (record.ok) reOnboarded += 1;
  });
  ev("reseed.drivers_onboarded", { ok: reOnboarded, total: md.length });
  await poolMap(mr, 40, async (r, n) => {
    await post("rider", text(r.chat, "/start"), "seed");
    await post("rider", text(r.chat, `زبون تجريبي ب${n + 1}`), "seed");
    await post("rider", cb(r.chat, `city:${cityIds[r.city]}`), "seed");
  });
  for (let i = 0; i < 60; i++) {
    const [q] = await sql<
      { q: number }[]
    >`select count(*)::int q from telegram_update_jobs where status in ('pending','claimed')`;
    if (q!.q === 0) break;
    await sleep(5000);
  }
  await sql`update drivers set verification_status='verified' where verification_status <> 'verified'`;
  await sql`select start_trial(d.id, (select dc.service::text from driver_capabilities dc where dc.driver_id=d.id limit 1)::subscription_plan)
              from drivers d where not exists (select 1 from subscriptions s where s.driver_id=d.id)`;
  await sql`update subscriptions s set status='expired' from drivers d join cities c on c.id=d.city_id
             where s.driver_id=d.id and c.code in ('TIF','MED') and s.status <> 'expired' and (select u.telegram_id from users u where u.id=d.user_id) not in (7300849,7300850,7300999,7301000)`;
  ev("reseed.done");
}

async function loadIds() {
  for (const code of Object.keys(CITIES))
    cityIds[code] = (
      await sql<{ id: string }[]>`select id::text from cities where code=${code}`
    )[0]!.id;
  const rows = await sql<
    { tg: string; id: string }[]
  >`select u.telegram_id::text tg, d.id::text from drivers d join users u on u.id=d.user_id`;
  for (const r of rows) {
    const d = driverByChat.get(Number(r.tg));
    if (d) d.id = r.id;
  }
  const rr = await sql<
    { tg: string }[]
  >`select u.telegram_id::text tg from riders r join users u on u.id=r.user_id`;
  const have = new Set(rr.map((r) => Number(r.tg)));
  const missingR = riders.filter((r) => !have.has(r.chat)).length;
  const missingD = drivers.filter((d) => !d.id).length;
  ev("world.loaded", {
    drivers_registered: drivers.length - missingD,
    riders_registered: riders.length - missingR,
  });
  // من لم يُسجَّل لا يُستخدم
  for (let i = drivers.length - 1; i >= 0; i--) if (!drivers[i]!.id) drivers.splice(i, 1);
  for (let i = riders.length - 1; i >= 0; i--) if (!have.has(riders[i]!.chat)) riders.splice(i, 1);
}

async function resetActive() {
  // بداية جولة: إلغاء ما تبقى من طلبات الجولة السابقة عبر البوت نفسه (لمن له طلب نشط فقط)، وإتاحة السائقين،
  // ثم انتظار تفريغ طابور الوارد قبل بدء القياس — حتى لا تُحسَب دفعةُ التهيئة ضمن حمل الجولة.
  phase = "reset";
  const t0 = Date.now();
  const active = new Set(
    (
      await sql<
        { tg: string }[]
      >`select distinct u.telegram_id::text tg from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id
     where o.status::text in ('searching','matched','in_progress','pending','scheduled')`
    ).map((r) => Number(r.tg)),
  );
  await poolMap(
    riders.filter((r) => active.has(r.chat)),
    50,
    async (r) => void (await post("rider", text(r.chat, "/cancel"), "reset")),
  );
  await sleep(3000);
  const dl = drivers.filter((d) => d.state !== "standby");
  await poolMap(dl, 50, async (d) => {
    await post("driver", text(d.chat, "/available"), "reset");
    await post("driver", loc(d.chat, d.at), "reset");
  });
  let q = -1;
  for (let i = 0; i < 240; i++) {
    const [r] = await sql<
      { q: number }[]
    >`select count(*)::int q from telegram_update_jobs where status in ('pending','claimed')`;
    q = r!.q;
    if (q <= 5) break;
    if (i % 6 === 0) console.log(`[reset] queue=${q}`);
    await sleep(5000);
  }
  ev("reset.done", {
    cancelled_riders: active.size,
    drivers_made_available: dl.length,
    queue_left: q,
    ms: Date.now() - t0,
  });
}

// ───────── سلوك السائق: يتصرف فقط على العروض الواصلة إلى صندوقه ─────────
const offerSeenAt = new Map<string, number>(); // `${order}:${driverChat}` → وقت الوصول
const firstOfferForOrder = new Map<string, number>();
const orderFirstSeen = new Map<string, number>();
const acceptQueue = new Map<string, number[]>(); // order → سائقون أرسلوا القبول
function onDriverOffer(e: MockEv) {
  const d = driverByChat.get(Number(e.chat_id));
  if (!d) return;
  const acc = e.cbs!.find((c) => c.startsWith("offer:accept:"))!;
  const rej = e.cbs!.find((c) => c.startsWith("offer:reject:"));
  const orderId = acc.slice("offer:accept:".length);
  biz.offersSeen++;
  d.offersSeen++;
  offerSeenAt.set(`${orderId}:${d.chat}`, e.t);
  if (!firstOfferForOrder.has(orderId)) {
    firstOfferForOrder.set(orderId, e.t);
    const created = orderFirstSeen.get(orderId);
    if (created) biz.orderToOfferSeen.add(e.t - created);
  }
  ev("offer.seen", {
    order: orderId,
    driver: d.chat,
    mock_seq: e.seq,
    mock_t: e.t,
    lag_ms: Date.now() - e.t,
  });
  if (d.state !== "idle") {
    biz.offersWhileBusy++;
    return;
  }
  const roll = Math.random();
  if (roll < 0.07) {
    biz.offersIgnored++;
    ev("offer.ignored", { order: orderId, driver: d.chat });
    return;
  }
  if (roll < 0.15 && rej) {
    void (async () => {
      await sleep(rnd(300, 1500));
      biz.offersRejectedSent++;
      await post("driver", cb(d.chat, rej), "driver_reject");
      ev("offer.reject_sent", { order: orderId, driver: d.chat });
    })();
    return;
  }
  d.state = "accepting";
  void (async () => {
    await sleep(rnd(300, 2500)); // زمن رد فعل بشري
    biz.offerSeenToAccept.add(Date.now() - e.t);
    biz.offersAcceptedSent++;
    const list = acceptQueue.get(orderId) ?? [];
    list.push(d.chat);
    acceptQueue.set(orderId, list);
    await post("driver", cb(d.chat, acc), "driver_accept");
    ev("offer.accept_sent", {
      order: orderId,
      driver: d.chat,
      seen_to_accept_ms: Date.now() - e.t,
    });
    // إن لم يُسنَد إليه خلال 15ث يعود متاحًا
    const o = await waitOrder(
      orderId,
      (x) =>
        x.driver_tg !== null || ["cancelled", "completed", "expired", "failed"].includes(x.status),
      15_000,
    );
    if (!o || o.driver_tg !== String(d.chat)) {
      if (d.state === "accepting") d.state = "idle";
      biz.acceptLost++;
    }
  })();
}
driverOfferHandlers.push(onDriverOffer);

// ───────── السيناريوهات ─────────
function takeRider(cities: string[]): Rider | null {
  const free = riders.filter((r) => !r.busy && cities.includes(r.city));
  if (!free.length) return null;
  const r = pick(free);
  r.busy = true;
  return r;
}
const TERMINAL = ["cancelled", "completed", "expired", "failed", "no_driver"];

async function rideOrDelivery(kind: "ride" | "delivery") {
  const roll = Math.random();
  const variant =
    roll < 0.08
      ? "cancel_searching"
      : roll < 0.14
        ? "cancel_matched"
        : roll < 0.18
          ? "dup_create"
          : roll < 0.22
            ? "dup_complete"
            : roll < 0.25
              ? "cancel_in_progress"
              : "full";
  const name = variant === "full" ? kind : `${kind}_${variant}`;
  const rider = takeRider(["JED", "MKK", "RUH"]);
  if (!rider) {
    errc("no_free_rider");
    await sleep(300);
    return;
  }
  const s = scen(name);
  s.started++;
  const t = Date.now();
  let orderId: string | null = null;
  let driver: Driver | undefined;
  const fail = (why: string, extra: Record<string, unknown> = {}) => {
    s.fail++;
    s.reasons[why] = (s.reasons[why] ?? 0) + 1;
    ev("scenario.fail", {
      scenario: name,
      why,
      order: orderId,
      rider: rider.chat,
      ms: Date.now() - t,
      ...extra,
    });
  };
  const okDone = (extra: Record<string, unknown> = {}) => {
    s.ok++;
    s.e2e.add(Date.now() - t);
    ev("scenario.ok", {
      scenario: name,
      order: orderId,
      rider: rider.chat,
      driver: driver?.chat,
      ms: Date.now() - t,
      ...extra,
    });
  };
  try {
    const city = CITIES[rider.city]!;
    const pickup = near(city.center, 1.5);
    const drop = near(city.center, 4);
    const sendCreate = async () => {
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
          text(rider.chat, pick(["كيس ملابس", "مستندات مهمة", "علبة هدايا", "طلب صيدلية"])),
          "rider_parcel",
        );
      }
    };
    const tCreate = Date.now();
    await sendCreate();
    const order = await waitOrderCreated(rider.chat, tCreate - 1500, 45_000);
    if (!order) return fail("order_not_created_45s");
    orderId = order.id;
    biz.createToOrder.add(Date.now() - tCreate);
    orderFirstSeen.set(order.id, Date.now());
    track(order.id, order.status);
    if (variant === "dup_create") {
      // تكرار طلب الإنشاء من الزبون نفسه وله طلب نشط: يجب ألا يُنشأ طلب ثانٍ نشط
      await sendCreate();
      await sleep(4000);
      const [c] = await sql<
        { n: number }[]
      >`select count(*)::int n from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id
          where u.telegram_id=${rider.chat} and o.status in ('searching','matched','in_progress','scheduled')`;
      if (c!.n > 1) return fail("duplicate_active_order", { active: c!.n });
    }
    if (variant === "cancel_searching") {
      await sleep(rnd(200, 2000));
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel_dup"); // إلغاء مكرر
      const o = await waitOrder(
        order.id,
        (x) => TERMINAL.includes(x.status) || x.status === "matched",
        15_000,
      );
      if (o?.status === "cancelled") return okDone();
      if (o?.status === "matched") {
        await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
        const o2 = await waitOrder(order.id, (x) => x.status === "cancelled", 10_000);
        return o2
          ? okDone({ note: "matched_before_cancel" })
          : fail(`cancel_status_${tracked.get(order.id)?.status}`);
      }
      return fail(`cancel_not_applied_${tracked.get(order.id)?.status}`);
    }
    // انتظار الإسناد: يحدث فقط إن وصل عرضٌ لصندوق سائق فقبله
    const m = await waitOrder(
      order.id,
      (x) => (x.status === "matched" && x.driver_tg !== null) || TERMINAL.includes(x.status),
      MATCH_WAIT_MS,
    );
    if (m?.status !== "matched") {
      const offersToOrder = [...offerSeenAt.keys()].filter((k) =>
        k.startsWith(`${order.id}:`),
      ).length;
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail(m ? `terminal_${m.status}` : "no_match_within_wait", {
        offers_seen_by_drivers: offersToOrder,
      });
    }
    driver = driverByChat.get(Number(m.driver_tg));
    if (!driver) return fail("assigned_unknown_driver");
    const seen = offerSeenAt.get(`${order.id}:${driver.chat}`);
    const acceptedFromInbox = acceptQueue.get(order.id)?.includes(driver.chat) ?? false;
    if (!acceptedFromInbox || seen === undefined) {
      errc("matched_without_inbox_offer");
      ev("integrity.matched_without_inbox_offer", { order: order.id, driver: driver.chat });
    }
    biz.acceptToMatched.add(Date.now() - (seen ?? Date.now()));
    driver.state = "trip";
    if (variant === "cancel_matched") {
      await sleep(rnd(200, 1500));
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      const o = await waitOrder(order.id, (x) => x.status === "cancelled", 15_000);
      return o ? okDone() : fail(`cancel_after_match_${tracked.get(order.id)?.status}`);
    }
    await sleep(rnd(500, 2000));
    await post("driver", cb(driver.chat, `ride:start:${order.id}`), "driver_start");
    const ip = await waitOrder(
      order.id,
      (x) => x.status === "in_progress" || TERMINAL.includes(x.status),
      20_000,
    );
    if (ip?.status !== "in_progress")
      return fail(`not_in_progress_${tracked.get(order.id)?.status}`);
    if (variant === "cancel_in_progress") {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel_in_trip");
      await sleep(4000);
      const st = tracked.get(order.id)?.status;
      ev("edge.cancel_in_progress", { order: order.id, status_after: st });
      // السلوك المقبول: إما رفض الإلغاء أثناء الرحلة (يبقى in_progress) أو إلغاء صريح. نُكمل إن بقي.
      if (st === "cancelled") return okDone({ cancel_in_trip: "cancelled" });
    }
    await sleep(rnd(800, 3000));
    await post("driver", cb(driver.chat, `ride:complete:${order.id}`), "driver_complete");
    if (variant === "dup_complete")
      await post("driver", cb(driver.chat, `ride:complete:${order.id}`), "driver_complete_dup");
    const done = await waitOrder(order.id, (x) => TERMINAL.includes(x.status), 20_000);
    if (done?.status !== "completed") return fail(`not_completed_${tracked.get(order.id)?.status}`);
    await post(
      "rider",
      cb(rider.chat, `rate:${3 + Math.floor(Math.random() * 3)}:${order.id}`),
      "rider_rate",
    );
    await post("driver", cb(driver.chat, `rate:5:${order.id}`), "driver_rate");
    okDone();
  } catch (e) {
    errc(`exc:${(e as Error).message.slice(0, 50)}`);
    fail("exception");
  } finally {
    if (driver && driver.state === "trip") driver.state = "idle";
    if (orderId) untrack(orderId);
    rider.busy = false;
  }
}

// بطاقات القروب من المحاكي: group chat → negId → orderId (ربط تحقق من القاعدة)
const groupCards = new Map<string, { negId: string; t: number }>(); // orderId → بطاقة
const cardWaiters = new Map<string, (c: { negId: string; t: number }) => void>();
const pendingNeg = new Set<string>();
function onGroupEvent(e: MockEv) {
  const claim = e.cbs?.find((c) => c.startsWith("unsub:claim:"));
  if (!claim) return;
  pendingNeg.add(claim.slice("unsub:claim:".length));
}
async function negResolver() {
  for (;;) {
    if (pendingNeg.size) {
      const ids = [...pendingNeg];
      pendingNeg.clear();
      try {
        const rows = await sql<
          { id: string; order_id: string }[]
        >`select id::text, order_id::text from unsubscribed_negotiations where id = any(${ids}::uuid[])`;
        for (const r of rows) {
          const c = { negId: r.id, t: Date.now() };
          if (!groupCards.has(r.order_id)) groupCards.set(r.order_id, c);
          cardWaiters.get(r.order_id)?.(c);
        }
      } catch {
        for (const i of ids) pendingNeg.add(i);
      }
    }
    await sleep(500);
  }
}

async function groupScenario() {
  const roll = Math.random();
  const variant = roll < 0.1 ? "overfill" : roll < 0.16 ? "dup_claim" : "full";
  const name = variant === "full" ? "group" : `group_${variant}`;
  const rider = takeRider(["TIF", "MED"]);
  if (!rider) {
    errc("no_free_group_rider");
    await sleep(300);
    return;
  }
  const s = scen(name);
  s.started++;
  const t = Date.now();
  let orderId: string | null = null;
  const claimers: Driver[] = [];
  const fail = (why: string, extra: Record<string, unknown> = {}) => {
    s.fail++;
    s.reasons[why] = (s.reasons[why] ?? 0) + 1;
    ev("scenario.fail", {
      scenario: name,
      why,
      order: orderId,
      rider: rider.chat,
      ms: Date.now() - t,
      ...extra,
    });
  };
  try {
    const city = CITIES[rider.city]!;
    const tCreate = Date.now();
    await post("rider", text(rider.chat, "/ride"), "rider_ride_cmd");
    await post("rider", loc(rider.chat, near(city.center, 1.5)), "rider_pickup");
    await post("rider", loc(rider.chat, near(city.center, 4)), "rider_dropoff");
    const order = await waitOrderCreated(rider.chat, tCreate - 1500, 45_000);
    if (!order) return fail("order_not_created_45s");
    orderId = order.id;
    biz.createToOrder.add(Date.now() - tCreate);
    track(order.id, order.status);
    // البطاقة يجب أن تصل لقروب المدينة في المحاكي
    const card =
      groupCards.get(order.id) ??
      (await new Promise<{ negId: string; t: number } | null>((resolve) => {
        const tm = setTimeout(() => {
          cardWaiters.delete(order.id);
          resolve(null);
        }, 240_000);
        cardWaiters.set(order.id, (c) => {
          clearTimeout(tm);
          cardWaiters.delete(order.id);
          resolve(c);
        });
      }));
    if (!card) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("group_card_not_delivered_240s");
    }
    biz.groupCardWait.add(card.t - tCreate);
    const pool = drivers.filter(
      (d) => d.city === rider.city && !d.subscribed && d.state === "idle",
    );
    const want = variant === "overfill" ? 5 : 1 + Math.floor(Math.random() * 3);
    for (const d of pool.sort(() => Math.random() - 0.5).slice(0, want)) {
      d.state = "claiming";
      claimers.push(d);
    }
    if (!claimers.length) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("no_free_group_driver");
    }
    const g = unsubGroup[rider.city]!;
    await Promise.all(
      claimers.map((d) =>
        post("driver", cb(d.chat, `unsub:claim:${card.negId}`, g), "group_claim"),
      ),
    );
    if (variant === "dup_claim") {
      // المطالبة نفسها من السائق نفسه بالتوازي عدة مرات (تحديثات مختلفة)
      await Promise.all(
        [1, 2, 3].map(() =>
          post("driver", cb(claimers[0]!.chat, `unsub:claim:${card.negId}`, g), "group_claim_dup"),
        ),
      );
    }
    // ننتظر معالجة المطالبات فعليًا (حتى 60ث) ثم مهلة استقرار 3ث، ثم نحكم من القاعدة
    const qc = async () =>
      (
        await sql<
          { n: number; dmax: number }[]
        >`select count(*)::int n, coalesce(max(k),0)::int dmax from
        (select driver_id, count(*) k from unsubscribed_claims where negotiation_id=${card.negId} group by driver_id) x`
      )[0]!;
    const tClaim = Date.now();
    while (Date.now() - tClaim < 60_000 && (await qc()).n < Math.min(claimers.length, 3))
      await sleep(1000);
    await sleep(3000);
    const cc = await qc();
    ev("group.claims_settled", {
      order: order.id,
      claimers: claimers.length,
      claims: cc.n,
      ms: Date.now() - tClaim,
    });
    if (cc!.n > 3) return fail("claims_exceed_slots", { claims: cc!.n });
    if (cc!.dmax > 1) return fail("duplicate_claim_same_driver", { dmax: cc!.dmax });
    if (cc!.n === 0) {
      await post("rider", text(rider.chat, "/cancel"), "rider_cancel");
      return fail("no_claim_registered");
    }
    // الزبون يختار من الأزرار التي وصلته (صندوقه في المحاكي)، وإلا يُبنى الزر بالصيغة المعروفة
    const selMsg = await waitInbox(
      String(rider.chat),
      (e) => !!e.cbs?.some((c) => c.startsWith(`unsub:sel:${card.negId}:`)),
      20_000,
    );
    const sel =
      selMsg?.cbs?.find((c) => c.startsWith(`unsub:sel:${card.negId}:`)) ??
      `unsub:sel:${card.negId}:1`;
    if (!selMsg) errc("group_sel_buttons_not_seen");
    await post("rider", cb(rider.chat, sel), "group_select");
    const [first] = await sql<
      { tg: string }[]
    >`select u.telegram_id::text tg from unsubscribed_claims c join drivers d on d.id=c.driver_id
        join users u on u.id=d.user_id where c.negotiation_id=${card.negId} order by position limit 1`;
    const fd = driverByChat.get(Number(first!.tg));
    await post("driver", text(Number(first!.tg), "أوصلك بثلاثين ريال"), "group_chat");
    await post("rider", text(rider.chat, "تمام اتفقنا"), "group_chat");
    await post("rider", cb(rider.chat, `unsub:agree:${card.negId}`), "group_agree");
    const m = await waitOrder(
      order.id,
      (x) => x.status === "matched" || TERMINAL.includes(x.status),
      30_000,
    );
    if (m?.status !== "matched") return fail(`agree_not_matched_${tracked.get(order.id)?.status}`);
    if (fd) fd.state = "trip";
    await post("driver", cb(Number(first!.tg), `ride:start:${order.id}`), "driver_start");
    await waitOrder(
      order.id,
      (x) => x.status === "in_progress" || TERMINAL.includes(x.status),
      20_000,
    );
    await sleep(rnd(500, 2000));
    await post("driver", cb(Number(first!.tg), `ride:complete:${order.id}`), "driver_complete");
    const fin = await waitOrder(order.id, (x) => TERMINAL.includes(x.status), 20_000);
    if (fin?.status !== "completed")
      return fail(`group_not_completed_${tracked.get(order.id)?.status}`);
    s.ok++;
    s.e2e.add(Date.now() - t);
    ev("scenario.ok", {
      scenario: name,
      order: orderId,
      rider: rider.chat,
      claims: cc!.n,
      ms: Date.now() - t,
    });
  } catch (e) {
    errc(`exc:${(e as Error).message.slice(0, 50)}`);
    fail("exception");
  } finally {
    for (const d of claimers) if (d.state === "claiming" || d.state === "trip") d.state = "idle";
    if (orderId) {
      untrack(orderId);
      groupCards.delete(orderId);
    }
    rider.busy = false;
  }
}

// ───────── نشاط خلفي: نبض المواقع وتغيّر التوافر وتكرار update_id ─────────
let bgOn = true;
async function heartbeatLoop() {
  while (bgOn) {
    const list = drivers.filter((d) => d.state === "idle" && d.subscribed);
    // كل سائق مرة كل HEARTBEAT_SEC تقريبًا (افتراضيًا 240ث: داخل تذكير الموقع 300ث؛ كل نبضة يرد عليها البوت برسالة)
    const per = Math.max(1, Math.ceil(list.length / Number(process.env.HEARTBEAT_SEC ?? 240)));
    for (let i = 0; i < list.length && bgOn; i += per) {
      await Promise.all(
        list
          .slice(i, i + per)
          .map((d) => post("driver", loc(d.chat, near(d.at, 0.3)), "driver_location")),
      );
      await sleep(1000);
    }
  }
}
async function availabilityChurn() {
  while (bgOn) {
    await sleep(20_000);
    const idle = drivers.filter((d) => d.state === "idle" && d.subscribed);
    for (const d of idle.sort(() => Math.random() - 0.5).slice(0, Math.ceil(idle.length * 0.02))) {
      d.state = "unavailable";
      void (async () => {
        await post("driver", text(d.chat, "/unavailable"), "driver_unavailable");
        await sleep(rnd(30_000, 90_000));
        await post("driver", text(d.chat, "/available"), "driver_available");
        await post("driver", loc(d.chat, d.at), "driver_location");
        d.state = "idle";
      })();
    }
  }
}
async function duplicateUpdates() {
  // إعادة إرسال تحديث بنفس update_id (يجب أن يُعالَج مرة واحدة)
  while (bgOn) {
    await sleep(3000);
    const r = riders.find((x) => !x.busy);
    if (!r) continue;
    const u = text(r.chat, "/help");
    const body = JSON.stringify(u);
    biz.duplicateUpdatesSent++;
    await Promise.all([
      post("rider", null, "dup_update", { raw: body }),
      post("rider", null, "dup_update", { raw: body }),
    ]);
    ev("dup_update.sent", { update_id: u.update_id, rider: r.chat });
  }
}

// ───────── المقاييس الدورية ─────────
function snapshot() {
  const w = httpWin.hist.sum();
  const states: Record<string, number> = {};
  for (const d of drivers) states[d.state] = (states[d.state] ?? 0) + 1;
  return {
    t: new Date().toISOString(),
    s: +((Date.now() - T0) / 1000).toFixed(0),
    gen: GEN_ID,
    phase,
    target,
    concurrency,
    peakConcurrency,
    riders_busy: riders.filter((r) => r.busy).length,
    drivers: states,
    gateway_down: gatewayDownSince !== null,
    outages: outages.length,
    http: { ...http, ...httpHist.sum() },
    http_window: { n: httpWin.n, rps: +(httpWin.n / 10).toFixed(1), ...w },
    scenarios: Object.fromEntries(
      Object.entries(sc).map(([k, v]) => [
        k,
        { started: v.started, ok: v.ok, fail: v.fail, reasons: v.reasons, e2e: v.e2e.sum() },
      ]),
    ),
    biz: {
      ...Object.fromEntries(
        Object.entries(biz).map(([k, v]) => [k, v instanceof Hist ? v.sum() : v]),
      ),
    },
    tracked_orders: tracked.size,
    mock_cursor: mockCursor,
    mock_poll_failures: mockDown,
    errors,
  };
}
function metricsLoop() {
  setInterval(() => {
    try {
      appendFileSync(`${EV}/generator-metrics.jsonl`, `${JSON.stringify(snapshot())}\n`);
    } catch {}
    httpWin.hist = new Hist();
    httpWin.n = 0;
  }, 10_000);
}

// ───────── GROUP-01: خمسةُ قروباتٍ غيرِ مسجَّلةٍ بتحديثاتٍ فعليةٍ ─────────
// قروباتٌ (معرّفاتُ محادثةٍ سالبةٌ خارجَ نطاقِ seed-cities) لا تعرفُها القاعدةُ،
// مع سائقينَ حقيقيِّ الهويةِ (معرّفاتٌ موجبةٌ) «يحاولونَ» المطالبةَ منها على
// بطاقاتِ تفاوضٍ حقيقيّةٍ نُشرتْ في القروباتِ الرسميةِ — فالفرقُ الوحيدُ في
// المقارنةِ هوَ القروبُ المسجَّلُ/غيرُ المسجَّلِ (B3: لا تُسجَّل المطالبةُ من
// قروبٍ غيرِ مسجَّلٍ). كلُّ تحديثٍ يمرُّ بالويبهوكِ ويُعالَجُ — لا رسائلَ
// مباشرةٍ إلى المحاكي (سجلُّهُ خروجٌ لا دليلَ وصولٍ).
const UNREG_GROUPS = [61, 62, 63, 64, 65].map((n) => -(1000000000000 + n));
const UNREG_DRIVERS = [900_700_001, 900_700_002, 900_700_003, 900_700_004, 900_700_005];
const unregStats = { loc: 0, msg: 0, claim: 0, claimOnCard: 0 };
function unregisteredGroupsLoop() {
  let tick = 0;
  setInterval(async () => {
    tick++;
    for (let i = 0; i < UNREG_GROUPS.length; i++) {
      const g = UNREG_GROUPS[i]!;
      const driver = UNREG_DRIVERS[i]!;
      const kind = (tick + i) % 3;
      try {
        if (kind === 0) {
          // مشاركةُ موقعٍ من قروبٍ غيرِ مسجَّلٍ — هويةُ سائقٍ موجبةٌ ومحادثةُ قروب.
          const id = nextId();
          await post(
            "driver",
            {
              update_id: id,
              message: {
                message_id: id,
                date: Math.floor(Date.now() / 1000),
                chat: { id: g, type: "supergroup" },
                from: from(driver),
                location: { latitude: 21.4, longitude: 39.8 },
              },
            },
            "unreg_group_loc",
            { noRetry: true },
          );
          unregStats.loc++;
        } else if (kind === 1) {
          // رسالةُ نصٍّ من القروبِ — حركةٌ فعليةٌ بصيغةِ supergroup.
          const id = nextId();
          await post(
            "driver",
            {
              update_id: id,
              message: {
                message_id: id,
                date: Math.floor(Date.now() / 1000),
                chat: { id: g, type: "supergroup" },
                from: from(driver),
                text: "تحديثُ سائقٍ من قروبٍ غيرِ مسجَّل",
              },
            },
            "unreg_group_msg",
            { noRetry: true },
          );
          unregStats.msg++;
        } else {
          // محاولةُ مطالبةٍ على بطاقةٍ حقيقيّةٍ (تفاوضٌ قائمٌ) لكن من قروبٍ
          // غيرِ مسجَّلٍ — إن لم توجد بطاقةٌ حيّةٌ فمطالبةٌ بهويةٍ صحيحةٍ على
          // معرّفٍ غيرِ موجودٍ (تُرفضُ أيضًا وتُقاسُ نتيجةُ المعالجةِ).
          const card = groupCards.size > 0 ? [...groupCards.values()][0] : null;
          if (card !== null) {
            await post("driver", cb(driver, `unsub:claim:${card.negId}`, g), "unreg_group_claim", {
              noRetry: true,
            });
            unregStats.claimOnCard++;
          } else {
            await post(
              "driver",
              cb(driver, `unsub:claim:${crypto.randomUUID()}`, g),
              "unreg_group_claim",
              { noRetry: true },
            );
          }
          unregStats.claim++;
        }
      } catch {}
    }
  }, 15_000);
}

// ───────── المحرّك ─────────
async function slot(id: number) {
  concurrency++;
  if (concurrency > peakConcurrency) peakConcurrency = concurrency;
  try {
    while (id < target) {
      const r = Math.random();
      if (r < MIX.ride!) await rideOrDelivery("ride");
      else if (r < MIX.ride! + MIX.delivery!) await rideOrDelivery("delivery");
      else await groupScenario();
    }
  } finally {
    concurrency--;
  }
}
async function main() {
  buildWorld();
  writeFileSync(
    `${EV}/load-config.${GEN_ID}.json`,
    JSON.stringify(
      {
        GEN_ID,
        BASE,
        MOCK,
        N_DRIVERS,
        N_RIDERS,
        SEED,
        PROFILE,
        MIX,
        MATCH_WAIT_MS,
        cities: CITIES,
        driver_offer_policy: { accept: 0.85, reject: 0.08, ignore: 0.07 },
        offer_source: "telegram-mock inbox only",
      },
      null,
      2,
    ),
  );
  metricsLoop();
  void inboxLoop();
  for (const code of Object.keys(CITIES))
    listen(String(-(1000000000000 + (CITIES[code]?.idx ?? 0) * 10 + 3)), (e) => {
      onGroupEvent(e);
      return false;
    });
  void boardLoop();
  void negResolver();
  unregisteredGroupsLoop();
  if (process.env.SEED === "2") await reseedMissing();
  else if (SEED) await seed();
  else {
    await loadIds();
    if (process.env.RESET !== "0") await resetActive();
  }
  ev("load.start", { drivers: drivers.length, riders: riders.length });
  console.log(`[gen] drivers=${drivers.length} riders=${riders.length}`);
  void heartbeatLoop();
  void availabilityChurn();
  void duplicateUpdates();
  const running = new Set<Promise<void>>();
  let slots = 0;
  for (const p of PROFILE) {
    phase = p.name;
    target = p.conc;
    ev("phase.start", { name: p.name, conc: p.conc, sec: p.sec });
    console.log(`[gen] phase=${p.name} conc=${p.conc} sec=${p.sec}`);
    const end = Date.now() + p.sec * 1000;
    // تصعيد تدريجي داخل المرحلة: 20 خانة كل ثانية
    while (slots < target && Date.now() < end) {
      const add = Math.min(20, target - slots);
      for (let i = 0; i < add; i++) {
        const pr = slot(slots++);
        running.add(pr);
        pr.finally(() => running.delete(pr));
      }
      await sleep(1000);
    }
    if (slots > target) slots = target; // الخانات ذات المعرّف ≥ الهدف تخرج بعد سيناريوها
    while (Date.now() < end) await sleep(1000);
  }
  phase = "drain";
  target = 0;
  bgOn = false;
  ev("phase.start", { name: "drain" });
  const drainEnd = Date.now() + 240_000;
  while (running.size && Date.now() < drainEnd) await sleep(1000);
  const final = snapshot();
  writeFileSync(
    `${EV}/generator-summary.${GEN_ID}.json`,
    JSON.stringify(
      { ...final, outages_detail: outages, ended_with_running: running.size },
      null,
      2,
    ),
  );
  ev("load.end", { running: running.size });
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => {
  try {
    writeFileSync(
      `${EV}/generator-summary.${GEN_ID}.json`,
      JSON.stringify({ ...snapshot(), outages_detail: outages, terminated: true }, null, 2),
    );
  } catch {}
  process.exit(0);
});
main().catch((e) => {
  ev("load.crash", { error: String(e?.stack ?? e).slice(0, 500) });
  console.error(e);
  process.exit(1);
});
