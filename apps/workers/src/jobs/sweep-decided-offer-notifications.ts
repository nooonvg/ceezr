/**
 * الغرض: كنسُّ صفوفِ العروضِ المحسومةِ من طابورِ الإشعاراتِ جملةً — العرضُ الذي
 * قُبِلَ أو أُلغيَ أو انتهت صلاحيّتُهُ لا معنى لإشعارِهِ، وبقاؤُهُ معلّقًا يؤخّرُ
 * المعالجَ (معدلُ الالتقاطِ) ويكسرُ بوابةَ P7 ولو كانَ صفًّا واحدًا (موجةُ ١٠٠:
 * صفٌّ واحدٌ من ~١٦ ألفًا قعدَ ١٨٥ث).
 * الحالة: منفّذ فعليًّا — `LOAD-01 Recovery` (CAP-RUN-20261016-CONTINUATION).
 * ينتمي إلى: apps/workers/src/jobs
 * القرارُ في الدالّةِ `sweep_decided_offer_notifications` (٢٠٢٦١٠١٧١٣٠٠٠٠) —
 * الكنسُ لا يمسُّ إلا `pending` من نوعِ `offer` المحسومَ في `order_offers`،
 * وسمُّ الموتِ هوَ نفسُهُ الذي يكتبُهُ المعالجُ (`ABANDONED`).
 */

import { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";

export interface SweepDecidedOffersReport {
  readonly swept: number;
}

export type SweepDecidedOffersError = PortFailureError;

/** كنسٌ واحدٌ لكلِّ المدنِ: الدالّةُ تنظرُ الطابورَ كلَّهُ لا مدينةً بعينِها. */
export async function sweepDecidedOfferNotifications(
  sql: Sql,
): Promise<Result<SweepDecidedOffersReport, SweepDecidedOffersError>> {
  try {
    const rows = await sql<{ result: unknown }[]>`
      select public.sweep_decided_offer_notifications() result
    `;
    const envelope = rows[0]?.result as { ok?: boolean; swept?: number } | null;
    if (envelope === null || envelope.ok !== true || typeof envelope.swept !== "number") {
      return err(new PortFailureError("db", "sweep_decided_offer_notifications: MALFORMED_RESULT"));
    }
    return ok({ swept: envelope.swept });
  } catch {
    return err(new PortFailureError("db", "sweep_decided_offer_notifications: STORE_ERROR"));
  }
}
