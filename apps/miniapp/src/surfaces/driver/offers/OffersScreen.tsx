/**
 * الغرض: لوحُ عروضِ السائقِ — **عرضٌ بمؤقّتٍ يعدُّ من ثوانِ الخادمِ** ومسافةٌ
 *   موسومةٌ وتبديلُ توفُّرٍ وسببُ حجبٍ إن كانَ (البند `F3-02` · `SD-03`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — الرحلةُ النشطةُ تُفتَحُ من بعدِ القبولِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## كيفَ يعدُّ هذا اللوحُ بلا أن يثقَ بساعةِ الهاتفِ
 *
 * القاعدةُ تقولُ «بقيَ ٤٧ ثانيةً» **لحظةَ القراءةِ**. والشاشةُ تُسجِّلُ قراءةَ
 * ساعةِ الجهازِ عندَ وصولِ الجوابِ، ثمَّ **تقرؤها لحظةَ كلِّ رسمٍ** وتطرحُ:
 * `الباقي − (فرقُ القراءتَينِ)`. وانحرافُ الساعةِ — ولو ساعتَينِ — **يسقطُ في
 * الطرحِ** لأنَّ القراءتَينِ من ساعةٍ واحدةٍ. ولو قارنّا `expires_at` بـ
 * `Date.now()` لَكانَ الانحرافُ نفسُه يُخفي عرضاً صالحاً أو يُبقي منتهياً.
 *
 * ## ولِمَ **لا عقربَ يدقُّ كلَّ ثانيةٍ**
 *
 * أوّلُ نسخةٍ من هذه الشاشةِ حرَّكَت قراءةَ الساعةِ بـ`setInterval` كلَّ ثانيةٍ
 * (بلا نداءِ شبكةٍ)، **فأسقطَها `scripts/check-system-screens-policy.ts`**:
 * `F1-07` و`ADR 0035` §٤ يمنعانِ **كلَّ** مؤقّتٍ دوريٍّ في التطبيقِ المصغَّرِ لا
 * الاستقصاءَ الشبكيَّ وحدَه، والاستثناءُ مؤجَّلٌ إلى طبقةِ النقلِ الفوريِّ. فعُولِجَ
 * في الجذرِ ولا استثناءَ: **الباقي محسوبٌ لحظةَ الرسمِ** من آخرِ قراءةٍ، ويُحدَّثُ
 * بفعلِ السائقِ (زرُّ «حدِّثِ اللوحَ» · تبديلُ التوفُّرِ · رفضُ عرضٍ · فتحُ تفصيلٍ).
 * فالرقمُ المرسومُ **صادقٌ لحظةَ رسمِه** ويَقدُمُ بينَ رسمَينِ — وهذا حدٌّ مُعلَنٌ
 * لا مسكوتٌ عنه، ومعَه أنَّ **الصلاحيّةَ حكمُ خادمٍ** فقبولُ عرضٍ مضَت مهلتُه
 * يُرَدُّ برمزٍ مُصنَّفٍ لا بنجاحٍ كاذبٍ.
 *
 * ## ولِمَ يبقى العرضُ في القائمةِ بعدَ بلوغِ العدِّ صفراً
 *
 * لأنَّ الصفرَ **تقديرُ جهازٍ لا حكمُ خادمٍ**: الشاشةُ تُخفي الزرَّ وتضعُ نغمةَ
 * «انتهى»، ولا تحذفُ صفّاً لم تقُلِ القاعدةُ فيهِ شيئاً. والقراءةُ التاليةُ هيَ
 * التي تُسقِطُه، فتكونُ القائمةُ صورةَ حالٍ في الخادمِ لا صورةَ ظنٍّ في الهاتفِ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُجدِّدُ القائمةَ من نفسِها ولا تدقُّ**: لا نداءَ دوريَّ ولا مؤقّتَ
 *      عرضٍ (`F1-07`). والدفعُ الفوريُّ (`realtime`) الدَّينُ المُعلَنُ مُنشَطٌ —
 *      `subscribeToOfferUpdates` prop يُجدِّدُ القائمةَ عند كلِّ إشارةٍ عبرَ Socket.IO
 *      (DEC-32 · `ADR 0229`). والزرُّ ظاهرٌ، والباقي يُقرأُ لحظةَ الرسمِ.
 *   ــ **لا خريطةَ ولا خطَّ سيرٍ**: إحداثيّتانِ في التفاصيلِ فحسب، **دَينٌ مُعلَنٌ**.
 *   ــ **لا مدّةَ وصولٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`) لا تقديرٌ من مسافةٍ.
 *   ــ **لا هويّةَ راكبٍ**: عرضٌ مُحتَملٌ لا يُبيحُ كشفَ راكبٍ لكلِّ الجولةِ.
 *   ــ **لا صوتَ ولا اهتزازَ**: تنبيهُ المنصّةِ ليسَ ملكَ هذه الشاشةِ.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { Glyph, IconChevron } from "../../../system/ui/icons.tsx";
import { UiTimer } from "../../../system/ui/index.tsx";
import { offerTimerProps } from "./offer-timer.ts";
import {
  type ApiDriverNegotiationCard,
  ackDriverOfferBoard,
  claimDriverNegotiation,
  type DriverAvailabilityResponse,
  type DriverNegotiationsResponse,
  type DriverOffersResponse,
  leaveDriverNegotiation,
  readDriverNegotiations,
  readDriverOffers,
  rejectDriverOffer,
  setDriverAvailability,
} from "./offers-api.ts";
import {
  type BoardRefreshState,
  boardRefreshNotice,
  canAcceptNow,
  countdownSeconds,
  type DistanceLine,
  isRetryableOffersError,
  type OfferCardModel,
  offerLineText,
  offersCodeOf,
  offersErrorKey,
  pickupAtText,
  toOffersBoard,
} from "./offers-view.ts";

export interface OffersScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /** `UI-4`: حينَ يرسمُ `ScreenFrame` العنوانَ (H1) لا يُكرَّرُ ههنا. الافتراضُ `true`. */
  readonly showTitle?: boolean;
  readonly onOpenOffer?: (offerId: string) => void;
  /**
   * `UI-4`: إصلاحُ حجبِ الوثيقةِ يفتحُ شاشةَ الوثائقِ داخلَ التطبيق. كانَ رابطَ
   * `#/driver/documents` ولا موجِّهَ عناوينَ يقرؤه — فعلٌ لا يفعلُ شيئاً. بلا هذا
   * المستقبِلِ لا يُرسَمُ زرُّ الإصلاحِ، والسببُ يبقى نصّاً.
   */
  readonly onOpenDocuments?: (docType: string) => void;
  /**
   * مدخلُ «مَهمّتي» (`F3-03`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُه يُعيدُ هذه
   * الشاشةَ إلى سلوكِها قبلَ `F3-03` حرفاً. وسائقٌ يُغلِقُ التطبيقَ وهوَ في
   * رحلةٍ يحتاجُ طريقاً إلى مَهمّتِه لا يمرُّ بقبولِ عرضٍ ثانٍ.
   */
  readonly onOpenJob?: () => void;
  /**
   * مدخلُ «حصيلتي» (`F3-05`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُهُ يُعيدُ
   * هذه الشاشةَ إلى سلوكِها قبلَ `F3-05` حرفاً. وموضعُه بعدَ «مَهمّتي»: عملٌ
   * جارٍ أولى من تقريرٍ عن عملٍ مضى.
   */
  readonly onOpenActivity?: () => void;
  /**
   * مدخلُ «اشتراكي» (`F3-06` · `SD-07`) — **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُهُ
   * يُعيدُ هذه الشاشةَ إلى سلوكِها قبلَ `F3-06` حرفاً.
   */
  readonly onOpenSubscription?: () => void;
  /**
   * مدخلُ الدعمِ والشكوى (`F3-08` · `SD-10`) — **زيادةٌ في اللوحِ لا تغييرٌ
   * فيه** (`ح-8`). وموضعُه ههنا لا في قائمةٍ مخفيّةٍ لأنَّ السائقَ الذي لا
   * يصلُه عرضٌ أو خُصِمَ منه مبلغٌ **يفتحُ اللوحَ أوّلاً**، ومَن لم يجدْ باباً
   * يشكو منه في الشاشةِ التي وقعَ فيها الضررُ يشكو في قروبٍ عامٍّ أو يصمتُ.
   */
  readonly onOpenSupport?: () => void;
  /**
   * فتحُ شاشةِ الحسابِ (`SD-12`) — **زيادةُ مدخلٍ لا نقصُ آخرَ** (`ح-8`): مدخلُ
   * الدعمِ ههنا يبقى كما هوَ لأنَّه أقربُ إلى موضعِ الضررِ، ويُزادُ بابُ الحسابِ
   * لأنَّ حقَّ التنزيلِ وحقَّ الحذفِ **مبنيّانِ في القاعدةِ ولا بابَ لهما في
   * سطحِ السائقِ** — وحقٌّ بلا بابٍ حقٌّ غيرُ ممنوحٍ عملاً (القسم 9.12).
   */
  readonly onOpenAccount?: () => void;
  readonly readBoard?: () => Promise<DriverOffersResponse>;
  /**
   * `LOAD-01 Recovery` — إقرارُ استلامِ اللوحِ بعدَ تطبيقِهِ (لا عندَ جلبِهِ):
   * يُفصِلُ «سلّمها الخادمُ» عنِ «وصلَتْ»، وشوطُ التسليمِ يقرأُ الإيصالَ
   * موثَّقًا فلا يُدّعى وصولٌ لم يُقَس. فشلُهُ صامتٌ — إيصالٌ تراكميٌّ.
   */
  readonly ackBoard?: (offerIds: readonly string[]) => Promise<unknown>;
  /**
   * `ADR 0286` — دوراتُ القروبِ المفتوحةُ: إشعارٌ ومطالبةٌ من التطبيقِ لا من زرِّ
   * القروبِ. **زيادةٌ لا تغييرٌ** (`ح-8`): غيابُها يُخفي القسمَ وحدَه.
   */
  readonly readNegotiations?: () => Promise<DriverNegotiationsResponse>;
  readonly claimNegotiation?: (negotiationId: string) => Promise<unknown>;
  readonly leaveNegotiation?: (negotiationId: string) => Promise<unknown>;
  readonly reject?: (offerId: string) => Promise<unknown>;
  readonly setAvailability?: (isAvailable: boolean) => Promise<DriverAvailabilityResponse>;
  /**
   * اشتراكُ تحديثِ العروضِ الآنيِّ (`DEC-32` · `ADR 0229`) — اختياريٌّ: غيابُهُ يُبقي
   * السلوكَ كالسابقِ (لا تحديثٌ آليٌّ). حضورُهُ يُجدِّدُ القائمةَ عند كلِّ إشارةٍ.
   */
  readonly subscribeToOfferUpdates?: (onUpdate: () => void) => () => void;
  /**
   * قراءةُ ساعةِ الجهازِ — **تُمرَّرُ لا تُستدعى في النطاقِ**: بها يصيرُ الباقي
   * مقيساً في الاختبارِ بلا انتظارِ ثوانٍ حقيقيّةٍ.
   */
  readonly now?: () => number;
}

