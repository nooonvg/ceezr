/**
 * الغرض: S5 (ADR 0288) على PostgreSQL حقيقيٍّ — فصلُ الأثرِ التجاريِّ لتحديثِ تيليجرامَ
 *   عن إرسالِ ردِّ الحوارِ. «الأثرُ» هنا = تشغيلُ `prepare` (المعالجُ الذي يكتبُ في
 *   القاعدةِ ويحسبُ الردودَ)؛ فعددُ تشغيلِه هو عددُ مراتِ تنفيذِ الأثرِ.
 *   الحالاتُ: (١) فشلُ الردِّ لا يُكرّرُ الأثرَ؛ (٢) إعادةُ التحديثِ نفسِه لا تُنشئُ أثرًا
 *   ثانيًا؛ (٣) فشلُ القاعدةِ قبلَ تثبيتِ المعاملةِ لا يُسجّلُ نجاحًا؛ (٤) 429 يُعيدُ الردَّ
 *   وحدَه بمهلتِه؛ (٥) الردودُ المعلّقةُ تُستردُّ بعدَ إعادةِ تشغيلِ العاملِ؛ (٦) نافذةُ
 *   الانهيارِ: تيليجرامُ قبلَ والختمُ المحليُّ فشلَ ⇒ الردُّ يُعادُ (مرةً على الأقلِّ، مُعلَنٌ)
 *   والأثرُ لا يُعادُ؛ (٧) السقفُ: محاولاتٌ مستنفدةٌ ⇒ `dead` بسببٍ لا تعليقٌ أبديٌّ.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createTelegramReplyPool } from "../../apps/gateway/src/background/telegram-reply-pool.ts";
import {
  drainTelegramUpdateJobsOnce,
  drainTelegramUpdateRepliesOnce,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { UpdateHandler } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createPostgresTelegramUpdateQueue,
  type TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
if (URL === undefined) console.warn("⚠️  S5 مُتخطّىً: عيّن TEST_DATABASE_URL.");

let sql: Sql;
let seq = 0;
function nextUpdateId(): number {
  seq += 1;
  return 7_700_000_000 + (Date.now() % 1_000_000) * 100 + seq;
}

async function enqueue(updateId: number, user: number): Promise<string> {
  const rows = await sql<{ r: unknown }[]>`
    select claim_and_enqueue_telegram_update('driver', ${updateId},
      ${sql.json({ update_id: updateId, message: { from: { id: user }, chat: { id: user }, text: "x" } })}::jsonb, 100) as r`;
  return JSON.stringify(rows[0]?.r);
}

async function job(updateId: number) {
  const rows = await sql<
    {
      status: string;
      effect: boolean;
      reply_status: string | null;
      replies_sent: number;
      reply_attempts: number;
      due_in: number | null;
      last_error: string | null;
    }[]
  >`
    select status, effect_recorded_at is not null as effect, reply_status, replies_sent,
           reply_attempts, extract(epoch from reply_next_attempt_at - now())::float as due_in,
           reply_last_error as last_error
      from telegram_update_jobs where bot = 'driver' and update_id = ${updateId}`;
  return rows[0];
}

/** يجعلُ ردَّ وظيفةٍ مستحقًّا الآنَ (بدلَ انتظارِ التراجعِ في الاختبارِ). */
async function makeDue(updateId: number) {
  await sql`update telegram_update_jobs set reply_next_attempt_at = now() - interval '1 second'
             where bot = 'driver' and update_id = ${updateId}`;
}

interface Harness {
  readonly handler: UpdateHandler;
  readonly effects: Map<number, number>;
  readonly sends: { updateId: number; index: number }[];
  /** سلوكُ الإرسالِ التالي: `ok` أو رفضٌ (بمهلةٍ اختياريةٍ). */
  plan: ({ kind: "ok" } | { kind: "fail"; retryAfterSec: number | null })[];
}

function harness(): Harness {
  const effects = new Map<number, number>();
  const sends: { updateId: number; index: number }[] = [];
  const h: Harness = {
    effects,
    sends,
    plan: [],
    handler: {
      handle: async () => {
        throw new Error("المسارُ القديمُ لا يُستعملُ حينَ يتوفّرُ الدفترُ");
      },
      prepare: async (_bot, update) => {
        const id = (update as { update_id: number }).update_id;
        effects.set(id, (effects.get(id) ?? 0) + 1);
        return {
          handled: true,
          replies: [
            { chatId: 1, text: `a:${id}` },
            { chatId: 1, text: `b:${id}` },
          ],
        };
      },
      deliver: async (_bot, replies, from) => {
        for (let i = from; i < replies.length; i++) {
          const step = h.plan.shift() ?? { kind: "ok" };
          const text = (replies[i] as { text: string }).text;
          const updateId = Number(text.slice(2));
          if (step.kind === "fail") {
            return {
              sent: i,
              error: { message: "429: Too Many Requests", retryAfterSec: step.retryAfterSec },
            };
          }
          sends.push({ updateId, index: i });
        }
        return { sent: replies.length, error: null };
      },
    },
  };
  return h;
}

