/**
 * الغرض: LOAD-01 (الدفعةُ السابعةُ) — `claim_telegram_update_jobs_for_bot` على PostgreSQL حقيقي.
 *   الالتقاطُ المفردُ (رحلةٌ لكلِّ وظيفةٍ ~40ms تحتَ 500 متزامنٍ) قيَّدَ الدرينرَ بـ4–5 وظائفَ
 *   جاريةٍ من 32 مسارًا (`diag-r12-jobtiming-500`). الدُّفعةُ يجبُ أن تحفظَ دلالةَ المفردِ حرفيًّا:
 *   الترتيبُ بـ`created_at`، و`skip locked` (ملتقِطانِ لا يأخذانِ الصفَّ نفسَه)، ومحاولةٌ +1،
 *   ومرآةُ الإيصالِ، وحدٌّ مقصوصٌ في القاعدةِ.
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. يعزلُ نفسَه بمعرّفاتِ update_id فريدةٍ وبـcreated_at
 *   أقدمَ من أيِّ بقيّةٍ فيكونُ أوّلَ المرتّب.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_700_000 + (Date.now() % 100_000) * 10;
const N = 8;

async function enqueue(base: number, n: number) {
  for (let i = 0; i < n; i++)
    await sql`select claim_and_enqueue_telegram_update('driver', ${base + i}, ${sql.json({ update_id: base + i, message: { from: { id: 77_000 + i }, chat: { id: 77_000 + i } } })}::jsonb, 100)`;
  // أقدمُ من أيِّ صفٍّ آخرَ وبترتيبٍ صارمٍ: الدُّفعةُ تبدأُ بها وبترتيبِ الإيداعِ.
  await sql`update telegram_update_jobs
               set created_at = timestamptz '2000-01-01' + make_interval(secs => (update_id - ${base}))
             where bot = 'driver' and update_id between ${base} and ${base + n - 1}`;
}

d("الالتقاطُ الدُّفعيُّ لوظائفِ تحديثِ تيليجرام — قاعدةٌ حقيقيّة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    await enqueue(BASE, N);
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql.end({ timeout: 2 });
  });

  it("الحدُّ غيرُ الموجبِ مرفوضٌ صراحةً لا يُفسَّرُ", async () => {
    const [row] = await sql<{ r: { ok: boolean; error?: string } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 0) as r`;
    expect(row?.r).toEqual({ ok: false, error: "INVALID_LIMIT" });
  });

  it("دُفعتانِ متزامنتانِ: مرتّبتانِ بالإيداعِ، ومنفصلتانِ (skip locked)، والإيصالُ مرآةٌ", async () => {
    const queue = createPostgresTelegramUpdateQueue(sql, {
      leaseTimeoutSeconds: 30,
      maxAttempts: 5,
    });
    const claim = queue.claimBatchFor;
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const [a, b] = await Promise.all([claim("driver", 3), claim("driver", 3)]);
    const ids = [...(a?.jobs ?? []), ...(b?.jobs ?? [])].map((j) => j.updateId);
    // ستّةٌ مختلفةٌ — لا صفَّ في الدُّفعتين.
    expect(new Set(ids).size).toBe(6);
    // كلُّ دُفعةٍ مرتّبةٌ بالإيداعِ، والستّةُ هي أقدمُ ستٍّ.
    for (const batch of [a?.jobs ?? [], b?.jobs ?? []]) {
      const own = batch.map((j) => j.updateId);
      expect(own).toEqual([...own].sort((x, y) => x - y));
      for (const j of batch) expect(j.attempts).toBe(1);
    }
    expect([...ids].sort((x, y) => x - y)).toEqual(Array.from({ length: 6 }, (_, i) => BASE + i));
    const rows = await sql<{ update_id: string; job: string; receipt: string; same: boolean }[]>`
      select j.update_id::text, j.status::text job, r.status::text receipt,
             j.claim_token = r.claim_token as same
        from telegram_update_jobs j join telegram_update_receipts r using (bot, update_id)
       where j.bot = 'driver' and j.update_id = any(${ids}::bigint[])`;
    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.job).toBe("claimed");
      expect(r.receipt).toBe("claimed");
      expect(r.same).toBe(true);
    }
  });

  it("الحدُّ مقصوصٌ في القاعدةِ إلى 100 والباقي يُعادُ مرتّبًا", async () => {
    const [row] = await sql<{ r: { ok: boolean; jobs: { update_id: number }[] } }[]>`
      select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 100000) as r`;
    expect(row?.r.ok).toBe(true);
    const jobs = row?.r.jobs ?? [];
    expect(jobs.length).toBeLessThanOrEqual(100);
    // أوّلُها بقيّةُ وظائفِنا (الأقدمُ إيداعًا) بالترتيب.
    expect(jobs.slice(0, 2).map((j) => Number(j.update_id))).toEqual([BASE + 6, BASE + 7]);
    // ما التُقِطَ من غيرِ وظائفِنا يُعادُ معلَّقًا كما كانَ (لا أثرَ على ملفّاتٍ أخرى).
    const foreign = jobs
      .map((j) => Number(j.update_id))
      .filter((id) => id < BASE || id >= BASE + N);
    if (foreign.length > 0) {
      await sql`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
                 where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
      await sql`update telegram_update_receipts set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
                 where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
    }
  });
});
