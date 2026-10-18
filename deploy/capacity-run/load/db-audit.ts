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
    byKind: Record<string, { total: number; delivered: number; pending: number; dead: number }>;
    /** الجولاتُ المتراكمةُ عبرَ الجولاتِ — لا تُقرأ حكمًا على جولةٍ بعينِها. */
    readonly byKindAllTime: Record<
      string,
      { total: number; delivered: number; pending: number; dead: number }
    >;
    oldestPendingSec: number | null;
  };
  /** قياسُ قناةِ الإرسالِ من سجلِ المحاكي في نافذةِ الموجةِ — دليلُ سببِ P7
   *  لا افتراضَهُ: لكلِّ بوتٍ مقبولٌ (200) ومرفوضٌ (429) من إرسالياتِ المحاكي. */
  readonly egress: { byBot: Record<string, { accepted: number; rejected: number }> } | null;
  readonly engagedDuplicates: number;
  readonly activeRides: number;
  /**
   * ADR 0287 — قناةُ تسليمِ أطوارِ رحلةِ الراكبِ في نافذةِ الموجةِ: إيصالُ Mini App
   * (`miniapp_ack`) منفصلٌ عن قبولِ Telegram API (`telegram`)، والإقراراتُ
   * المتأخرةُ (إيصالٌ على صفٍّ أُغلقَ بتيليجرامَ) تُعدُّ وحدَها — وزمنُ الإقرارِ
   * منَ الإدراجِ إلى الإيصالِ (p50/p95/p99 بالثواني).
   */
  /**
   * S5 (ADR 0288 §ملحق) — وظائفُ تحديثاتِ تيليجرامَ في نافذةِ الموجةِ: زمنُ إتمامِ الوظيفةِ
   * (الاستلامُ ⇐ \`done\`) منفصلًا عن حالةِ الردِّ (زمنُ الردِّ لا يُخزَّنُ: يُمحى ختمُ الالتقاطِ عندَ النجاحِ، فلا يُختلَقُ). \`r11-wave-500\` فشلَ لأنَّ الأوّلَ
   * صارَ تابعًا للثاني. رصدٌ لا بوابةٌ جديدةٌ؛ \`null\` على قاعدةٍ قبلَ S5.
   */
  readonly telegramUpdates: {
    readonly jobs: number;
    readonly jobsByStatus: Readonly<Record<string, number>>;
    readonly repliesByStatus: Readonly<Record<string, number>>;
    readonly jobDoneLatencySec: { p50: number | null; p95: number | null; max: number | null };
  } | null;
  readonly riderTripChannel: {
    phaseRows: number;
    miniappAck: number;
    telegram: number;
    pending: number;
    other: number;
    receipts: number;
    lateReceiptsAfterTelegram: number;
    duplicateReceipts: number;
    ackLatencySec: { p50: number | null; p95: number | null; p99: number | null };
    telegramLatencySec: { p50: number | null; p95: number | null; p99: number | null };
  } | null;
}