function deps(queue: TelegramUpdateQueue, h: Harness, log: string[] = []) {
  return {
    queue,
    handler: h.handler,
    maxJobsPerRun: 20,
    log: (m: string, meta?: unknown) => {
      log.push(m);
      if (process.env.S5_DEBUG) console.log(m, JSON.stringify(meta));
    },
  };
}

d("S5 — دفترُ أثرِ التحديثِ ونيّةُ الردِّ الدائمةُ (قاعدةٌ حقيقيةٌ)", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: URL ?? "" });
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id >= 7700000000`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id >= 7700000000`;
    await sql.end({ timeout: 2 });
  });

  it("(١)+(٤) رفضُ الردِّ (429) لا يُعيدُ الأثرَ: الوظيفةُ `done` والردُّ وحدَه مُجدوَلٌ بمهلتِه", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_001);
    const h = harness();
    h.plan = [{ kind: "ok" }, { kind: "fail", retryAfterSec: 7 }];
    const queue = createPostgresTelegramUpdateQueue(sql);
    const report = await drainTelegramUpdateJobsOnce(deps(queue, h));
    expect(report.done).toBe(1);
    const after = await job(id);
    expect(after?.status).toBe("done");
    expect(after?.effect).toBe(true);
    expect(after?.reply_status).toBe("pending");
    expect(after?.replies_sent).toBe(1); // الأولُ قُبِلَ فلا يُعادُ
    expect(after?.reply_attempts).toBe(1);
    expect(after?.due_in ?? 0).toBeGreaterThan(5); // retry_after = 7ث يُحترَمُ
    // شوطُ وظائفَ ثانٍ لا يجدُ شيئًا يُعيدُه.
    await drainTelegramUpdateJobsOnce(deps(queue, h));
    expect(h.effects.get(id)).toBe(1);
    // المُرسِلُ الخلفيُّ يُكملُ من المؤشرِ (الثاني وحدَه).
    await makeDue(id);
    const replies = await drainTelegramUpdateRepliesOnce(deps(queue, h));
    expect(replies.done).toBe(1);
    expect(h.sends.filter((s) => s.updateId === id)).toEqual([
      { updateId: id, index: 0 },
      { updateId: id, index: 1 },
    ]);
    expect((await job(id))?.reply_status).toBe("done");
    expect(h.effects.get(id)).toBe(1);
  }, 30_000);

  it("(٢) إعادةُ تيليجرامَ للتحديثِ نفسِه بعدَ ثباتِه لا تُنشئُ وظيفةً ولا أثرًا ثانيًا", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_002);
    const h = harness();
    const queue = createPostgresTelegramUpdateQueue(sql);
    await drainTelegramUpdateJobsOnce(deps(queue, h));
    const second = await enqueue(id, 51_002);
    expect(second).not.toContain("enqueued");
    await drainTelegramUpdateJobsOnce(deps(queue, h));
    expect(h.effects.get(id)).toBe(1);
    expect(h.sends.filter((s) => s.updateId === id).length).toBe(2);
  }, 30_000);

  it("(٢-ب) إعادةُ التقاطٍ لوظيفةٍ خُتمَ أثرُها (إيجارٌ قديمٌ) تتخطّى المعالجَ", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_003);
    const h = harness();
    const queue = createPostgresTelegramUpdateQueue(sql, { leaseTimeoutSeconds: 1 });
    await drainTelegramUpdateJobsOnce(deps(queue, h));
    // نحاكي حالةً نادرةً: صفٌّ مختومُ الأثرِ عادَ قابلًا للالتقاطِ (مثلَ إعادةٍ يدويةٍ).
    await sql`update telegram_update_jobs set status = 'pending', next_attempt_at = now() - interval '1 second'
               where bot = 'driver' and update_id = ${id}`;
    const log: string[] = [];
    await drainTelegramUpdateJobsOnce(deps(queue, h, log));
    expect(h.effects.get(id)).toBe(1);
    expect(log).toContain("telegram.drainer.effect_replay_skipped");
    expect((await job(id))?.status).toBe("done");
  }, 30_000);

  it("(٣) فشلُ القاعدةِ عندَ تثبيتِ الأثرِ لا يُسجّلُ الوظيفةَ ناجحةً ولا يُرسِلُ شيئًا", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_004);
    const h = harness();
    const real = createPostgresTelegramUpdateQueue(sql);
    const ledger = real.ledger;
    if (ledger === undefined) throw new Error("الدفترُ غائبٌ");
    const broken: TelegramUpdateQueue = {
      ...real,
      ledger: {
        ...ledger,
        recordEffect: async () => {
          throw new Error("connection terminated unexpectedly");
        },
      },
    };
    const report = await drainTelegramUpdateJobsOnce(deps(broken, h));
    expect(report.done).toBe(0);
    const after = await job(id);
    expect(after?.status).not.toBe("done");
    expect(after?.effect).toBe(false);
    expect(h.sends.filter((s) => s.updateId === id).length).toBe(0);
  }, 30_000);

  it("(٥)+(٦) نافذةُ الانهيارِ: تيليجرامُ قبِلَ والختمُ المحليُّ فشلَ ⇒ بعدَ إعادةِ التشغيلِ يُستردُّ الردُّ ويُعادُ (مرةً على الأقلِّ) والأثرُ مرةٌ واحدةٌ", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_005);
    const h = harness();
    const real = createPostgresTelegramUpdateQueue(sql);
    const ledger = real.ledger;
    if (ledger === undefined) throw new Error("الدفترُ غائبٌ");
    const crashing: TelegramUpdateQueue = {
      ...real,
      ledger: {
        ...ledger,
        finishReplies: async () => {
          throw new Error("process killed before commit");
        },
      },
    };
    await drainTelegramUpdateJobsOnce(deps(crashing, h));
    expect(h.sends.filter((s) => s.updateId === id).length).toBe(2); // قبِلَ تيليجرامُ
    const stuck = await job(id);
    expect(stuck?.status).toBe("done");
    expect(stuck?.reply_status).toBe("sending");
    expect(stuck?.replies_sent).toBe(0); // المؤشرُ لم يتقدّمْ
    // «إعادةُ تشغيلٍ»: عاملٌ جديدٌ بمنفذٍ سليمٍ، والإيجارُ انقضى.
    await sql`update telegram_update_jobs set reply_claimed_at = now() - interval '5 minutes'
               where bot = 'driver' and update_id = ${id}`;
    const fresh = harness();
    const replies = await drainTelegramUpdateRepliesOnce(
      deps(createPostgresTelegramUpdateQueue(sql), fresh),
    );
    expect(replies.claimed).toBeGreaterThanOrEqual(1);
    expect(fresh.sends.filter((s) => s.updateId === id).length).toBe(2); // تكرارٌ خارجيٌّ مُعلَنٌ
    expect((await job(id))?.reply_status).toBe("done");
    expect(h.effects.get(id)).toBe(1);
    expect(fresh.effects.get(id) ?? 0).toBe(0); // لا أثرَ ثانٍ
  }, 30_000);

  it("(٧) استنفادُ المحاولاتِ ⇒ `dead` بسببٍ مُسمّى، والأثرُ لا يُمسُّ", async () => {
    const id = nextUpdateId();
    await enqueue(id, 51_006);
    const h = harness();
    h.plan = Array.from({ length: 20 }, () => ({ kind: "fail" as const, retryAfterSec: null }));
    const queue = createPostgresTelegramUpdateQueue(sql);
    await drainTelegramUpdateJobsOnce(deps(queue, h));
    for (let i = 0; i < 10; i++) {
      const row = await job(id);
      if (row?.reply_status !== "pending") break;
      await makeDue(id);
      await drainTelegramUpdateRepliesOnce(deps(queue, h));
    }
    const final = await job(id);
    expect(final?.reply_status).toBe("dead");
    expect(final?.reply_attempts).toBe(8);
    expect(final?.last_error).toContain("429");
    expect(final?.status).toBe("done");
    expect(h.effects.get(id)).toBe(1);
  }, 30_000);

  /**
   * ملحقُ 2026-10-18 — المقيسُ في `r11-wave-500`: انتظارُ الردِّ داخلَ مسارِ الوظيفةِ جعلَ
   * إتمامَ وظائفِ إثباتِ الهاتفِ بمعدّلِ دلوِ البوتِ (22ث → 62ث). هنا: الإرسالُ معلّقٌ تمامًا
   * والوظائفُ تُتمُّ مع ذلك، وترتيبُ ردودِ المستخدمِ الواحدِ محفوظٌ.
   */
  it("(٨) الردُّ لا يحجزُ مسارَ الوظيفةِ: إرسالٌ معلّقٌ والوظائفُ `done`، ثم الترتيبُ لكلِّ مستخدمٍ", async () => {
    const id1 = nextUpdateId();
    const id2 = nextUpdateId();
    const id3 = nextUpdateId();
    await enqueue(id1, 51_007);
    await enqueue(id2, 51_008);
    await enqueue(id3, 51_007);
    const h = harness();
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const inner = h.handler.deliver;
    const handler: UpdateHandler = {
      ...h.handler,
      deliver: async (bot, replies, from) => {
        await gate;
        return (inner as NonNullable<UpdateHandler["deliver"]>)(bot, replies, from);
      },
    };
    const pool = createTelegramReplyPool({ concurrency: 4, maxQueued: 10, maxWaitMs: 30_000 });
    const queue = createPostgresTelegramUpdateQueue(sql);
    const report = await drainTelegramUpdateJobsOnce({
      ...deps(queue, h),
      handler,
      replyPool: pool,
    });
    expect(report.done).toBe(3);
    for (const id of [id1, id2, id3]) {
      const row = await job(id);
      expect(row?.status).toBe("done");
      expect(row?.reply_status).toBe("sending");
    }
    expect(h.sends.filter((x) => [id1, id2, id3].includes(x.updateId))).toEqual([]);
    open();
    await pool.idle();
    for (const id of [id1, id2, id3]) expect((await job(id))?.reply_status).toBe("done");
    const userA = h.sends.filter((x) => x.updateId === id1 || x.updateId === id3);
    expect(userA).toEqual([
      { updateId: id1, index: 0 },
      { updateId: id1, index: 1 },
      { updateId: id3, index: 0 },
      { updateId: id3, index: 1 },
    ]);
    for (const id of [id1, id2, id3]) expect(h.effects.get(id)).toBe(1);
  }, 30_000);

  it("(٩) ردٌّ تجاوزَ نصفَ الإيجارِ في المُرسِلِ الفوريِّ لا يُرسَلُ محليًّا؛ يلتقطُه الخلفيُّ بعدَ الإيجارِ مرةً واحدةً", async () => {
    const idA = nextUpdateId();
    const idB = nextUpdateId();
    await enqueue(idA, 51_009);
    await enqueue(idB, 51_010);
    const h = harness();
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const inner = h.handler.deliver as NonNullable<UpdateHandler["deliver"]>;
    const handler: UpdateHandler = {
      ...h.handler,
      deliver: async (bot, replies, from) => {
        if ((replies[0] as { text: string }).text === `a:${idA}`) await gate;
        return inner(bot, replies, from);
      },
    };
    let nowMs = Date.now();
    const pool = createTelegramReplyPool({
      concurrency: 1,
      maxQueued: 10,
      maxWaitMs: 30_000,
      now: () => nowMs,
    });
    const queue = createPostgresTelegramUpdateQueue(sql);
    const report = await drainTelegramUpdateJobsOnce({
      ...deps(queue, h),
      handler,
      replyPool: pool,
    });
    expect(report.done).toBe(2);
    nowMs += 31_000;
    open();
    await pool.idle();
    expect(pool.stats().expiredLocal).toBe(1);
    expect(h.sends.filter((x) => x.updateId === idB)).toEqual([]);
    expect((await job(idB))?.reply_status).toBe("sending");
    // الإيجارُ لم ينقضِ ⇒ لا يتسابقُ الخلفيُّ عليه.
    await drainTelegramUpdateRepliesOnce({ ...deps(queue, h), handler });
    expect(h.sends.filter((x) => x.updateId === idB)).toEqual([]);
    await sql`update telegram_update_jobs set reply_claimed_at = now() - interval '61 seconds'
               where bot = 'driver' and update_id = ${idB}`;
    await drainTelegramUpdateRepliesOnce({ ...deps(queue, h), handler });
    expect(h.sends.filter((x) => x.updateId === idB)).toEqual([
      { updateId: idB, index: 0 },
      { updateId: idB, index: 1 },
    ]);
    expect((await job(idB))?.reply_status).toBe("done");
    expect(h.effects.get(idB)).toBe(1);
  }, 30_000);
});
