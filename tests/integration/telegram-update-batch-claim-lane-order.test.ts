/**
 * الغرض: LOAD-01 (الدفعةُ 20) — شرطُ D4 (ترتيبُ تحديثاتِ المستخدمِ الواحد) في الالتقاطِ الدُّفعيِّ
 *   `claim_telegram_update_jobs_for_bot` على PostgreSQL حقيقيّ.
 *   الالتقاطُ المفردُ (`20261015000200`) لا يلتقطُ وظيفةَ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ
 *   (ولو في فترةِ احتياطٍ بعدَ فشل) أو محجوزة. والدُّفعيُّ (`20261018140000`) أسقطَ الشرط: فوظيفةٌ
 *   أقدمُ فشلت فدخلت الاحتياطَ تُتجاوَزُ ويُعالَجُ اللاحقُ قبلَها، ونسختانِ من البوابةِ تعالجانِ
 *   تحديثَي المستخدمِ نفسِه متوازيَين. هذا الملفُّ يُثبتُ الخللَ قبلَ الإصلاحِ ويحرسُه بعدَه.
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. معرّفاتٌ فريدةٌ وcreated_at أقدمُ من أيِّ بقيّة.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_900_000 + (Date.now() % 100_000) * 10;
const SPAN = 100;

async function enqueue(id: number, user: number, secs: number) {
  await sql`select claim_and_enqueue_telegram_update('driver', ${id}, ${sql.json({ update_id: id, message: { from: { id: user }, chat: { id: user } } })}::jsonb, 100000)`;
  await sql`update telegram_update_jobs set created_at = timestamptz '2000-01-01' + make_interval(secs => ${secs})
             where bot = 'driver' and update_id = ${id}`;
}

async function claimBatch(limit: number): Promise<number[]> {
  const [row] = await sql<{ r: { ok: boolean; jobs: { update_id: number }[] } }[]>`
    select claim_telegram_update_jobs_for_bot(30, 5, 'driver', ${limit}) as r`;
  const ids = (row?.r.jobs ?? []).map((j) => Number(j.update_id));
  // ما التُقِطَ من غيرِ وظائفِنا يُعادُ معلَّقًا كما كانَ (لا أثرَ على ملفّاتٍ أخرى).
  const foreign = ids.filter((id) => id < BASE || id > BASE + SPAN);
  if (foreign.length > 0) {
    await sql`update telegram_update_jobs set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
               where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
    await sql`update telegram_update_receipts set status = 'pending', claim_token = null, claimed_at = null, attempts = attempts - 1
               where bot = 'driver' and update_id = any(${foreign}::bigint[])`;
  }
  return ids.filter((id) => id >= BASE && id <= BASE + SPAN);
}

d("ترتيبُ المستخدمِ (D4) في الالتقاطِ الدُّفعيّ — قاعدةٌ حقيقيّة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await sql.end({ timeout: 2 });
  });

  it("وظيفةٌ أقدمُ في فترةِ احتياطٍ تحجبُ لاحقةَ المستخدمِ نفسِه — ولا تحجبُ مستخدمًا آخر", async () => {
    const userA = 91_000_001;
    const userB = 91_000_002;
    await enqueue(BASE + 1, userA, 1); // الأقدمُ للمستخدم أ — فشلت فدخلت الاحتياط
    await enqueue(BASE + 2, userA, 2); // اللاحقةُ للمستخدم أ — مستحقّة
    await enqueue(BASE + 3, userB, 3); // مستخدمٌ آخرُ — مستحقّة
    await sql`update telegram_update_jobs set attempts = 1, next_attempt_at = now() + interval '1 hour', error_code = 'X'
               where bot = 'driver' and update_id = ${BASE + 1}`;
    const ids = await claimBatch(100);
    expect(ids).not.toContain(BASE + 1);
    expect(ids).not.toContain(BASE + 2);
    expect(ids).toContain(BASE + 3);
    await sql`update telegram_update_jobs set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
               where bot = 'driver' and update_id between ${BASE + 1} and ${BASE + 3}`;
  });

  it("وظيفةٌ أقدمُ محجوزةٌ (نسخةٌ أخرى) تحجبُ لاحقةَ المستخدمِ نفسِه", async () => {
    const user = 91_000_003;
    await enqueue(BASE + 11, user, 11);
    await enqueue(BASE + 12, user, 12);
    const first = await claimBatch(1);
    expect(first).toEqual([BASE + 11]);
    const second = await claimBatch(100);
    expect(second).not.toContain(BASE + 12);
    // بعدَ ختمِ السابقةِ تُلتقَطُ اللاحقة.
    await sql`update telegram_update_jobs set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
               where bot = 'driver' and update_id = ${BASE + 11}`;
    const third = await claimBatch(100);
    expect(third).toContain(BASE + 12);
  });

  it("مستخدمونَ مختلفونَ في دُفعةٍ واحدة: لا حجبَ بينهم ولا تغييرَ في الترتيبِ ولا الإيصال", async () => {
    for (let i = 0; i < 6; i++) await enqueue(BASE + 21 + i, 91_100_000 + i, 21 + i);
    const ids = await claimBatch(6);
    expect(ids).toEqual(Array.from({ length: 6 }, (_, i) => BASE + 21 + i));
    const rows = await sql<{ same: boolean; receipt: string }[]>`
      select j.claim_token = r.claim_token same, r.status receipt
        from telegram_update_jobs j join telegram_update_receipts r using (bot, update_id)
       where j.bot = 'driver' and j.update_id between ${BASE + 21} and ${BASE + 26}`;
    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.same).toBe(true);
      expect(r.receipt).toBe("claimed");
    }
  });
});
