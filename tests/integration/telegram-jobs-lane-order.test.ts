/**
 * الغرض: CAP-RUN-20261015 / D4 (تكامل على PostgreSQL حقيقي) — ترتيبُ وظائفِ المستخدمِ عبرَ الإعادة.
 *   وظيفةُ المستخدمِ الأولى تفشلُ فتعودُ pending باحتياطٍ؛ لا يجوزُ التقاطُ وظيفتِه الثانية قبلها،
 *   بينما مستخدمٌ آخرُ لا يُحجَب. ووظيفةٌ ميتةٌ لا تحجبُ ما بعدها.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const put = async (id: number, user: number, ageS: number) => {
  await sql`select claim_and_enqueue_telegram_update('rider', ${id}, ${sql.json({ update_id: id, message: { from: { id: user }, chat: { id: user } } })}::jsonb, 100)`;
  await sql`update telegram_update_jobs set created_at = now() - make_interval(secs => ${ageS}) where bot='rider' and update_id=${id}`;
};
d("D4: ترتيبُ وظائفِ المستخدمِ عبرَ الإعادة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    await sql`update telegram_update_jobs set status='done', completed_at=now() where status in ('pending','claimed')`;
  });
  afterAll(async () => {
    await sql.end({ timeout: 2 });
  });
  it("فشلُ الأولى يحجبُ الثانيةَ للمستخدمِ نفسِه فقط، والميتةُ لا تحجب", async () => {
    const base = 9_500_000 + (Date.now() % 100_000) * 10;
    const U = 777_001;
    const V = 777_002;
    await put(base, U, 30);
    await put(base + 1, U, 20);
    await put(base + 2, V, 10);
    const q = createPostgresTelegramUpdateQueue(sql, { leaseTimeoutSeconds: 30, maxAttempts: 2, retryDelaySeconds: 2 });
    const j1 = (await q.claimFor!("rider")).job!;
    expect(j1.updateId).toBe(base);
    // وظيفةُ U الثانيةُ محجوبةٌ والأولى محجوزة؛ V غيرُ محجوب
    const j2 = (await q.claimFor!("rider")).job!;
    expect(j2.updateId).toBe(base + 2);
    expect((await q.claimFor!("rider")).job).toBeNull();
    // الأولى تفشل ⇒ pending باحتياط 2ث؛ الثانيةُ ما زالت محجوبة
    await q.finish(j1, false, "SEND_FAILED");
    await q.finish(j2, true);
    expect((await q.claimFor!("rider")).job).toBeNull();
    await new Promise((r) => setTimeout(r, 2300));
    const again = (await q.claim()).job!;
    expect(again.updateId).toBe(base); // الإعادةُ قبلَ اللاحقة
    await q.finish(again, false, "SEND_FAILED"); // المحاولةُ الثانية = الأخيرة ⇒ dead
    const [st] = await sql<{ status: string }[]>`select status from telegram_update_jobs where bot='rider' and update_id=${base}`;
    expect(st!.status).toBe("dead");
    const next = (await q.claim()).job!;
    expect(next.updateId).toBe(base + 1); // الميتةُ لا تحجب
    await q.finish(next, true);
  }, 20_000);
});
