/**
 * `LOAD-01` — تدقيقُ القاعدةِ قبلَ الجولةِ وبعدَها: إثباتُ التنظيفِ وسلامةِ
 * الإسنادِ منَ القاعدةِ مباشرةً لا منَ عدّاداتِ المولّدِ وحدها.
 *
 *   RUN_DIR=… bun run deploy/capacity-run/load/db-audit.ts --phase pre
 *   RUN_DIR=… bun run deploy/capacity-run/load/db-audit.ts --phase post
 *
 * - `pre`: لقطةٌ قبلَ الجولةِ تُكتبُ في `db-audit-pre.json` (أساسُ الفرقِ).
 * - `post`: لقطةٌ بعدَها + الفرقُ عن اللقطةِ السابقةِ + مطابقةُ مآلاتِ
 *   السيناريوهاتِ (من `miniapp-load-events.jsonl`) معَ الحالةِ الفعليةِ في
 *   القاعدةِ، وتفاصيلُ كلِّ حالةٍ فاشلةٍ (الطلبُ وعروضُهُ) — ثم حكمُ
 *   مخالفاتٍ صريحٌ: الخروجُ بغيرِ الصفرِ يعني مخالفةً صلبةً لا تُتجاوز.
 *
 * لا يُسجَّلُ سرٌّ ولا payload — أعدادٌ وحالاتٌ ومعرّفاتٌ مقطوعةُ البادئةِ.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { EV, GEN_ID, sql, T0 } from "./lib.ts";

const args = new Set(process.argv.slice(2));
const phase = args.has("--phase=post") ? "post" : args.has("--phase=pre") ? "pre" : "";
if (phase === "") {
  console.error("✖ عيّن --phase=pre أو --phase=post.");
  process.exit(2);
}

interface Snapshot {
  readonly at: string;
  readonly ordersByStatus: Record<string, number>;
  readonly offersByStatus: Record<string, number>;
  readonly availability: { available: number; total: number };
  readonly outbox: {
    byStatus: Record<string, number>;
    byKind: Record<string, { total: number; delivered: number; pending: number }>;
    oldestPendingSec: number | null;
  };
  /** قياسُ قناةِ الإرسالِ من سجلِ المحاكي في نافذةِ الموجةِ — دليلُ سببِ P7
   *  لا افتراضَهُ: لكلِّ بوتٍ مقبولٌ (200) ومرفوضٌ (429) من إرسالياتِ المحاكي. */
  readonly egress: { byBot: Record<string, { accepted: number; rejected: number }> } | null;
  readonly engagedDuplicates: number;
  readonly activeRides: number;
}