async function snapshot(): Promise<Snapshot> {
  // نافذةُ الجولةِ: لحظةُ اللقطةِ القبليةِ — بمصدرٍ واحدٍ للفحصِ القبليِّ
  // (byKind) والقياسِ بعديِّ (egress) لا مصدرينِ يفترقانِ فيُقرأُ التراكمُ
  // المتراكمُ حكمًا على الجولةِ (خطأٌ كشفَهُ تحقيقُ الاستكمالِ: «delivered»
  // كانَ يعدُّ صفوفَ الجولاتِ السابقةِ لأنَّ التنقيةَ بينَ الموجاتِ لا تمسُّ
  // المُسلَّمَ منها ولا الميتَ).
  let sinceMs: number | null = null;
  if (existsSync(prePath)) {
    try {
      const pre = JSON.parse(readFileSync(prePath, "utf8")) as { snapshot: Snapshot };
      sinceMs = Date.parse(pre.snapshot.at);
    } catch {
      sinceMs = null;
    }
  }
  const [orders, offers, avail, outbox, dups, byKindRows, byKindAllRows] = await Promise.all([
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
    sql<{ kind: string; total: string; delivered: string; pending: string; dead: string }[]>`
      select kind, count(*)::text as total,
             count(*) filter (where status = 'delivered')::text as delivered,
             count(*) filter (where status = 'pending')::text as pending,
             count(*) filter (where status = 'dead')::text as dead
        from notification_outbox
        ${sql`where created_at >= ${sinceMs === null ? new Date(0) : new Date(sinceMs)}`}
        group by 1`,
    sql<{ kind: string; total: string; delivered: string; pending: string; dead: string }[]>`
      select kind, count(*)::text as total,
             count(*) filter (where status = 'delivered')::text as delivered,
             count(*) filter (where status = 'pending')::text as pending,
             count(*) filter (where status = 'dead')::text as dead
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
        dead: Number(r.dead),
      },
    ]),
  );
  const byKindAllTime = Object.fromEntries(
    byKindAllRows.map((r) => [
      r.kind,
      {
        total: Number(r.total),
        delivered: Number(r.delivered),
        pending: Number(r.pending),
        dead: Number(r.dead),
      },
    ]),
  );
  // سجلُ المحاكي: عدُّ الإرسالياتِ في نافذةِ الموجةِ (بوسمِ الوقتِ لا قراءةِ كلِّ
  // الملفِّ) — يقرأُ آخرَ ما أمكنَهُ من الصفوفِ بكفاءةٍ (الملفُ حلقةٌ متراكمةٌ).
  const egress = readMockEgress(sinceMs);
  const since = sinceMs === null ? new Date(0) : new Date(sinceMs);
  let telegramUpdates: Snapshot["telegramUpdates"] = null;
  try {
    const [t] = await sql<Record<string, string | null>[]>`
      with j as (
        select status, reply_status, created_at, completed_at
          from telegram_update_jobs where created_at >= ${since}
      )
      select
        (select count(*) from j)::text as jobs,
        (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)::text
           from (select status, count(*) c from j group by 1) x) as by_status,
        (select coalesce(jsonb_object_agg(coalesce(reply_status, 'none'), c), '{}'::jsonb)::text
           from (select reply_status, count(*) c from j group by 1) x) as by_reply,
        (select percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) from j where status = 'done')::text as job_p50,
        (select percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at)) from j where status = 'done')::text as job_p95,
        (select max(extract(epoch from completed_at - created_at)) from j where status = 'done')::text as job_max`;
    const n = (v: string | null | undefined) =>
      v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;
    telegramUpdates = {
      jobs: Number(t?.jobs ?? 0),
      jobsByStatus: JSON.parse(t?.by_status ?? "{}"),
      repliesByStatus: JSON.parse(t?.by_reply ?? "{}"),
      jobDoneLatencySec: { p50: n(t?.job_p50), p95: n(t?.job_p95), max: n(t?.job_max) },
    };
  } catch {
    telegramUpdates = null;
  }
  let riderTripChannel: Snapshot["riderTripChannel"] = null;
  try {
    const [ch] = await sql<Record<string, string | null>[]>`
      with rows as (
        -- تسليمُ تيليجرامَ العاديُّ لا يكتبُ القناةَ (تبقى null) ويحملُ معرّفَ رسالةٍ:
        -- فهوَ «telegram» بدليلِه (قبولُ API)، لا يُخلطُ بإيصالِ Mini App.
        select n.id, n.status,
               case when n.delivered_channel is not null then n.delivered_channel
                    when n.delivered_message_id is not null then 'telegram' end as delivered_channel,
               n.created_at, n.delivered_at
          from notification_outbox n
         where n.kind = 'rider_trip_notice' and n.created_at >= ${since}
           and n.payload ->> 'event' in ('MATCHED','ARRIVED','STARTED','COMPLETED')
      ), rc as (
        select r.delivery_id, r.acked_at, rows.delivered_channel, rows.created_at
          from rider_trip_event_receipts r join rows on rows.id = r.delivery_id
      )
      select
        (select count(*) from rows)::text as phase_rows,
        (select count(*) from rows where status = 'delivered' and delivered_channel = 'miniapp_ack')::text as miniapp_ack,
        (select count(*) from rows where status = 'delivered' and delivered_channel = 'telegram')::text as telegram,
        (select count(*) from rows where status in ('pending','sending'))::text as pending,
        (select count(*) from rows where not (status = 'delivered' and coalesce(delivered_channel, '') in ('miniapp_ack','telegram')) and status not in ('pending','sending'))::text as other,
        (select count(*) from rc)::text as receipts,
        (select count(*) from rc where delivered_channel = 'telegram')::text as late_receipts,
        (select count(*) - count(distinct delivery_id) from rc)::text as duplicate_receipts,
        (select percentile_cont(0.5) within group (order by extract(epoch from acked_at - created_at)) from rc)::text as ack_p50,
        (select percentile_cont(0.95) within group (order by extract(epoch from acked_at - created_at)) from rc)::text as ack_p95,
        (select percentile_cont(0.99) within group (order by extract(epoch from acked_at - created_at)) from rc)::text as ack_p99,
        (select percentile_cont(0.5) within group (order by extract(epoch from delivered_at - created_at)) from rows where delivered_channel = 'telegram' and status = 'delivered')::text as tg_p50,
        (select percentile_cont(0.95) within group (order by extract(epoch from delivered_at - created_at)) from rows where delivered_channel = 'telegram' and status = 'delivered')::text as tg_p95,
        (select percentile_cont(0.99) within group (order by extract(epoch from delivered_at - created_at)) from rows where delivered_channel = 'telegram' and status = 'delivered')::text as tg_p99`;
    const n = (v: string | null | undefined) =>
      v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;
    riderTripChannel = {
      phaseRows: Number(ch?.phase_rows ?? 0),
      miniappAck: Number(ch?.miniapp_ack ?? 0),
      telegram: Number(ch?.telegram ?? 0),
      pending: Number(ch?.pending ?? 0),
      other: Number(ch?.other ?? 0),
      receipts: Number(ch?.receipts ?? 0),
      lateReceiptsAfterTelegram: Number(ch?.late_receipts ?? 0),
      duplicateReceipts: Number(ch?.duplicate_receipts ?? 0),
      ackLatencySec: { p50: n(ch?.ack_p50), p95: n(ch?.ack_p95), p99: n(ch?.ack_p99) },
      telegramLatencySec: { p50: n(ch?.tg_p50), p95: n(ch?.tg_p95), p99: n(ch?.tg_p99) },
    };
  } catch {
    // قاعدةٌ قبلَ ADR 0287 (لا جدولَ إيصالاتٍ): القناةُ غيرُ مقيسةٍ — `null` صريحًا.
    riderTripChannel = null;
  }
  return {
    at: new Date().toISOString(),
    ordersByStatus: byStatus(orders),
    telegramUpdates,
    offersByStatus: byStatus(offers),
    availability: {
      available: Number(avail[0]?.available ?? "0"),
      total: Number(avail[0]?.total ?? "0"),
    },
    outbox: {
      byStatus: byStatus(outbox),
      byKind,
      byKindAllTime,
      oldestPendingSec: pendingOldest === null ? null : Math.round(Number(pendingOldest)),
    },
    egress,
    engagedDuplicates: Number(dups[0]?.count ?? "0"),
    activeRides,
    riderTripChannel,
  };
}

/**
 * عدُّ إرسالياتِ المحاكي لكلِّ بوتٍ في نافذةِ الموجةِ (منذُ لحظةِ اللقطةِ
 * القبليةِ إن وُجدَتْ) — القبولُ (200) والرفضُ (429) — دليلُ سببِ P7 من سجلِ
 * المزوّدِ لا من حدسٍ. الملفُّ حلقةٌ متراكمةٌ عبرَ الجولاتِ فيُرشَّحُ بالوقتِ.
 */
function readMockEgress(sinceMs: number | null): Snapshot["egress"] {
  const path = `${EV}/telegram-mock.jsonl`;
  if (!existsSync(path)) return null;
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