/**
 * أصنافُ نغمةِ المؤقّتِ — **مكتوبةٌ حرفاً** لا مبنيّةً في زمنِ التشغيلِ: حاجزُ
 * تغطيةِ الأنماطِ (`ADR 0105` · `UX-021`) يقرأُ النصَّ الساكنَ.
 */
/**
 * `MSG-COLOR-01` — لونُ بطاقةِ العرضِ بحسبِ الخدمةِ (طلبُ المالكِ): التوصيلُ أصفرُ، والنقلُ
 * أخضرُ، والشهريُّ مستقبلاً ورديٌّ فاتحٌ. جدولٌ ساكنٌ في الملفِّ نفسِه فحاجزُ الأنماطِ يقرؤه.
 */
const SERVICE_TONE: Readonly<Record<string, { readonly modifier: string }>> = {
  delivery: { modifier: "dof__item--delivery" },
  transport: { modifier: "dof__item--transport" },
  monthly: { modifier: "dof__item--monthly" },
};
/** خدمةٌ بلا لونٍ مُعلَنٍ تُرسَمُ بلا مُعدِّلٍ — لا لونَ يُخترَع. */
const NO_SERVICE_TONE = { modifier: "" } as const;
const serviceTone = (service: string) => SERVICE_TONE[service] ?? NO_SERVICE_TONE;

