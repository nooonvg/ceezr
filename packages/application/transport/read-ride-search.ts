/**
 * الغرض: حالةُ استخدامِ قراءةِ حالةِ البحثِ — حالةٌ ودورةٌ **وعددُ من أُخطِرَ
 *   فعلاً** وطورٌ مُصنَّفٌ وزمنٌ مقيسٌ من ختمِ الإنشاءِ (البند `F2-05` · `SR-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يقرأُ الحالةَ نفسَها بعدَ الإسنادِ ويزيدُ
 *   عليها بياناتِ السائقِ المُسنَدِ — ولا يكتبُ قارئاً ثانياً.
 * ملاحظات مستقبلية: متى استُضيفَ محرِّكُ توجيهٍ (`ADR 0024`) زِيدَت مدّةُ وصولِ
 *   السائقِ ههنا موسومةً، ولا تُعرَضُ قبلَ الإسنادِ لأنَّها لا تُقاسُ قبلَه.
 *
 * ## لماذا الطورُ يُشتَقُّ في هذه الطبقةِ
 *
 * القاعدةُ تُعطي وقائعَ: حالةٌ وعددٌ وختمٌ. و«أيَّ طورٍ يرى الراكبُ» قرارُ منتَجٍ
 * يُقرأُ ويُراجَعُ ويُختبَرُ وحدَه (القاعدة 0.3)، فمكانُه `packages/domain`،
 * واستدعاؤُه ههنا. ولو اشتُقَّ في الشاشةِ لَتكرَّرَ في كلِّ سطحٍ ولَاختلفَ.
 *
 * ## ولماذا يُنشَرُ `elapsedSeconds` ولا يُترَكُ للعميلِ
 *
 * ساعةُ الهاتفِ قد تسبقُ ساعةَ القاعدةِ أو تتأخَّرُ عنها بدقائقَ. فالخادمُ يُنشرُ
 * ختمَ الإنشاءِ **وزمناً مقيساً بساعتِه** معاً: الشاشةُ تبدأُ من الرقمِ الصادقِ
 * ثمَّ تُكمِلُ العَدَّ محلّيّاً، ولا تحسبُ الفرقَ بساعةٍ لا تملكُ صدقَها.
 *
 * ## ما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تُعلِنُ هويّةَ سائقٍ ولا موقعَه قبلَ الإسنادِ**: من لم يُسنَدْ ليسَ
 *      معلومةً للراكبِ، ونشرُ «ثلاثةُ سائقينَ قريبونَ» يُنتِجُ تعقُّباً لا خدمةً.
 *   ــ **لا تُخفي الصفرَ**: صفرُ مُخطَرينَ عددٌ صادقٌ يُنشَرُ كما هوَ، والشاشةُ
 *      تشرحُه (`ADR 0023`: الصمتُ ليسَ رفضاً).
 *   ــ **لا تعرفُ أجرةً ولا عقوبةَ إلغاءٍ** (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا تُميِّزُ «ليسَ لك» من «غيرُ موجودٍ»**: القاعدةُ تُعيدُ
 *      `ORDER_NOT_FOUND` للأمرَينِ كي لا يُستدَلَّ بوجودِ معرّفٍ على وجودِ رحلةٍ.
 */

import {
  elapsedSecondsSince,
  type SearchPhase,
  searchPhaseOf,
} from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type { RideSearchReader, RideSearchRefusal, RideSearchState } from "./ride-request-ports.ts";

export interface ReadRideSearchDeps {
  readonly sessions: MiniAppSessionReader;
  readonly search: RideSearchReader;
  readonly now: () => Date;
}

/** حالةٌ مقروءةٌ **وقد اشتُقَّ طورُها وزمنُها** — لا رقماً خاماً وحدَه. */
export interface RideSearchView {
  readonly state: RideSearchState;
  readonly phase: SearchPhase;
  readonly elapsedSeconds: number;
}

export type ReadRideSearchResult =
  | { readonly found: true; readonly view: RideSearchView }
  | { readonly found: false; readonly refusal: RideSearchRefusal };

export async function readRideSearch(
  deps: ReadRideSearchDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<ReadRideSearchResult, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  const read = await deps.search.read({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));

  const verdict = read.value;
  if (!verdict.found) return ok({ found: false, refusal: verdict.refusal });

  const { state } = verdict;
  return ok({
    found: true,
    view: {
      state,
      phase: searchPhaseOf({
        status: state.status,
        notifiedDriverCount: state.notifiedDriverCount,
        createdAtMs: state.createdAtMs,
        widerCircleOpened: state.widerCircleOpened,
        escalated: state.escalated,
      }),
      // `WR-06`: من بدءِ البحثِ لا من الإنشاء — مجدولٌ أُطلِقَ الآنَ لم يبحث منذُ أمس.
      // والمجدولُ لم يبدأْ بحثُه أصلًا فمدّتُه صفر.
      elapsedSeconds:
        state.status === "scheduled"
          ? 0
          : elapsedSecondsSince(state.searchStartedAtMs ?? state.createdAtMs, deps.now().getTime()),
    },
  });
}