async function snapshot(): Promise<Snapshot> {
  const [orders, offers, avail, outbox, dups, byKindRows] = await Promise.all([
    sql<
      { status: string; n: string }[]
    >`select status::text as status, count(*)::text as n from orders group by 1`,
    sql<
      { status: string; n: string }[]
    >`select status::text as status, count(*)::text as n from order_offers group by 1`,
    sql<{ available: string; total: string }[]>`
      select count(*) filter (where is_available)::text as available, count(*)::text as total from driver_availability`,
    sql<{ status: string; n: string; oldest: string | null }[]>`
      select status::text as status, count(*)::text as n,
             extract(epoch from (now() - min(created_at)))::text as oldest
        from notification_outbox group by 1`,
    sql<{ count: string }[]>`
      select count(*)::text as count from (
        select assigned_driver_id from orders
         where assigned_driver_id is not null and is_driver_engaged_order_status(status)
         group by assigned_driver_id having count(*) > 1
      ) as d`,
    sql<{ kind: string; total: string; delivered: string; pending: string }[]>`
      select kind, count(*)::text as total,
             count(*) filter (where status = 'delivered')::text as delivered,
             count(*) filter (where status = 'pending')::text as pending
        from notification_outbox group by 1`,
  ]);
  const byStatus = (rows: { status: string; n: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  const pendingOldest = outbox.find((r) => r.status === "pending")?.oldest ?? null;
  const activeRides = orders
    .filter((r) => ["searching", "matched", "in_progress", "scheduled"].includes(r.status))
    .reduce((acc, r) => acc + Number(r.n), 0);
  const byKind = Object.fromEntries(
    byKindRows.map((r) => [
      r.kind,
      {
        total: Number(r.total),
        delivered: Number(r.delivered),
        pending: Number(r.pending),
      },
    ]),
  );
  // سجلُ المحاكي: عدُّ الإرسالياتِ في نافذةِ الموجةِ (بوسمِ الوقتِ لا قراءةِ كلِّ
  // الملفِّ) — يقرأُ آخرَ ما أمكنَهُ من الصفوفِ بكفاءةٍ (الملفُ حلقةٌ متراكمةٌ).
  const egress = readMockEgress();
  return {
    at: new Date().toISOString(),
    ordersByStatus: byStatus(orders),
    offersByStatus: byStatus(offers),
    availability: {
      available: Number(avail[0]?.available ?? "0"),
      total: Number(avail[0]?.total ?? "0"),
    },
    outbox: {
      byStatus: byStatus(outbox),
      byKind,
      oldestPendingSec: pendingOldest === null ? null : Math.round(Number(pendingOldest)),
    },
    egress,
    engagedDuplicates: Number(dups[0]?.count ?? "0"),
    activeRides,
  };
}

/**
 * عدُّ إرسالياتِ المحاكي لكلِّ بوتٍ في نافذةِ الموجةِ (منذُ لحظةِ اللقطةِ
 * القبليةِ إن وُجدَتْ) — القبولُ (200) والرفضُ (429) — دليلُ سببِ P7 من سجلِ
 * المزوّدِ لا من حدسٍ. الملفُّ حلقةٌ متراكمةٌ عبرَ الجولاتِ فيُرشَّحُ بالوقتِ.
 */
function readMockEgress(): Snapshot["egress"] {
  const path = `${EV}/telegram-mock.jsonl`;
  if (!existsSync(path)) return null;
  let sinceMs: number | null = null;
  if (existsSync(prePath)) {
    try {
      const pre = JSON.parse(readFileSync(prePath, "utf8")) as { snapshot: Snapshot };
      sinceMs = Date.parse(pre.snapshot.at);
    } catch {
      sinceMs = null;
    }
  }
  const byBot: Record<string, { accepted: number; rejected: number }> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = Number(rec.t);
    if (sinceMs !== null && Number.isFinite(t) && t < sinceMs) continue;
    const bot = String(rec.bot ?? "?");
    byBot[bot] ??= { accepted: 0, rejected: 0 };
    if (rec.status === 200) byBot[bot].accepted += 1;
    else if (rec.status === 429) byBot[bot].rejected += 1;
  }
  return { byBot };
}

function readOutcomes(): {
  total: number;
  verified: number;
  failed: number;
  closeDeadlineHits: number;
  byOrder: Map<string, { kind: string; reason?: string; index?: number }>;
} {
  const path = `${EV}/miniapp-load-events.jsonl`;
  const byOrder = new Map<string, { kind: string; reason?: string; index?: number }>();
  let total = 0;
  let verified = 0;
  let failed = 0;
  let closeDeadlineHits = 0;
  if (!existsSync(path)) {
    return { total, verified, failed, closeDeadlineHits, byOrder };
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (evt.event !== "scenario.outcome") continue;
    total += 1;
    const kind = String(evt.kind);
    const reason = evt.reason === undefined ? undefined : String(evt.reason);
    const orderId = evt.orderId === undefined ? undefined : String(evt.orderId);
    const index = evt.index === undefined ? undefined : Number(evt.index);
    if (kind === "verified") verified += 1;
    else failed += 1;
    if ((reason ?? "").includes("close_deadline")) closeDeadlineHits += 1;
    if (orderId !== undefined) byOrder.set(orderId, { kind, reason, index });
  }
  return { total, verified, failed, closeDeadlineHits, byOrder };
}

const prePath = `${EV}/db-audit-pre.json`;

async function main() {
  const snap = await snapshot();
  if (phase === "pre") {
    writeFileSync(prePath, JSON.stringify({ gen: GEN_ID, phase, snapshot: snap }, null, 2));
    console.log(JSON.stringify({ phase, ok: true, snapshot: snap }));
    await sql.end({ timeout: 5 });
    return;
  }

  const outcomes = readOutcomes();
  // مطابقةُ مآلاتِ السيناريوهاتِ معَ القاعدةِ: الناجحُ يجبُ أن يكونَ مكتملًا
  // (أو مُسندًا في وضعِ assign)، والفاشلُ يجبُ ألا يكونَ مكتملًا وكأنه نجح.
  const mismatches: { orderId: string; kind: string; reason?: string; status: string }[] = [];
  const failuresDetail: unknown[] = [];
  for (const [orderId, outcome] of outcomes.byOrder) {
    const rows = await sql<{ status: string; assigned: string | null }[]>`
      select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}
    `;
    const status = rows[0]?.status ?? "missing";
    if (outcome.kind === "verified" && status !== "completed" && status !== "matched") {
      mismatches.push({ orderId, kind: outcome.kind, reason: outcome.reason, status });
    }
    if (outcome.kind !== "verified" && status === "completed") {
      mismatches.push({
        orderId,
        kind: outcome.kind,
        reason: outcome.reason,
        status: `${status} (اكتمل في القاعدة رغم فشل التصنيف)`,
      });
    }
    if (outcome.kind !== "verified") {
      const offers = await sql<
        {
          id: string;
          status: string;
          driver_id: string;
          round: number;
          created_at: string;
          expires_at: string;
          responded_at: string | null;
        }[]
      >`
        select id::text, status::text, driver_id::text, round, created_at::text,
               expires_at::text, responded_at::text
          from order_offers where order_id = ${orderId} order by round, created_at
      `;
      failuresDetail.push({
        index: outcome.index,
        orderId,
        kind: outcome.kind,
        reason: outcome.reason,
        orderStatus: status,
        assignedDriver: rows[0]?.assigned?.slice(0, 8) ?? null,
        offers: offers.map((o) => ({
          id: o.id.slice(0, 8),
          status: o.status,
          driver: o.driver_id.slice(0, 8),
          round: o.round,
          createdAt: o.created_at,
          expiresAt: o.expires_at,
          respondedAt: o.responded_at,
        })),
      });
    }
  }

  // الفرقُ عن اللقطةِ قبلَ الجولةِ — إثباتُ التنظيفِ لا افتراضُهُ.
  let pre: Snapshot | null = null;
  if (existsSync(prePath)) {
    try {
      pre = (JSON.parse(readFileSync(prePath, "utf8")) as { snapshot: Snapshot }).snapshot;
    } catch {
      pre = null;
    }
  }
  const availabilityLeftover =
    pre === null ? null : snap.availability.available - pre.availability.available;

  const violations: { rule: string; detail: string }[] = [];
  if (snap.engagedDuplicates > 0) {
    violations.push({
      rule: "double_assignment",
      detail: `${snap.engagedDuplicates} سائقًا ملتزمًا بأكثر من التزام`,
    });
  }
  if (outcomes.closeDeadlineHits > 0) {
    violations.push({
      rule: "close_deadline_hits",
      detail: `${outcomes.closeDeadlineHits} سيناريو تجاوز نافذة الإغلاق`,
    });
  }
  if (availabilityLeftover !== null && availabilityLeftover > Math.max(1, outcomes.total * 0.01)) {
    violations.push({
      rule: "availability_leftover",
      detail: `${availabilityLeftover} سائقًا بقوا متاحين بعد الجولة (نظافة الحوض مطلوبة)`,
    });
  }
  if (mismatches.length > 0) {
    violations.push({
      rule: "scenario_db_mismatch",
      detail: `${mismatches.length} مآلًا لا يطابق الحالة الفعلية في القاعدة`,
    });
  }
  if (snap.outbox.oldestPendingSec !== null && snap.outbox.oldestPendingSec > 120) {
    violations.push({
      rule: "stale_pending_outbox",
      detail: `أقدم مهمة معلقة عمرها ${snap.outbox.oldestPendingSec}ث (> 120ث)`,
    });
  }

  const report = {
    gen: GEN_ID,
    phase,
    sinceT0Sec: Math.round((Date.now() - T0) / 1000),
    snapshot: snap,
    preSnapshot: pre,
    diff: {
      availabilityLeftover,
      activeRidesDelta: pre === null ? null : snap.activeRides - pre.activeRides,
      ordersDelta:
        pre === null
          ? null
          : Object.keys({ ...pre.ordersByStatus, ...snap.ordersByStatus }).reduce<
              Record<string, number>
            >((acc, k) => {
              const d = (snap.ordersByStatus[k] ?? 0) - (pre.ordersByStatus[k] ?? 0);
              if (d !== 0) acc[k] = d;
              return acc;
            }, {}),
    },
    outcomes: {
      total: outcomes.total,
      verified: outcomes.verified,
      failed: outcomes.failed,
      closeDeadlineHits: outcomes.closeDeadlineHits,
    },
    mismatches,
    failuresDetail,
    violations,
    verdict: violations.length === 0 ? "CLEAN" : "VIOLATIONS",
  };
  writeFileSync(`${EV}/db-audit-post.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase, verdict: report.verdict, violations: violations.length }));
  await sql.end({ timeout: 5 });
  process.exit(violations.length === 0 ? 0 : 1);
}

void main();