/** ما لا سندَ له في هذه الشاشةِ — يُقالُ ولا يُوضَعُ له زرٌّ صوريٌّ. */
const DECLARED_DEBT: readonly string[] = [
  "driver.offers.debt.push",
  "driver.offers.debt.map",
  "driver.offers.debt.duration",
];

type BoardState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly board: DriverOffersResponse;
      /** قراءةُ ساعةِ الجهازِ لحظةَ وصولِ الجوابِ — أساسُ الطرحِ لا أكثرَ. */
      readonly readAtMs: number;
      /** تحديثٌ آنيٌّ فشلَ — القائمةُ قديمةٌ لكنها ظاهرةٌ. */
      readonly stale?: boolean;
    }
  | { readonly kind: "failed"; readonly code: string };

type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly key: string };

/** `WR-16A` — خطأُ الشبكةِ يُسمّى `NETWORK_UNREACHABLE` (`offersCodeOf`). */
const codeOf = offersCodeOf;

function DistanceRow({
  line,
  labelKey,
  t,
}: {
  readonly line: DistanceLine | null;
  readonly labelKey: string;
  readonly t: (key: string) => string;
}) {
  // غيابُ القياسِ **يُقالُ** ولا يُترَكُ سطراً فارغاً (UX-5)، ولا يُكتَبُ صفراً.
  if (line === null) {
    return (
      <p className="dof__distance dof__distance--absent">
        {t(labelKey)}: {t("rider.quote.distance.unavailable")}
      </p>
    );
  }
  return (
    <p className="dof__distance">
      {t(labelKey)}: {t(line.key).replace("{value}", String(line.value))} ·{" "}
      <span className="dof__distance-kind">{t(line.kindKey)}</span>
    </p>
  );
}

