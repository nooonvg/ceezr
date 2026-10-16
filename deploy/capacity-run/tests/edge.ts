/* biome-ignore-all lint/style/noNonNullAssertion: مصفوفة حالات حدية تجريبية */
/**
 * CAP-RUN-20261016 — مصفوفة الحالات الحدّية على النظام الحقيقي (بوابة + قاعدة + محاكي).
 * كل حالة: شرط نجاح قابل للتحقق من القاعدة/المحاكي، لا من غياب الاستثناء. النتيجة → edge-cases.json.
 * يستخدم حسابات البذر (سائقون 73xxxxx، زبائن 76xxxxx) ويحجز شريحة صغيرة منها لا يلمسها المولّد بالتوازي.
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const RUN_DIR = process.env.RUN_DIR!;
const BASE = "http://127.0.0.1:54300";
const MOCK = "http://127.0.0.1:58090";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;
const sql = postgres(`${process.env.DATABASE_URL}?application_name=cap-edge`, { max: 4 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type R = {
  id: string;
  group: string;
  title: string;
  status: "PASS" | "FAIL" | "NOT VERIFIED";
  evidence: Record<string, unknown>;
};
let precondition: Record<string, unknown> = {};
const results: R[] = [];
function rec(
  id: string,
  group: string,
  title: string,
  pass: boolean | null,
  evidence: Record<string, unknown>,
) {
  const status = pass === null ? "NOT VERIFIED" : pass ? "PASS" : "FAIL";
  results.push({ id, group, title, status, evidence });
  console.log(`${status.padEnd(12)} ${id} ${title} ${JSON.stringify(evidence).slice(0, 220)}`);
}
let uid = 880_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 50;
const from = (c: number) => ({ id: c, is_bot: false, first_name: "sbx", language_code: "ar" });
const msg = (c: number, body: Record<string, unknown>, id = ++uid) => ({
  update_id: id,
  message: {
    message_id: id,
    date: Math.floor(Date.now() / 1000),
    chat: { id: c, type: "private" },
    from: from(c),
    ...body,
  },
});
const cb = (c: number, data: string, chat = c, id = ++uid) => ({
  update_id: id,
  callback_query: {
    id: String(id),
    data,
    chat_instance: "x",
    from: from(c),
    message: {
      message_id: 1,
      date: 0,
      chat: { id: chat, type: chat < 0 ? "supergroup" : "private" },
    },
  },
});
async function post(
  bot: string,
  body: unknown,
  opts: { secret?: string | null; raw?: string } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret !== null) headers["x-telegram-bot-api-secret-token"] = opts.secret ?? SECRET;
  const r = await fetch(`${BASE}/webhook/telegram/${bot}`, {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  await r.arrayBuffer();
  return r.status;
}
async function mockSeq(): Promise<number> {
  return ((await (await fetch(`${MOCK}/health`)).json()) as { seq: number }).seq;
}
type MEv = {
  seq: number;
  t: number;
  bot: string;
  method: string;
  chat_id: string;
  text?: string;
  cbs?: string[];
  status: number;
};
async function mockSince(seq: number): Promise<MEv[]> {
  const out: MEv[] = [];
  let after = seq;
  for (;;) {
    const j = (await (await fetch(`${MOCK}/events?after=${after}&limit=20000`)).json()) as {
      events: MEv[];
    };
    out.push(...j.events);
    if (j.events.length < 20000) break;
    after = j.events[j.events.length - 1]!.seq;
  }
  return out;
}
async function waitJobs(bot: string, ids: number[], ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const rows = await sql<
      { status: string; n: number }[]
    >`select status, count(*)::int n from telegram_update_jobs where bot=${bot} and update_id = any(${ids}::bigint[]) group by 1`;
    const pending = rows
      .filter((r) => r.status === "pending" || r.status === "claimed")
      .reduce((a, r) => a + r.n, 0);
    if (pending === 0 || Date.now() > end)
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    await sleep(300);
  }
}
const ready = async () =>
  (await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(3000) })).status;
async function orderOf(riderChat: number, since: Date) {
  return (
    await sql<
      { id: string; status: string; driver: string | null }[]
    >`select o.id::text, o.status::text, du.telegram_id::text driver from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id
     left join drivers d on d.id=o.assigned_driver_id left join users du on du.id=d.user_id where u.telegram_id=${riderChat} and o.created_at >= ${since} order by o.created_at desc limit 1`
  )[0];
}
async function waitOffersFor(orderId: string, n: number, since: number, ms: number) {
  const end = Date.now() + ms;
  for (;;) {
    const ev = (await mockSince(since)).filter(
      (e) => e.bot === "driver" && e.status === 200 && e.cbs?.includes(`offer:accept:${orderId}`),
    );
    const chats = [...new Set(ev.map((e) => Number(e.chat_id)))];
    if (chats.length >= n || Date.now() > end) return { chats, ev };
    await sleep(500);
  }
}

// ── حسابات محجوزة لهذه المصفوفة (ليست في مدن المولّد النشطة أثناء التشغيل المنفرد) ──
const JED = { lat: 21.5433, lng: 39.1728 };
// شرط مسبق: بقايا جولة الحمل (طلبات تخلّى عنها المولّد) تُلغى عبر زرّ الإلغاء في بوت الزبون نفسه (cancel:<id>)،
// ثم يُتحقَّق أن لا طلب نشط لزبائن المصفوفة قبل البدء — لا تعديل SQL للبيانات.
const riderPool = (
  await sql<
    { tg: string }[]
  >`select u.telegram_id::text tg from riders r join users u on u.id=r.user_id join cities c on c.id=r.city_id where c.code='JED' order by 1 limit 12`
).map((r) => Number(r.tg));
{
  const left = await sql<
    { tg: string; id: string }[]
  >`select u.telegram_id::text tg, o.id::text id from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id
    where u.telegram_id = any(${riderPool}::bigint[]) and o.status in ('searching','matched','in_progress')`;
  const ids: number[] = [];
  for (const o of left) {
    const u = cb(Number(o.tg), `cancel:${o.id}`);
    ids.push(u.update_id);
    await post("rider", u);
  }
  await waitJobs("rider", ids, 60_000);
  await sleep(3000);
  const [still] = await sql<
    { n: number }[]
  >`select count(*)::int n from orders o join riders r on r.id=o.rider_id join users u on u.id=r.user_id where u.telegram_id = any(${riderPool}::bigint[]) and o.status in ('searching','matched','in_progress')`;
  console.log(
    `[precondition] leftover_active=${left.length} cancelled_via_bot still_active=${still!.n}`,
  );
  precondition = { leftover_active_orders: left.length, still_active_after_bot_cancel: still!.n };
}
const coreDrivers = (
  await sql<
    { tg: string }[]
  >`select u.telegram_id::text tg from drivers d join users u on u.id=d.user_id join cities c on c.id=d.city_id
  where c.code='JED' and exists (select 1 from driver_capabilities dc where dc.driver_id=d.id and dc.service='transport') order by 1`
).map((r) => Number(r.tg));
const groupDriver = Number(
  (
    await sql<
      { tg: string }[]
    >`select u.telegram_id::text tg from drivers d join users u on u.id=d.user_id join cities c on c.id=d.city_id where c.code='TIF' limit 1`
  )[0]!.tg,
);
console.log(`riders=${riderPool.length} jed_transport_drivers=${coreDrivers.length}`);
// تأكيد إتاحة سائقي جدة بموقع حديث
for (const d of coreDrivers) {
  await post("driver", msg(d, { text: "/available" }));
  await post(
    "driver",
    msg(d, {
      location: {
        latitude: JED.lat + (Math.random() - 0.5) / 50,
        longitude: JED.lng + (Math.random() - 0.5) / 50,
      },
    }),
  );
}
for (const r of riderPool) await post("rider", msg(r, { text: "/cancel" }));
await sleep(8000);

// ═════ C: تيليجرام والوارد ═════
{
  // خط أساس: عدد رسائل ردّ /help الواحد (الردّ متعدد الرسائل بالتصميم)
  const rb = riderPool[11]!;
  const sb = await mockSeq();
  const ub = msg(rb, { text: "/help" });
  await post("rider", ub);
  await waitJobs("rider", [ub.update_id]);
  await sleep(4000);
  const baseline = (await mockSince(sb)).filter(
    (e) => e.chat_id === String(rb) && e.method === "sendMessage",
  ).length;
  const r = riderPool[0]!;
  const u = msg(r, { text: "/help" });
  const s0 = await mockSeq();
  const st = await Promise.all([post("rider", u), post("rider", u), post("rider", u)]);
  await waitJobs("rider", [u.update_id]);
  await sleep(2500);
  const [rc] = await sql<
    { n: number }[]
  >`select count(*)::int n from telegram_update_receipts where bot='rider' and update_id=${u.update_id}`;
  const [jc] = await sql<
    { n: number; st: string }[]
  >`select count(*)::int n, max(status) st from telegram_update_jobs where bot='rider' and update_id=${u.update_id}`;
  await sleep(2000);
  const rep = (await mockSince(s0)).filter(
    (e) => e.chat_id === String(r) && e.method === "sendMessage",
  );
  const replies = rep.length;
  const texts = rep.map((e) => e.text ?? "");
  const noDupText = new Set(texts).size === texts.length;
  rec(
    "C1",
    "telegram",
    "تكرار update_id نفسه 3 مرات بالتوازي يُعالَج مرة واحدة (ردود = ردّ /help واحد، بلا نص مكرر)",
    rc!.n === 1 && jc!.n === 1 && jc!.st === "done" && replies === baseline && noDupText,
    {
      http: st,
      receipts: rc!.n,
      jobs: jc!.n,
      job_status: jc!.st,
      replies,
      baseline_single_help: baseline,
      no_duplicate_text: noDupText,
    },
  );
}
{
  const r = riderPool[1]!;
  const id1 = ++uid;
  const id2 = ++uid;
  const st2 = await post("rider", msg(r, { text: "/help" }, id2));
  const st1 = await post("rider", msg(r, { text: "/help" }, id1));
  const j = await waitJobs("rider", [id1, id2]);
  rec("C2", "telegram", "تحديثات بترتيب معكوس (update_id أكبر أولًا) تُعالَج كلتاهما", j.done === 2, {
    http: [st2, st1],
    jobs: j,
  });
}
{
  const r = riderPool[2]!;
  const ids: number[] = [];
  for (let i = 0; i < 8; i++) {
    const u = msg(r, { text: "/help" });
    ids.push(u.update_id);
    await post("rider", u);
  }
  await waitJobs("rider", ids);
  const rows = await sql<
    { update_id: string; completed_at: Date }[]
  >`select update_id::text, completed_at from telegram_update_jobs where bot='rider' and update_id = any(${ids}::bigint[]) order by created_at`;
  const mono = rows.every((x, i) => i === 0 || x.completed_at >= rows[i - 1]!.completed_at);
  rec(
    "C3",
    "telegram",
    "8 تحديثات متتابعة للمستخدم نفسه تُنهى بترتيب الإيداع (completed_at رتيب)",
    rows.length === 8 && mono,
    { n: rows.length, monotonic: mono },
  );
}
{
  const users = Array.from({ length: 60 }, (_, i) => 7_990_000 + i);
  const ups = users.map((c) => msg(c, { text: "/start" }));
  const t = Date.now();
  const st = await Promise.all(ups.map((u) => post("rider", u)));
  const j = await waitJobs(
    "rider",
    ups.map((u) => u.update_id),
    120_000,
  );
  rec("C4", "telegram", "60 مستخدمًا مختلفًا بالتوازي: كل التحديثات تُنجز", (j.done ?? 0) === 60, {
    http_2xx: st.filter((s) => s === 200).length,
    jobs: j,
    ms: Date.now() - t,
  });
}
{
  const id1 = ++uid;
  const s1 = await post("rider", {
    update_id: id1,
    poll: {
      id: "p",
      question: "q",
      options: [],
      total_voter_count: 0,
      is_closed: false,
      is_anonymous: true,
      type: "regular",
      allows_multiple_answers: false,
    },
  });
  const id2 = ++uid;
  const s2 = await post("rider", { update_id: id2, something_new: { x: 1 } });
  const j = await waitJobs("rider", [id1, id2], 20_000);
  const rd = await ready();
  rec(
    "C5",
    "telegram",
    "تحديثات غير معروفة/بلا معرّف مستخدم لا تُسقط البوابة ولا تبقى عالقة",
    rd === 200 && !j.pending && !j.claimed,
    { http: [s1, s2], jobs: j, ready: rd },
  );
}
{
  const u = msg(riderPool[3]!, { text: "/help" });
  const s1 = await post("rider", u, { secret: "wrong-secret" });
  const s2 = await post("rider", u, { secret: null });
  const [c] = await sql<
    { n: number }[]
  >`select count(*)::int n from telegram_update_receipts where update_id=${u.update_id}`;
  rec(
    "E1",
    "security",
    "سرّ webhook خاطئ أو غائب يُرفض ولا يُودَع",
    s1 >= 400 && s2 >= 400 && c!.n === 0,
    { wrong: s1, missing: s2, receipts: c!.n },
  );
}
{
  const s1 = await post("rider", null, { raw: "{not json" });
  const s2 = await post("rider", null, { raw: JSON.stringify({ no_update_id: true }) });
  const s3 = await post("unknownbot", msg(riderPool[3]!, { text: "x" }));
  rec(
    "E2",
    "security",
    "JSON غير صالح / بلا update_id / بوت غير معروف يُرفض بلا 5xx",
    [s1, s2, s3].every((s) => s >= 400 && s < 500),
    { invalid_json: s1, no_update_id: s2, unknown_bot: s3 },
  );
}
{
  const big = "ا".repeat(3_000_000);
  let s = 0;
  try {
    s = await post("rider", msg(riderPool[3]!, { text: big }));
  } catch (_e) {
    s = -1;
  }
  const rd = await ready();
  rec("E3", "security", "مدخل كبير (~6MB) يُرفض 413 والبوابة سليمة", s === 413 && rd === 200, {
    http: s,
    ready: rd,
  });
}

// ═════ A: الطلبات والعروض ═════
{
  // A1: قبول متزامن من سائقين وصلهما العرض نفسه في المحاكي
  const r = riderPool[4]!;
  const since = new Date(Date.now() - 1000);
  const s0 = await mockSeq();
  await post("rider", msg(r, { text: "/ride" }));
  await post("rider", msg(r, { location: { latitude: JED.lat, longitude: JED.lng } }));
  await post(
    "rider",
    msg(r, { location: { latitude: JED.lat + 0.03, longitude: JED.lng + 0.02 } }),
  );
  let o: Awaited<ReturnType<typeof orderOf>> | undefined;
  for (let i = 0; i < 60 && !o; i++) {
    o = await orderOf(r, since);
    if (!o) await sleep(500);
  }
  if (!o)
    rec("A1", "orders", "قبول سائقين للطلب نفسه في اللحظة نفسها", false, {
      error: "order_not_created",
    });
  else {
    const { chats } = await waitOffersFor(o.id, 2, s0, 60_000);
    if (chats.length < 2)
      rec("A1", "orders", "قبول سائقين للطلب نفسه في اللحظة نفسها", null, {
        reason: "أقل من سائقين وصلهما العرض في المحاكي خلال 60ث",
        offered_to: chats.length,
        order: o.id,
      });
    else {
      const st = await Promise.all(
        chats.slice(0, 2).map((d) => post("driver", cb(d, `offer:accept:${o!.id}`))),
      );
      await sleep(5000);
      const [x] = await sql<
        { acc: number; status: string; drv: string | null }[]
      >`select (select count(*)::int from order_offers where order_id=${o.id} and status='accepted') acc, status::text, assigned_driver_id::text drv from orders where id=${o.id}`;
      rec(
        "A1",
        "orders",
        "قبول سائقين للطلب نفسه في اللحظة نفسها: إسناد واحد فقط",
        x!.acc === 1 && x!.status === "matched" && x!.drv !== null,
        { http: st, accepted_offers: x!.acc, status: x!.status, offered_to: chats.length },
      );
      // A3: سائق لم يصله عرض لهذا الطلب يحاول القبول
      const outsider = coreDrivers.find((d) => !chats.includes(d))!;
      await post("driver", cb(outsider, `offer:accept:${o.id}`));
      await sleep(2500);
      const [y] = await sql<
        { drv: string }[]
      >`select u.telegram_id::text drv from orders o join drivers d on d.id=o.assigned_driver_id join users u on u.id=d.user_id where o.id=${o.id}`;
      rec(
        "A3",
        "orders",
        "سائق بلا عرض لهذا الطلب لا يستطيع انتزاعه",
        y!.drv !== String(outsider) && chats.includes(Number(y!.drv)),
        { assigned: y!.drv, outsider },
      );
      // A4: إكمال مرتين
      const drv = Number(y!.drv);
      await post("driver", cb(drv, `ride:start:${o.id}`));
      await sleep(2000);
      const sc = await mockSeq();
      await Promise.all([
        post("driver", cb(drv, `ride:complete:${o.id}`)),
        post("driver", cb(drv, `ride:complete:${o.id}`)),
      ]);
      await sleep(6000);
      const [z] = await sql<
        { status: string; completed_at: Date | null }[]
      >`select status::text, completed_at from orders where id=${o.id}`;
      const rateCards = (await mockSince(sc)).filter(
        (e) =>
          e.bot === "rider" &&
          e.chat_id === String(r) &&
          e.cbs?.some((c) => c.startsWith("rate:") && c.endsWith(o!.id)),
      ).length;
      rec(
        "A4",
        "orders",
        "إكمال الرحلة مرتين بالتوازي: completed مرة واحدة وبطاقة تقييم واحدة للزبون",
        z!.status === "completed" && rateCards <= 1,
        { status: z!.status, completed_at: z!.completed_at, rider_rating_cards: rateCards },
      );
      // A5: إلغاء بعد الإكمال مرفوض
      await post("rider", msg(r, { text: "/cancel" }));
      await sleep(2500);
      const [w] = await sql<{ status: string }[]>`select status::text from orders where id=${o.id}`;
      rec("A5", "orders", "إلغاء بعد الإكمال لا يغيّر الحالة", w!.status === "completed", {
        status: w!.status,
      });
    }
  }
}
{
  // A2: انتهاء العرض ثم محاولة قبوله
  const r = riderPool[5]!;
  const since = new Date(Date.now() - 1000);
  const s0 = await mockSeq();
  await post("rider", msg(r, { text: "/ride" }));
  await post("rider", msg(r, { location: { latitude: JED.lat + 0.01, longitude: JED.lng } }));
  await post(
    "rider",
    msg(r, { location: { latitude: JED.lat + 0.04, longitude: JED.lng + 0.02 } }),
  );
  let o: Awaited<ReturnType<typeof orderOf>> | undefined;
  for (let i = 0; i < 60 && !o; i++) {
    o = await orderOf(r, since);
    if (!o) await sleep(500);
  }
  const { chats } = o ? await waitOffersFor(o.id, 1, s0, 60_000) : { chats: [] as number[] };
  if (!o || !chats.length)
    rec("A2", "orders", "قبول عرض منتهي الصلاحية مرفوض", null, {
      reason: "لم يصل عرض",
      order: o?.id,
    });
  else {
    const d = chats[0]!;
    // ننتظر انتهاء العرض الأول (offer_timeout_seconds=45) دون قبول من أحد
    const [{ exp }] = (await sql<
      { exp: Date }[]
    >`select max(expires_at) exp from order_offers oo join drivers dr on dr.id=oo.driver_id join users u on u.id=dr.user_id where oo.order_id=${o.id} and u.telegram_id=${d}`) as [
      { exp: Date },
    ];
    // القبول بعد expires_at بـ3ث — وقبل أن يمرّ عامل expire-offers (كل 60ث) غالباً: هل يُحترم وقتُ الانتهاء لا الحالةُ وحدها؟
    const wait = Math.max(0, exp.getTime() - Date.now()) + 3_000;
    await sleep(wait);
    const [os0] = await sql<
      { status: string }[]
    >`select oo.status::text from order_offers oo join drivers dr on dr.id=oo.driver_id join users u on u.id=dr.user_id where oo.order_id=${o.id} and u.telegram_id=${d} order by oo.created_at limit 1`;
    await post("driver", cb(d, `offer:accept:${o.id}`));
    await sleep(3000);
    const os = {
      status: os0!.status === "pending" ? "expired" : os0!.status,
      raw_status_at_accept: os0!.status,
    };
    const [x] = await sql<
      { drv: string | null; status: string }[]
    >`select du.telegram_id::text drv, o.status::text from orders o left join drivers dd on dd.id=o.assigned_driver_id left join users du on du.id=dd.user_id where o.id=${o.id}`;
    // A2 ينجح إن لم يُسند للسائق صاحب العرض المنتهي (إلا إن أُعيد عرضٌ جديد له في جولة لاحقة)
    const reoffered = (
      await sql<
        { n: number }[]
      >`select count(*)::int n from order_offers oo join drivers dr on dr.id=oo.driver_id join users u on u.id=dr.user_id where oo.order_id=${o.id} and u.telegram_id=${d} and oo.status='pending'`
    )[0]!.n;
    rec(
      "A2",
      "orders",
      "قبول عرض بعد expires_at (قبل مرور عامل الانتهاء) لا يُسند الطلب",
      x!.drv !== String(d),
      {
        offer_status_at_accept: os.raw_status_at_accept,
        assigned: x!.drv,
        status: x!.status,
        reoffered_pending: reoffered,
        accept_after_expiry_ms: 3000,
      },
    );
    let rounds = 1;
    for (let i = 0; i < 120 && rounds < 2; i++) {
      rounds = (
        await sql<
          { n: number }[]
        >`select count(distinct round)::int n from order_offers where order_id=${o.id}`
      )[0]!.n;
      if (rounds < 2) await sleep(1000);
    }
    rec("A6", "orders", "إعادة توزيع الطلب بعد انتهاء العرض (جولة عروض ثانية)", rounds >= 2, {
      rounds,
    });
    await post("rider", msg(r, { text: "/cancel" }));
  }
}
{
  // A7: مدخلات غير صالحة — نص بدل موقع الالتقاط لا يُنشئ طلبًا
  const r = riderPool[6]!;
  const since = new Date();
  await post("rider", msg(r, { text: "/ride" }));
  await post("rider", msg(r, { text: "21.5,39.1" }));
  await post("rider", msg(r, { text: "شارع التحلية" }));
  await sleep(4000);
  const o = await orderOf(r, since);
  rec("A7", "orders", "إحداثيات مكتوبة/نص بدل الموقع لا تُنشئ طلبًا", !o, { order: o?.id ?? null });
  await post("rider", msg(r, { text: "/cancel" }));
}
{
  // A8: تكرار إنشاء الطلب من الزبون نفسه بينما له طلب نشط
  const r = riderPool[7]!;
  const since = new Date(Date.now() - 1000);
  for (let k = 0; k < 2; k++) {
    await post("rider", msg(r, { text: "/ride" }));
    await post("rider", msg(r, { location: { latitude: JED.lat, longitude: JED.lng + 0.01 } }));
    await post("rider", msg(r, { location: { latitude: JED.lat + 0.03, longitude: JED.lng } }));
  }
  await sleep(6000);
  const [c] = await sql<
    { n: number }[]
  >`select count(*)::int n from orders o join riders rr on rr.id=o.rider_id join users u on u.id=rr.user_id where u.telegram_id=${r} and o.created_at >= ${since} and o.status in ('searching','matched','in_progress')`;
  rec("A8", "orders", "طلبان متتاليان من الزبون نفسه: طلب نشط واحد فقط", c!.n === 1, {
    active_orders: c!.n,
  });
  await post("rider", msg(r, { text: "/cancel" }));
  await post("rider", msg(r, { text: "/cancel" }));
  await sleep(3000);
  const [c2] = await sql<
    { n: number; st: string }[]
  >`select count(*)::int n, string_agg(o.status::text, ',') st from orders o join riders rr on rr.id=o.rider_id join users u on u.id=rr.user_id where u.telegram_id=${r} and o.created_at >= ${since}`;
  rec(
    "A9",
    "orders",
    "إلغاء مكرر: الطلب ملغى مرة واحدة بلا أخطاء",
    c2?.st ? c2.st.split(",").every((s) => s === "cancelled") : null,
    { orders: c2 ?? null },
  );
}

// ═════ B: القروبات ═════
{
  const neg = (
    await sql<
      { id: string; order_id: string }[]
    >`select id::text, order_id::text from unsubscribed_negotiations order by created_at desc limit 1`
  )[0];
  if (!neg) rec("B3", "groups", "مطالبة من قروب غير مسجّل تُرفض", null, { reason: "لا تفاوض قائم" });
  else {
    const [b0] = await sql<
      { n: number }[]
    >`select count(*)::int n from unsubscribed_claims where negotiation_id=${neg.id}`;
    await post("driver", cb(groupDriver, `unsub:claim:${neg.id}`, -1009999999999));
    await sleep(3000);
    const [b1] = await sql<
      { n: number }[]
    >`select count(*)::int n from unsubscribed_claims where negotiation_id=${neg.id}`;
    rec("B3", "groups", "مطالبة مرسلة من قروب غير مسجّل لا تُسجَّل", b1!.n === b0!.n, {
      before: b0!.n,
      after: b1!.n,
    });
    // B5 (مُصحَّح): المحاولة الأولى اختارت تفاوضاً في مدينة السائق نفسها (JED/JED) فسُجّلت المطالبة بحقّ.
    // الآن: تفاوضٌ مفتوح وسائقٌ موثَّقٌ من مدينة أخرى حقاً — المتوقَّع رفض CITY_MISMATCH.
    const open = (
      await sql<
        { id: string; city_id: string; code: string }[]
      >`select n.id::text, n.city_id::text, c.code from unsubscribed_negotiations n join cities c on c.id=n.city_id where n.status in ('collecting','negotiating') order by n.created_at desc limit 1`
    )[0];
    if (!open)
      rec("B5", "groups", "سائق من مدينة أخرى لا تُسجَّل مطالبته", null, { reason: "لا تفاوض مفتوح" });
    else {
      const out = (
        await sql<
          { tg: string; code: string }[]
        >`select u.telegram_id::text tg, c.code from drivers d join users u on u.id=d.user_id join cities c on c.id=d.city_id where d.city_id<>${open.city_id}::uuid and d.verification_status='verified' order by u.telegram_id limit 1`
      )[0]!;
      const [g] = await sql<
        { g: string }[]
      >`select telegram_unsubscribed_drivers_group_id::text g from cities where id=${open.city_id}::uuid`;
      await post("driver", cb(Number(out.tg), `unsub:claim:${open.id}`, Number(g!.g)));
      await sleep(3000);
      const [b2] = await sql<
        { n: number }[]
      >`select count(*)::int n from unsubscribed_claims c join drivers d on d.id=c.driver_id join users u on u.id=d.user_id where c.negotiation_id=${open.id}::uuid and u.telegram_id=${Number(out.tg)}`;
      rec("B5", "groups", "سائق من مدينة أخرى لا تُسجَّل مطالبته (CITY_MISMATCH)", b2!.n === 0, {
        negotiation_city: open.code,
        driver_city: out.code,
        claims_by_outsider: b2!.n,
      });
    }
  }
}

// ═════ E: العزل ═════
{
  // E4: نداء مباشر إلى api.telegram.org من داخل الـnetns (بلا الحارس) لا يصل للإنترنت
  let direct = "unknown";
  try {
    const r = await fetch("https://api.telegram.org/", { signal: AbortSignal.timeout(5000) });
    direct = `REACHED:${r.status}`;
  } catch (e) {
    direct = `blocked:${(e as Error).name}:${String((e as Error).message).slice(0, 60)}`;
  }
  let ext = "unknown";
  try {
    const r = await fetch("http://1.1.1.1/", { signal: AbortSignal.timeout(5000) });
    ext = `REACHED:${r.status}`;
  } catch (e) {
    ext = `blocked:${(e as Error).name}`;
  }
  rec(
    "E4",
    "security",
    "لا وصول للإنترنت من الـnetns: api.telegram.org و1.1.1.1",
    !direct.startsWith("REACHED") && !ext.startsWith("REACHED"),
    { telegram: direct, ip: ext },
  );
}

writeFileSync(
  `${RUN_DIR}/evidence/edge-cases.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      precondition,
      results,
      summary: {
        pass: results.filter((r) => r.status === "PASS").length,
        fail: results.filter((r) => r.status === "FAIL").length,
        not_verified: results.filter((r) => r.status === "NOT VERIFIED").length,
      },
    },
    null,
    2,
  ),
);
await sql.end({ timeout: 2 });
process.exit(0);
