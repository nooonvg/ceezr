/**
 * الغرض: LOAD-01 (الدفعةُ 20) — الدرينرُ بالالتقاطِ المسبقِ على PostgreSQL حقيقيٍّ بالمسارِ الدائم
 *   (فحصُ الأثر ← التحضير ← ختمُ الأثرِ في معاملة) والطابورِ الحقيقيّ (`claim_telegram_update_jobs_for_bot`،
 *   `skip locked`، مرآةُ الإيصال، تجديدُ الإيجار)، بسقفِ شوطٍ صغيرٍ يُجبرُ أشواطًا مقطوعةً متتالية.
 *   يُثبت: لا فقدَ ولا تكرار، وترتيبُ تحديثاتِ المستخدمِ الواحدِ عبرَ الدفعاتِ والأشواط، ودرينرانِ
 *   متزامنانِ لا يعالجانِ الوظيفةَ نفسَها، والإيقافُ لا يتركُ وظيفةً محجوزة.
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. يعزلُ نفسَه بمعرّفاتِ update_id فريدةٍ وبـcreated_at
 *   أقدمَ من أيِّ بقيّة، ويؤجّلُ أيَّ بقيّةٍ معلّقةٍ لغيرِه طوالَ الملفِّ ثم يعيدُها كما كانت.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startTelegramUpdateDrainer } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { BotKind, UpdateHandler } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_800_000 + (Date.now() % 100_000) * 10;
const SPAN = 1_000;
let deferred: { bot: string; update_id: string; next_attempt_at: Date }[] = [];

async function enqueue(from: number, rows: { user: number }[]) {
  for (let i = 0; i < rows.length; i++) {
    const id = from + i;
    const user = (rows[i] as { user: number }).user;
    await sql`select claim_and_enqueue_telegram_update('driver', ${id}, ${sql.json({ update_id: id, message: { from: { id: user }, chat: { id: user } } })}::jsonb, 100000)`;
  }
  await sql`update telegram_update_jobs
               set created_at = timestamptz '2000-01-01' + make_interval(secs => (update_id - ${BASE}))
             where bot = 'driver' and update_id between ${from} and ${from + rows.length - 1}`;
}

function recordingHandler(delayMs: () => number) {
  const seen: { updateId: number; user: number }[] = [];
  const handler: UpdateHandler = {
    handle: async () => true,
    prepare: async (_bot: BotKind, update: unknown) => {
      const u = update as { update_id: number; message: { from: { id: number } } };
      seen.push({ updateId: u.update_id, user: u.message.from.id });
      await new Promise((r) => setTimeout(r, delayMs()));
      return { handled: true, replies: [] };
    },
    deliver: async () => ({ sent: 0, error: null }),
  };
  return { handler, seen };
}

async function waitDone(from: number, n: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int n from telegram_update_jobs
       where bot = 'driver' and update_id between ${from} and ${from + n - 1} and status = 'done'`;
    if ((r?.n ?? 0) === n) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("لم تكتمل الوظائفُ في المهلة");
}

d("الدرينرُ بالالتقاطِ المسبقِ — قاعدةٌ حقيقيّة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "", max: 5 });
    deferred = await sql`
      update telegram_update_jobs t set next_attempt_at = now() + interval '1 day'
        from (select bot, update_id, next_attempt_at from telegram_update_jobs
               where status = 'pending' and not (bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN})
               for update) o
       where t.bot = o.bot and t.update_id = o.update_id
      returning o.bot, o.update_id::text, o.next_attempt_at`;
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    for (const r of deferred)
      await sql`update telegram_update_jobs set next_attempt_at = ${r.next_attempt_at}
                 where bot = ${r.bot} and update_id = ${r.update_id}::bigint and status = 'pending'`;
    await sql.end({ timeout: 2 });
  });

  it("أشواطٌ مقطوعةٌ متتالية: كلُّ وظيفةٍ مرّةً واحدة، وترتيبُ المستخدمِ محفوظ، والأثرُ مختومٌ والإيصالُ مرآة", async () => {
    const from = BASE;
    const rows = Array.from({ length: 120 }, (_, i) => ({ user: 88_000 + (i % 12) }));
    await enqueue(from, rows);
    const { handler, seen } = recordingHandler(() => Math.random() * 15);
    const logs: string[] = [];
    const drainer = startTelegramUpdateDrainer(
      {
        queue: createPostgresTelegramUpdateQueue(sql),
        handler,
        lanes: 8,
        maxJobsPerRun: 16,
        fairBots: ["driver", "rider"],
        log: (m) => logs.push(m),
      },
      { intervalMs: 60_000 },
    );
    drainer.kick();
    await waitDone(from, rows.length);
    await drainer.stop();
    const mine = seen.filter((s) => s.updateId >= from && s.updateId < from + rows.length);
    expect(mine.length).toBe(rows.length);
    expect(new Set(mine.map((s) => s.updateId)).size).toBe(rows.length);
    const byUser = new Map<number, number[]>();
    for (const s of mine) byUser.set(s.user, [...(byUser.get(s.user) ?? []), s.updateId]);
    expect(byUser.size).toBe(12);
    for (const ids of byUser.values()) expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(logs.filter((m) => m === "telegram.drainer.sweep_cap_reached").length).toBeGreaterThan(
      0,
    );
    const states = await sql<{ job: string; receipt: string; attempts: number; sealed: boolean }[]>`
      select j.status job, r.status receipt, j.attempts, j.effect_recorded_at is not null sealed
        from telegram_update_jobs j join telegram_update_receipts r using (bot, update_id)
       where j.bot = 'driver' and j.update_id between ${from} and ${from + rows.length - 1}`;
    expect(states.length).toBe(rows.length);
    for (const s of states) {
      expect(s.job).toBe("done");
      expect(s.receipt).toBe("done");
      expect(s.attempts).toBe(1);
      expect(s.sealed).toBe(true);
    }
  }, 60_000);

  it("درينرانِ متزامنانِ (نسختان): لا وظيفةَ تُعالَجُ مرّتين ولا وظيفةَ تُفقَد", async () => {
    const from = BASE + 200;
    const rows = Array.from({ length: 200 }, (_, i) => ({ user: 89_000 + i }));
    await enqueue(from, rows);
    const a = recordingHandler(() => Math.random() * 10);
    const b = recordingHandler(() => Math.random() * 10);
    const mk = (h: UpdateHandler) =>
      startTelegramUpdateDrainer(
        {
          queue: createPostgresTelegramUpdateQueue(sql),
          handler: h,
          lanes: 8,
          maxJobsPerRun: 25,
          fairBots: ["driver", "rider"],
        },
        { intervalMs: 60_000 },
      );
    const da = mk(a.handler);
    const db = mk(b.handler);
    da.kick();
    db.kick();
    await waitDone(from, rows.length);
    await Promise.all([da.stop(), db.stop()]);
    const ids = [...a.seen, ...b.seen]
      .map((s) => s.updateId)
      .filter((id) => id >= from && id < from + rows.length);
    expect(ids.length).toBe(rows.length);
    expect(new Set(ids).size).toBe(rows.length);
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int n from telegram_update_jobs
       where bot = 'driver' and update_id between ${from} and ${from + rows.length - 1} and attempts = 1 and status = 'done'`;
    expect(r?.n).toBe(rows.length);
  }, 60_000);

  it("الإيقافُ أثناءَ العمل لا يتركُ وظيفةً محجوزةً ولا مخزَّنًا بلا متابعة", async () => {
    const from = BASE + 500;
    const rows = Array.from({ length: 64 }, (_, i) => ({ user: 90_000 + i }));
    await enqueue(from, rows);
    const { handler, seen } = recordingHandler(() => 40);
    const drainer = startTelegramUpdateDrainer(
      {
        queue: createPostgresTelegramUpdateQueue(sql),
        handler,
        lanes: 8,
        maxJobsPerRun: 16,
        fairBots: ["driver", "rider"],
      },
      { intervalMs: 60_000 },
    );
    drainer.kick();
    while (seen.length < 10) await new Promise((r) => setTimeout(r, 10));
    await drainer.stop();
    const rowsAfter = await sql<{ status: string; n: number }[]>`
      select status, count(*)::int n from telegram_update_jobs
       where bot = 'driver' and update_id between ${from} and ${from + rows.length - 1}
       group by status`;
    const by = Object.fromEntries(rowsAfter.map((r) => [r.status, r.n]));
    expect(by.claimed ?? 0).toBe(0);
    expect((by.done ?? 0) + (by.pending ?? 0)).toBe(rows.length);
    // كلُّ ما عولِجَ مختومٌ — لا وظيفةَ أُعدَّت ثم تُركت.
    expect(by.done ?? 0).toBe(seen.filter((s) => s.updateId >= from).length);
  }, 60_000);
});