/**
 * `UI-LOOP-02` — ساعةٌ **ثابتةُ الهويّةِ**. كانَت قيمةً افتراضيّةً سهميّةً
 * (`now = () => Date.now()`) تُولَدُ في كلِّ رسمٍ، وهيَ في تبعيّاتِ `useCallback`
 * الذي يُنادى من `useEffect` — فكلُّ رسمٍ يُعيدُ القراءةَ، وكلُّ قراءةٍ تُعيدُ الرسمَ:
 * حلقةٌ لا تنتهي تُومِضُ بها الشاشةُ وتُغرِقُ البوّابةَ بالطلباتِ.
 */
const systemNowMs = (): number => Date.now();

export function OffersScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  showTitle = true,
  onOpenJob,
  onOpenActivity,
  onOpenSubscription,
  onOpenSupport,
  onOpenAccount,
  onOpenOffer,
  onOpenDocuments,
  readBoard = readDriverOffers,
  ackBoard = ackDriverOfferBoard,
  readNegotiations = readDriverNegotiations,
  claimNegotiation = claimDriverNegotiation,
  leaveNegotiation = leaveDriverNegotiation,
  reject = rejectDriverOffer,
  setAvailability = setDriverAvailability,
  subscribeToOfferUpdates,
  now = systemNowMs,
}: OffersScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<BoardState>({ kind: "loading" });
  /**
   * `ADR 0286` — دوراتُ القروبِ: قسمٌ مستقلٌّ لا يسقطُ اللوحَ عندَ فشلِهِ (زيادةٌ
   * لا تغييرٌ)، وفشلُهُ يُقالُ في القسمِ وحدَه.
   */
  const [negotiations, setNegotiations] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly items: readonly ApiDriverNegotiationCard[] }
    | { readonly kind: "failed" }
    | { readonly kind: "hidden" }
  >({ kind: "loading" });
  /**
   * حالةُ صفٍّ واحدٍ في قسمِ دوراتِ القروبِ — بلا مفتاحِ خطأٍ (الفشلُ يُقالُ بنصٍّ
   * واحدٍ ثابتٍ لا برمزٍ يُترجَمُ).
   */
  const [negotiationRows, setNegotiationRows] = useState<
    Readonly<
      Record<
        string,
        { readonly kind: "idle" } | { readonly kind: "busy" } | { readonly kind: "failed" }
      >
    >
  >({});
  const [availabilityState, setAvailabilityState] = useState<ActionState>({ kind: "idle" });
  const [rows, setRows] = useState<Readonly<Record<string, ActionState>>>({});
  const [refresh, setRefresh] = useState<BoardRefreshState>({ kind: "idle" });

  // مرجعٌ للحالةِ الحاليّةِ — يُقرأُ في تحديثِ الـ realtimeِ دونَ أن يُدخِلَ الحالةَ
  // في تبعيّاتِ الدالّةِ المُستدعاةِ (التي تُسبِّبُ إعادةَ رسمٍ غيرَ ضروريٍّ).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * `LOAD-01 Recovery` — إيصالُ اللوحِ المطبَّقِ: يُرسَلُ **بعدَ** ضبطِ الحالةِ
   * (التطبيقِ) لا قبلهُ، وفشلُهُ صامتٌ — الإيصالُ تراكميٌّ يلحقُهُ التحديثُ
   * التالي، لا مُعوِّقٌ للعرضِ.
   */
  const ackAppliedBoard = useCallback(
    (board: DriverOffersResponse) => {
      const ids = board.offers.map((offer) => offer.offer_id);
      if (ids.length === 0) return;
      void ackBoard(ids).catch(() => undefined);
    },
    [ackBoard],
  );

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    // `ADR 0286` — القسمُ مستقلٌّ: فشلُهُ لا يسقطُ اللوحَ.
    if (readNegotiations !== undefined) {
      void readNegotiations()
        .then((read) => setNegotiations({ kind: "ready", items: read.negotiations }))
        .catch(() => setNegotiations({ kind: "failed" }));
    } else {
      setNegotiations({ kind: "hidden" });
    }
    try {
      const board = await readBoard();
      // **الترتيبُ مقصودٌ**: القراءةُ تُسجَّلُ بعدَ وصولِ الجوابِ لا قبلَ إرسالِه،
      // فزمنُ الشبكةِ لا يُحسَبُ من مهلةِ العرضِ مرّتَينِ.
      const readAtMs = now();
      setState({ kind: "ready", board, readAtMs });
      ackAppliedBoard(board);
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [ackAppliedBoard, now, readBoard, readNegotiations]);

  /** تحديثٌ من realtime — لا يمسحُ القائمةَ الحاليّةَ عند الفشلِ. */
  const refreshFromRealtime = useCallback(async () => {
    try {
      const board = await readBoard();
      setState({ kind: "ready", board, readAtMs: now() });
      ackAppliedBoard(board);
    } catch {
      const current = stateRef.current;
      if (current.kind === "ready") {
        setState({ ...current, stale: true });
      }
    }
  }, [ackAppliedBoard, now, readBoard]);

  /**
   * `WR-16A` — «حدّث اللوح» جلبٌ فعليٌّ من الخادم: اللوحُ المعروضُ يبقى أثناءَه، والفشلُ يُقالُ
   * بسببِه (انقطاعٌ أو عطل) ولا يمسحُ ما يراه السائق، والنجاحُ يُقالُ.
   */
  const refreshBoard = useCallback(async () => {
    if (stateRef.current.kind !== "ready") {
      setRefresh({ kind: "idle" });
      await load();
      return;
    }
    setRefresh({ kind: "busy" });
    try {
      const board = await readBoard();
      setState({ kind: "ready", board, readAtMs: now() });
      ackAppliedBoard(board);
      setRefresh({ kind: "done" });
    } catch (thrown) {
      const current = stateRef.current;
      if (current.kind === "ready") setState({ ...current, stale: true });
      setRefresh({ kind: "failed", code: codeOf(thrown) });
    }
  }, [ackAppliedBoard, load, now, readBoard]);

  useEffect(() => {
    void load();
  }, [load]);

  // `DEC-32` — اشتراكُ تحديثِ العروضِ الآنيِّ: إن وُجِدَ المنفذُ، يُجدِّدُ القائمةَ
  // عند كلِّ إشارةٍ. والتحديثُ يُستدعى بـ`refreshFromRealtime` لا بـ`load` —
  // ففشلُ القراءةِ لا يمسحُ القائمةَ الحاليّةَ بل يُعلِّمُها قديمةً.
  useEffect(() => {
    if (subscribeToOfferUpdates === undefined) return;
    const unsubscribe = subscribeToOfferUpdates(() => void refreshFromRealtime());
    return unsubscribe;
  }, [subscribeToOfferUpdates, refreshFromRealtime]);

  const handleAvailability = useCallback(
    async (next: boolean) => {
      setAvailabilityState({ kind: "busy" });
      try {
        await setAvailability(next);
        setAvailabilityState({ kind: "idle" });
        await load();
      } catch (thrown) {
        setAvailabilityState({ kind: "failed", key: offersErrorKey(codeOf(thrown)) });
      }
    },
    [load, setAvailability],
  );

  /**
   * `ADR 0286` — مطالبةٌ في دورةِ قروبٍ من التطبيقِ: المنفذُ الذرّيُّ نفسُهُ، والنتيجةُ
   * تُقالُ كما ردَّتها القاعدةُ (ممتلئٌ · مدينةٌ أخرى · …) لا تُفسَّرُ هنا.
   */
  const handleClaimNegotiation = useCallback(
    async (negotiationId: string) => {
      if (claimNegotiation === undefined) return;
      setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "busy" } }));
      try {
        await claimNegotiation(negotiationId);
        const read = await readNegotiations();
        setNegotiations({ kind: "ready", items: read.negotiations });
        setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "idle" } }));
      } catch {
        setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "failed" } }));
      }
    },
    [claimNegotiation, readNegotiations],
  );

  const handleLeaveNegotiation = useCallback(
    async (negotiationId: string) => {
      if (leaveNegotiation === undefined) return;
      setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "busy" } }));
      try {
        await leaveNegotiation(negotiationId);
        const read = await readNegotiations();
        setNegotiations({ kind: "ready", items: read.negotiations });
        setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "idle" } }));
      } catch {
        setNegotiationRows((current) => ({ ...current, [negotiationId]: { kind: "failed" } }));
      }
    },
    [leaveNegotiation, readNegotiations],
  );

  const handleReject = useCallback(
    async (offerId: string) => {
      setRows((current) => ({ ...current, [offerId]: { kind: "busy" } }));
      try {
        await reject(offerId);
        setRows((current) => ({ ...current, [offerId]: { kind: "idle" } }));
        await load();
      } catch (thrown) {
        setRows((current) => ({
          ...current,
          [offerId]: { kind: "failed", key: offersErrorKey(codeOf(thrown)) },
        }));
      }
    },
    [load, reject],
  );

  if (state.kind === "loading") {
    return (
      <section
        className="dof"
        aria-labelledby={showTitle ? `${formId}-title` : undefined}
        aria-busy="true"
      >
        {showTitle ? (
          <h1 id={`${formId}-title`} className="dof__title">
            {t("driver.offers.title")}
          </h1>
        ) : null}
        <p className="dof__loading">{t("driver.offers.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dof" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
        {showTitle ? (
          <h1 id={`${formId}-title`} className="dof__title">
            {t("driver.offers.title")}
          </h1>
        ) : null}
        <EmptyState title={t("driver.offers.failed")} body={t(offersErrorKey(state.code))} />
        {isRetryableOffersError(state.code) ? (
          <button type="button" className="dof__retry" onClick={() => void load()}>
            {t("driver.offers.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dof__back" onClick={onBack}>
            {t("driver.offers.back")}
          </button>
        )}
      </section>
    );
  }

  const board = toOffersBoard(state.board);
  // **الباقي يُقرأُ لحظةَ الرسمِ** لا بعقربٍ يدقُّ: `F1-07` و`ADR 0035` §٤
  // يمنعانِ كلَّ مؤقّتٍ دوريٍّ في التطبيقِ المصغَّرِ، ويحرسُهما
  // `scripts/check-system-screens-policy.ts`. والفارقُ محليٌّ بينَ قراءتَينِ من
  // ساعةٍ واحدةٍ فتُلغى إزاحتُها، والتحديثُ بفعلِ السائقِ بزرِّ «حدِّثِ اللوحَ».
  const elapsedMs = now() - state.readAtMs;

  return (
    <section className="dof" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
      {showTitle ? (
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.title")}
        </h1>
      ) : null}
      <p className="dof__headline">{t(board.headlineKey)}</p>

      <div
        className={`dof__availability${
          board.isReady
            ? " dof__availability--on"
            : board.isAvailable
              ? " dof__availability--attention"
              : ""
        }`}
      >
        <span className="dof__availability-dot" aria-hidden="true">
          <Glyph name="power" />
        </span>
        <span className="dof__availability-state">
          {board.isAvailable
            ? t("driver.offers.availability.on")
            : t("driver.offers.availability.off")}
        </span>
        <button
          type="button"
          className="dof__availability-toggle"
          disabled={availabilityState.kind === "busy"}
          onClick={() => void handleAvailability(!board.isAvailable)}
        >
          {board.isAvailable
            ? t("driver.offers.availability.goOffline")
            : t("driver.offers.availability.goOnline")}
        </button>
      </div>
      {availabilityState.kind === "failed" ? (
        <p className="dof__error" role="status">
          {t(availabilityState.key)}
        </p>
      ) : null}

      {board.blockLines.length === 0 ? null : (
        <ul className="dof__blocks" aria-label={t("driver.documents.blocksLabel")}>
          {board.blockLines.map((line) => (
            <li className="dof__block" key={line.id}>
              {line.labelKey === null ? "" : `${t(line.labelKey)}: `}
              {t(line.messageKey)}
              {line.fixLabelKey === null ||
              line.docType === null ||
              onOpenDocuments === undefined ? null : (
                <button
                  type="button"
                  className="dof__block-fix"
                  onClick={() => {
                    if (line.docType !== null) onOpenDocuments(line.docType);
                  }}
                >
                  {t(line.fixLabelKey)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {negotiations.kind === "ready" && negotiations.items.length > 0 ? (
        <section className="dof__negotiations" aria-label={t("driver.offers.negotiations.title")}>
          <h2 className="dof__negotiations-title">{t("driver.offers.negotiations.title")}</h2>
          <ul className="dof__negotiations-list">
            {negotiations.items.map((item) => {
              const row = negotiationRows[item.negotiationId] ?? { kind: "idle" };
              return (
                <li className="dof__negotiations-item" key={item.negotiationId}>
                  <span className="dof__service">{t(`driver.offers.service.${item.service}`)}</span>
                  <p className="dof__place">
                    {t("driver.offers.pickup")}:{" "}
                    {item.pickupLabel ?? t("driver.offers.place.unnamed")}
                  </p>
                  <p className="dof__place">
                    {t("driver.offers.dropoff")}:{" "}
                    {item.dropoffLabel ?? t("driver.offers.place.none")}
                  </p>
                  {item.myPosition === null ? (
                    <button
                      type="button"
                      className="dof__open"
                      disabled={row.kind === "busy"}
                      onClick={() => void handleClaimNegotiation(item.negotiationId)}
                    >
                      {t("driver.offers.negotiations.claim")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dof__reject"
                      disabled={row.kind === "busy"}
                      onClick={() => void handleLeaveNegotiation(item.negotiationId)}
                    >
                      {t("driver.offers.negotiations.leave")}
                    </button>
                  )}
                  {row.kind === "failed" ? (
                    <p className="dof__error" role="status">
                      {t("driver.offers.negotiations.failed")}
                    </p>
                  ) : null}
                  {row.kind === "idle" && item.myPosition !== null ? (
                    <p className="dof__notes">
                      {t("driver.offers.negotiations.position").replace(
                        "{position}",
                        String(item.myPosition),
                      )}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {board.cards.length === 0 ? (
        <EmptyState title={t("driver.offers.empty.title")} body={t("driver.offers.empty.body")} />
      ) : (
        <ul className="dof__list">
          {board.cards.map((card: OfferCardModel) => {
            const secondsRemaining = countdownSeconds({
              secondsLeftAtRead: card.secondsLeftAtRead,
              elapsedMs,
            });
            // النغمةُ تُقرأُ من الجدولِ **قبلَ** العرضِ كي يكونَ الإحلالُ
            // `badge.modifier` — تعبيراً يُحَلُّ ساكناً لحاجزِ الأنماطِ (القاعدة ٣).
            const tone = serviceTone(card.service);
            const timer = offerTimerProps({
              secondsRemaining,
              secondsLeftAtRead: card.secondsLeftAtRead,
              t,
            });
            const row = rows[card.offerId] ?? { kind: "idle" };
            const open = canAcceptNow({ isClaimable: true, secondsRemaining });
            return (
              <li className={`dof__item ${tone.modifier}`} key={card.offerId}>
                <div className="dof__item-head">
                  <span className="dof__service">{t(card.serviceKey)}</span>
                </div>
                <UiTimer {...timer} />
                {/* `WR-05` — معنى المبلغِ قبلَ القبول: محدَّدٌ أو مقترَحٌ أو بلا سعر. */}
                <p className="dof__offer-terms">{pickupAtText(t, card.pickupAt)}</p>
                {card.offerTerms === null ? null : (
                  <p className="dof__offer-terms">{offerLineText(t, card.offerTerms)}</p>
                )}

                <p className="dof__place">
                  {t("driver.offers.pickup")}:{" "}
                  {card.pickupLabel ?? t("driver.offers.place.unnamed")}
                </p>
                {card.pickupNotes === null ? null : (
                  <p className="dof__notes">
                    {t("driver.offers.place.notes")}: {card.pickupNotes}
                  </p>
                )}
                <p className="dof__place">
                  {t("driver.offers.dropoff")}: {card.dropoffLabel ?? t("driver.offers.place.none")}
                </p>
                {card.dropoffNotes === null ? null : (
                  <p className="dof__notes">
                    {t("driver.offers.place.notes")}: {card.dropoffNotes}
                  </p>
                )}

                <DistanceRow
                  line={card.riderDistance}
                  labelKey="driver.offers.riderDistance"
                  t={t}
                />
                <DistanceRow line={card.tripDistance} labelKey="driver.offers.tripDistance" t={t} />

                <div className="dof__actions">
                  {open && onOpenOffer !== undefined ? (
                    <button
                      type="button"
                      className="dof__open"
                      onClick={() => onOpenOffer(card.offerId)}
                    >
                      {t("driver.offers.open")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="dof__reject"
                    disabled={row.kind === "busy"}
                    onClick={() => void handleReject(card.offerId)}
                  >
                    {t("driver.offers.reject")}
                  </button>
                </div>
                {row.kind === "failed" ? (
                  <p className="dof__error" role="status">
                    {t(row.key)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="dof__refresh"
        disabled={refresh.kind === "busy"}
        aria-busy={refresh.kind === "busy"}
        onClick={() => void refreshBoard()}
      >
        <Glyph name="refresh" className="dof__refresh-icon" />
        {t("driver.offers.refresh")}
      </button>
      {(() => {
        const notice = boardRefreshNotice(refresh, state.stale === true);
        return notice === null ? null : (
          <p className="dof__refresh-note" role={notice.role}>
            {t(notice.key)}
          </p>
        );
      })()}

      {/* `UX-V2`: أبوابُ الشاشةِ قائمةٌ واحدةٌ — كلُّ صفٍّ يُرسَمُ إن كانَ له مستقبِلٌ فحسب. */}
      <nav className="dof__links" aria-label={t("driver.tabs.navigation")}>
        {onOpenJob === undefined ? null : (
          <button type="button" className="dof__job" onClick={onOpenJob}>
            <span className="dof__link-icon">
              <Glyph name="job" />
            </span>
            <span className="dof__link-label">{t("driver.offers.openJob")}</span>
            <IconChevron className="dof__link-chevron" />
          </button>
        )}

        {onOpenActivity === undefined ? null : (
          <button type="button" className="dof__activity" onClick={onOpenActivity}>
            <span className="dof__link-icon">
              <Glyph name="earnings" />
            </span>
            <span className="dof__link-label">{t("driver.offers.openActivity")}</span>
            <IconChevron className="dof__link-chevron" />
          </button>
        )}

        {onOpenSubscription === undefined ? null : (
          <button type="button" className="dof__subscription" onClick={onOpenSubscription}>
            <span className="dof__link-icon">
              <Glyph name="card" />
            </span>
            <span className="dof__link-label">{t("driver.offers.openSubscription")}</span>
            <IconChevron className="dof__link-chevron" />
          </button>
        )}

        {onOpenSupport === undefined ? null : (
          <button type="button" className="dof__support" onClick={onOpenSupport}>
            <span className="dof__link-icon">
              <Glyph name="support" />
            </span>
            <span className="dof__link-label">{t("driver.offers.openSupport")}</span>
            <IconChevron className="dof__link-chevron" />
          </button>
        )}

        {onOpenAccount === undefined ? null : (
          <button type="button" className="dof__account" onClick={onOpenAccount}>
            <span className="dof__link-icon">
              <Glyph name="account" />
            </span>
            <span className="dof__link-label">{t("driver.offers.openAccount")}</span>
            <IconChevron className="dof__link-chevron" />
          </button>
        )}
      </nav>

      <ul className="dof__debt" aria-label={t("driver.offers.debtLabel")}>
        {DECLARED_DEBT.map((key) => (
          <li className="dof__debt-item" key={key}>
            {t(key)}
          </li>
        ))}
      </ul>

      {onBack === undefined ? null : (
        <button type="button" className="dof__back" onClick={onBack}>
          {t("driver.offers.back")}
        </button>
      )}
    </section>
  );
}
