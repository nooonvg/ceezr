/**
 * الغرض: CAP-RUN-20261015 / D3 (تكامل على PostgreSQL حقيقي) — المعالجةُ المزدوجةُ بانتهاءِ الإيجار.
 *   وظيفتانِ لمستخدمَين ومعالجةٌ (1.6ث) أطولُ من الإيجار (1ث)، وشوطٌ ثانٍ متداخل:
 *   بلا تجديد ⇒ يسترجعُها الشوطُ الثاني وتُعالَجُ مرّتين؛ بالتجديد ⇒ كلٌّ مرّةً واحدة.
 *   (قبلَ D4 كانت الوظائفُ المنتظرةُ في مسارِ المستخدمِ تصيبُها المشكلةُ نفسُها ولو كانت المعالجةُ قصيرة.)
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. يعزلُ نفسَه بمعرّفاتِ update_id فريدة.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;

async function enqueue(base: number, n: number, user: number) {
  for (let i = 0; i < n; i++)
    await sql`select claim_and_enqueue_telegram_update('rider', ${base + i}, ${sql.json({ update_id: base + i, message: { from: { id: user }, chat: { id: user } } })}::jsonb, 100)`;
  // تسلسلُ created_at صارمٌ ليكونَ ترتيبُ الالتقاطِ = ترتيبُ الإيداع
  await sql`update telegram_update_jobs set created_at = now() - make_interval(secs => 100 - (update_id - ${base})) where bot='rider' and update_id between ${base} and ${base + n - 1}`;
}

d("D3 على قاعدةٍ حقيقية: تجديدُ إيجارِ المحجوزِ المنتظر", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: URL ?? "" });
  });
  afterAll(async () => {
    await sql.end({ timeout: 2 });
  });

  for (const renew of [false, true]) {
    it(renew
      ? "بالتجديد: كلُّ وظيفةٍ تُعالَجُ مرّةً وتُختَم"
      : "إعادةُ إنتاج: بلا تجديدٍ تُعالَجُ وظائفُ مرّتين", async () => {
      const base = (renew ? 9_100_000 : 9_000_000) + (Date.now() % 100_000) * 10;
      await enqueue(base, 1, 4242);
      await enqueue(base + 1, 1, 4343);
      const queue = createPostgresTelegramUpdateQueue(sql, {
        leaseTimeoutSeconds: 1,
        maxAttempts: 5,
        retryDelaySeconds: 1,
      });
      const q: typeof queue = renew ? queue : (({ renew: _r, ...rest }) => rest)(queue);
      const handled = new Map<number, number>();
      const stamps: string[] = [];
      const handler = {
        handle: async (_bot: string, payload: unknown) => {
          const id = (payload as { update_id: number }).update_id;
          handled.set(id, (handled.get(id) ?? 0) + 1);
          await new Promise((r) => setTimeout(r, 1600)); // ≫ إيجارُ 1ث
          return true;
        },
      };
      // شوطان متزامنان (كنسختين/شوطين متداخلين) — الثاني يلتقطُ ما انتهى إيجارُه
      const deps = {
        queue: q,
        handler: handler as never,
        maxJobsPerRun: 50,
        lanes: 8,
        leaseRenewEveryMs: 300,
        log: (m: string) => void stamps.push(m),
      };
      await Promise.all([
        drainTelegramUpdateJobsOnce(deps),
        (async () => {
          await new Promise((r) => setTimeout(r, 1500));
          await drainTelegramUpdateJobsOnce(deps);
        })(),
      ]);
      const dup = [...handled.values()].filter((n) => n > 1).length;
      const rows = [
        ...(await sql<
          { status: string; n: number }[]
        >`select status, count(*)::int n from telegram_update_jobs where bot='rider' and update_id between ${base} and ${base + 1} group by 1`),
      ];
      if (renew) {
        expect(dup).toBe(0);
        expect(stamps.filter((s) => s === "telegram.drainer.stamp_failed").length).toBe(0);
        expect(rows).toEqual([{ status: "done", n: 2 }]);
      } else {
        expect(dup).toBeGreaterThan(0);
      }
    }, 30_000);
  }
});
