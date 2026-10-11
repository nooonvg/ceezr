/**
 * الغرض: شاشةُ مَهمّةِ السائقِ النشطةِ — **زرٌّ واحدٌ للطَورِ الواحدِ** ورابطُ
 *   ملاحةٍ وراكبٌ بلا هويّةٍ تُتعقَّبُ (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — بعدَ الإنهاءِ يُقالُ سطرٌ، والحصيلةُ شاشةٌ
 *   أخرى تُقرأُ من مسارِها.
 * يحرسُه: scripts/check-driver-job-contract.ts
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ زرٌّ واحدٌ ظاهرٌ في كلِّ لحظةٍ
 *
 * لأنَّ السائقَ يقرأُ هذه الشاشةَ **وهوَ يقودُ**: ثلاثةُ أزرارٍ معروضةٍ معاً
 * تُنتِجُ ضغطةً خاطئةً تُردُّ `PHASE_MISMATCH` فتُقرأُ عطلاً، وتُنتِجُ أسوأَ من
 * ذاكَ — إنهاءَ رحلةٍ لم تبدأْ. والخادمُ يقولُ **ما يُفعَلُ الآنَ** فيُعرَضُ.
 *
 * ## ولِمَ لا مؤقّتَ ولا عدَّ تصاعديّاً في هذه الشاشةِ
 *
 * مهلةُ العرضِ (`F3-02`) حكمُ صلاحيّةٍ يُلغي فرصةً، فوجبَ عدُّها. أمّا المَهمّةُ
 * فلا مهلةَ لها: رحلةٌ تطولُ لا تُلغى بمرورِ ثانيةٍ، وعقربٌ يدقُّ على شاشةِ
 * سائقٍ يُصنَعُ ضغطاً كاذباً ويُستهلَكُ بطاريّةً بلا فائدةٍ. والأختامُ تُقالُ نصّاً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُلغي رحلةً**: لا مسارَ إلغاءٍ للسائقِ ههنا، وسياستُه مُجمَّدةٌ
 *      بقرارٍ (`F2-06`) — وزرٌّ بلا كاتبٍ خيانةُ عرضٍ.
 *   ــ **لا تتّصلُ براكبٍ ولا تُراسِلُه**: العقدُ لا يحملُ هاتفاً ولا معرِّفاً.
 *   ــ **لا تُظهِرُ زرَّ نجدةٍ**: الدَّينُ المُعلَنُ مُنشَطٌ —
 *      زرُّ الاستغاثةِ في `JobScreen.tsx` يستدعي `POST /v1/driver/safety/sos`
 *      (F12-22 · DEC-29 · ADR 0226).
 *   ــ **لا تبثُّ موضعاً**: البثُّ بندُ `F3-04`، ولا يُشتَقُّ طَورٌ من قُربٍ.
 *   ــ **لا تُبقي حالاً بعدَ رفضٍ يعني تقادُماً**: تُعيدُ القراءةَ من القاعدةِ.
 *
 * ## إضافةُ البندِ `PD-020` (2026-09-20)
 *
 * صارَ للشاشةِ **قسمُ «تعذّرَ الإكمالُ»**: تأكيدٌ بخطوتَينِ يُبلِّغُ فريقَ
 * الإسنادِ بلاغَ سلامةٍ بسببِ `driver_cannot_complete` — **ولا يُغيِّرُ حالةَ
 * الرحلةِ ألبتّةَ** ولا يوقفُها ولا يُنهيها: الفريقُ يقرَّرُ. وما كانَ مكتوباً
 * أعلاه من أنَّ نجدةَ السائقِ **دَينٌ مُعلَنٌ** **باقٍ وصفاً لِما كانَ**: ذاكَ
 * كانَ لأنَّ مسارَ `F2-10` يُركِّبُ الدورَ راكباً حرفاً، وقد صارَ للسائقِ
 * حاكمُهُ بدورِهِ (`GET /v1/driver/safety/sos`) بلا تركيبِ دورٍ في الشاشةِ.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { Glyph } from "../../../system/ui/icons.tsx";
import { openExternalLink } from "../../../tg/index.ts";
import { OrderChat } from "../../chat/OrderChat.tsx";
import type { SosSurfaceResponse, SosTriggerResponse } from "../../rider/sos/sos-contract.ts";
import {
  completeDriverRide,
  type DriverActiveJobResponse,
  type DriverCannotCompleteResponse,
  markDriverArrived,
  readDriverActiveJob,
  readDriverSafetyNarrative,
  reportDriverCannotComplete,
  startDriverRide,
  triggerDriverSos,
} from "./job-api.ts";
import type { ApiDriverJobAction } from "./job-contract.ts";
import {
  type ActiveJobModel,
  cannotCompleteNarrativeKey,
  cannotCompleteRefusalKey,
  isRetryableJobError,
  jobErrorKey,
  riderLanguageText,
  shouldReloadAfterJobError,
  stampAgeMinutes,
  toActiveJob,
} from "./job-view.ts";

export interface JobScreenProps {
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /** `UI-4`: حينَ يرسمُ `ScreenFrame` العنوانَ (H1) لا يُكرَّرُ ههنا. الافتراضُ `true`. */
  readonly showTitle?: boolean;
  readonly readJob?: () => Promise<DriverActiveJobResponse>;
  readonly arrive?: (orderId: string) => Promise<unknown>;
  readonly start?: (orderId: string) => Promise<unknown>;
  readonly complete?: (orderId: string) => Promise<unknown>;
  /**
   * فعلُ «تعذّرَ الإكمالُ» (`PD-020`) — بلاغُ سلامةٍ لا تغييرُ حالةٍ، يُحقَنُ
   * في الاختبارِ ولا يُخترَعُ جوابُهُ.
   */
  readonly reportCannotComplete?: (orderId: string) => Promise<DriverCannotCompleteResponse>;
  /** قراءةُ سردِ البلاغِ القائمِ (`PD-020`) — من القاعدةِ لا من ذاكرةِ شاشةٍ. */
  readonly readSafetyNarrative?: () => Promise<SosSurfaceResponse>;
  /** إطلاقُ استغاثةِ السائقِ (`F12-22` · DEC-29) — يُحقَنُ للاختبارِ. */
  readonly triggerSos?: () => Promise<SosTriggerResponse>;
  readonly openLink?: (url: string) => unknown;
  /** يُستدعى عند إتمامِ الرحلةِ لفتحِ شاشةِ الملخصِّ (`F12-05`). */
  readonly onCompleted?: (orderId: string) => void;
}

type JobState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly job: ActiveJobModel | null;
      /** لحظةُ الخادمِ وقتَ القراءةِ — أعمارُ الأختامِ تُحسَبُ منها لا من ساعةِ الجهاز. */
      readonly serverTime: string;
    }
  | { readonly kind: "failed"; readonly code: string };

type ActState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly key: string; readonly completedOrderId: string | undefined }
  | { readonly kind: "failed"; readonly key: string };

/**
 * `PD-020` — حالةُ قسمِ «تعذّرَ الإكمالُ». والخطوةُ الثانيةُ تُطفَأُ بعدَ كلِّ
 * إرسالٍ فلا تبقى مُسلَّحةً في خلفيّةِ شاشةِ قيادةٍ.
 */
type CannotState =
  | { readonly kind: "idle" }
  | { readonly kind: "armed" }
  | { readonly kind: "busy" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "failed" }
  | { readonly kind: "sent" };

/** البلاغُ القائمُ — حقلا سردٍ فحسب: الحكمُ كلُّهُ في القاعدةِ. */
type IncidentState = {
  readonly status: string;
  readonly teamDeliveryStatus: string;
} | null;

/** حالةُ زرِّ الاستغاثةِ (`DEC-29`). */
type SosState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "sent"; readonly created: boolean }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "failed" };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

const DONE_KEY: Readonly<Record<ApiDriverJobAction, string>> = {
  MARK_ARRIVED: "driver.job.done.MARK_ARRIVED",
  START_RIDE: "driver.job.done.START_RIDE",
  COMPLETE_RIDE: "driver.job.done.COMPLETE_RIDE",
};

function StampRow({
  labelKey,
  value,
  serverTime,
  t,
}: {
  readonly labelKey: string;
  readonly value: string | null;
  readonly serverTime: string;
  readonly t: (key: string) => string;
}) {
  // لوحة 06 (D3): لا يُعرَضُ ختمُ ISO خامٌّ. العمرُ يُقاسُ من لحظةِ الخادمِ نفسِها، وما لا يُقاسُ
  // (ختمٌ معطوبٌ أو في المستقبلِ) يُقالُ «لم يُسجَّل» ولا يُخترَعُ له عمر.
  const age = value === null ? null : stampAgeMinutes(value, serverTime);
  return (
    <p className={age === null ? "djb__stamp djb__stamp--absent" : "djb__stamp"}>
      {t(labelKey)}:{" "}
      {age === null ? (
        t("driver.job.stamp.none")
      ) : (
        <time dateTime={value ?? undefined}>
          {age === 0
            ? t("driver.job.stamp.justNow")
            : t("driver.job.stamp.ago").replace("{minutes}", String(age))}
        </time>
      )}
    </p>
  );
}

export function JobScreen({
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  showTitle = true,
  onCompleted,
  readJob = readDriverActiveJob,
  arrive = markDriverArrived,
  start = startDriverRide,
  complete = completeDriverRide,
  reportCannotComplete = reportDriverCannotComplete,
  readSafetyNarrative = readDriverSafetyNarrative,
  triggerSos = triggerDriverSos,
  openLink = (url: string) => openExternalLink(url),
}: JobScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<JobState>({ kind: "loading" });
  const [act, setAct] = useState<ActState>({ kind: "idle" });
  const [cannot, setCannot] = useState<CannotState>({ kind: "idle" });
  const [incident, setIncident] = useState<IncidentState>(null);
  const [sos, setSos] = useState<SosState>({ kind: "idle" });

  /**
   * سردُ البلاغِ القائمِ (`PD-020`) — يُقرأُ **من القاعدةِ** في كلِّ تركيبٍ
   * وبعدَ كلِّ إرسالٍ، فلا تُخمِّنُ الشاشةُ ما صارَ. وفشلُ قراءتِهِ لا يُخفي
   * القسمَ ولا يوقفُ الفعلَ: السردُ سياقٌ يُقالُ، والفعلُ بابُهُ مفتوحٌ.
   */
  const refreshNarrative = useCallback(async () => {
    try {
      const response = await readSafetyNarrative();
      const i = response.found ? (response.incident ?? null) : null;
      setIncident(
        i === null ? null : { status: i.status, teamDeliveryStatus: i.teamDeliveryStatus },
      );
    } catch {
      setIncident(null);
    }
  }, [readSafetyNarrative]);

  const sendCannot = useCallback(
    async (orderId: string) => {
      setCannot({ kind: "busy" });
      try {
        const response = await reportCannotComplete(orderId);
        if (response.accepted) {
          // «بلاغُكَ الأوّلُ قائمٌ» نجاحٌ لا فشلٌ — والسردُ يُقرأُ بعدها من القاعدةِ.
          setCannot({ kind: "sent" });
          await refreshNarrative();
        } else {
          setCannot({ kind: "refused", refusal: response.refusal });
        }
      } catch {
        setCannot({ kind: "failed" });
      }
    },
    [refreshNarrative, reportCannotComplete],
  );

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await readJob();
      const job = response.job === null ? null : toActiveJob(response.job);
      setState({ kind: "ready", job, serverTime: response.server_time });
      // `PD-020` — سردُ بلاغٍ قائمٍ يُقرأُ مع المَهمّةِ: سائقٌ عادَ إلى شاشةٍ
      // بعدَ بلاغٍ يجدُ أثرَهُ، لا شاشةً تقولُ إنَّ شيئاً لم يقعْ.
      if (job !== null) void refreshNarrative();
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [readJob, refreshNarrative]);

  const sendSos = useCallback(async () => {
    setSos({ kind: "busy" });
    try {
      const response = await triggerSos();
      if (response.ok && response.accepted) {
        setSos({ kind: "sent", created: response.created });
      } else if (response.ok && !response.accepted) {
        setSos({ kind: "refused", refusal: response.refusal });
      } else {
        setSos({ kind: "failed" });
      }
      void refreshNarrative();
    } catch {
      setSos({ kind: "failed" });
    }
  }, [triggerSos, refreshNarrative]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (job: ActiveJobModel) => {
      setAct({ kind: "busy" });
      const writer =
        job.action === "MARK_ARRIVED" ? arrive : job.action === "START_RIDE" ? start : complete;
      try {
        await writer(job.orderId);
        setAct({
          kind: "done",
          key: DONE_KEY[job.action],
          completedOrderId: job.action === "COMPLETE_RIDE" ? job.orderId : undefined,
        });
        // **القاعدةُ تقولُ الطَورَ التاليَ**: لا تُحرَّكُ الشاشةُ بتخمينٍ محليٍّ.
        await load();
      } catch (thrown) {
        const code = codeOf(thrown);
        setAct({ kind: "failed", key: jobErrorKey(code) });
        if (shouldReloadAfterJobError(code)) await load();
      }
    },
    [arrive, complete, load, start],
  );

  if (state.kind === "loading") {
    return (
      <section
        className="djb"
        aria-labelledby={showTitle ? `${formId}-title` : undefined}
        aria-busy="true"
      >
        {showTitle ? (
          <h1 id={`${formId}-title`} className="djb__title">
            {t("driver.job.title")}
          </h1>
        ) : null}
        <p className="djb__loading">{t("driver.job.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="djb" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
        {showTitle ? (
          <h1 id={`${formId}-title`} className="djb__title">
            {t("driver.job.title")}
          </h1>
        ) : null}
        <EmptyState title={t("driver.job.failed")} body={t(jobErrorKey(state.code))} />
        {isRetryableJobError(state.code) ? (
          <button type="button" className="djb__retry" onClick={() => void load()}>
            {t("driver.job.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const completedOrderId =
    act.kind === "done" &&
    act.key === DONE_KEY.COMPLETE_RIDE &&
    onCompleted !== undefined &&
    act.completedOrderId !== undefined
      ? act.completedOrderId
      : null;

  if (state.job === null) {
    return (
      <section className="djb" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
        {showTitle ? (
          <h1 id={`${formId}-title`} className="djb__title">
            {t("driver.job.title")}
          </h1>
        ) : null}
        {/*
          ADR 0249 (D4): بعدَ «أنهِ الرحلة» تُعيدُ القراءةُ `job: null` — فالمهمّةُ انتهت حقًّا.
          كانَ هذا الفرعُ يُسقِطُ نتيجةَ الفعلِ وزرَّ الملخّص، فلا يبلغُ السائقُ ملخّصَ رحلتِه.
          النتيجةُ تُقالُ هنا من حالِ الفعلِ نفسِه، لا من تخمين.
        */}
        {completedOrderId === null ? null : (
          <>
            <p className="djb__done" role="status">
              {t(DONE_KEY.COMPLETE_RIDE)}
            </p>
            <button
              type="button"
              className="djb__summary"
              onClick={() => onCompleted?.(completedOrderId)}
            >
              {t("driver.job.viewSummary")}
            </button>
          </>
        )}
        {/* `UX-5` — الفراغُ يُقالُ صراحةً ولا يُترَكُ بياضاً يُقرأُ عطلاً. */}
        <EmptyState title={t("driver.job.none.title")} body={t("driver.job.none.body")} />
        <button type="button" className="djb__retry" onClick={() => void load()}>
          {t("driver.job.refresh")}
        </button>
        {onBack === undefined ? null : (
          <button type="button" className="djb__back" onClick={onBack}>
            {t("driver.job.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const job = state.job;

  return (
    <section className="djb" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
      {showTitle ? (
        <h1 id={`${formId}-title`} className="djb__title">
          {t("driver.job.title")}
        </h1>
      ) : null}

      <div className="djb__hero">
        <div className="djb__head">
          <span className="djb__service">{t(job.serviceKey)}</span>
          <span className="djb__phase" role="status">
            {t(job.phaseKey)}
          </span>
        </div>

        <p className="djb__rider">
          {t("driver.job.rider")}:{" "}
          {job.riderFirstName === null || job.riderFirstName === ""
            ? t("driver.job.rider.unnamed")
            : job.riderFirstName}
          {job.riderLanguageCode === null ? null : (
            <span className="djb__rider-language">
              {" "}
              · {riderLanguageText(job.riderLanguageCode, t)}
            </span>
          )}
        </p>
      </div>

      {/* WR-04: غرفةُ المحادثةِ مع الراكبِ — على المهمّةِ نفسِها لا في شاشةٍ منفصلة. */}
      <OrderChat
        orderId={job.orderId}
        statusText={t(job.phaseKey)}
        labels={{
          title: t("driver.job.chat.title"),
          open: t("driver.job.chat.open"),
          hide: t("driver.job.chat.hide"),
          unread: t("driver.job.chat.unread"),
          placeholder: t("driver.job.chat.placeholder"),
          send: t("driver.job.chat.send"),
          sending: t("driver.job.chat.sending"),
          failed: t("driver.job.chat.failed"),
          retry: t("driver.job.chat.retry"),
          closed: t("driver.job.chat.closed"),
          empty: t("driver.job.chat.empty"),
          loadFailed: t("driver.job.chat.loadFailed"),
          unavailable: t("driver.job.chat.unavailable"),
          seen: t("driver.job.chat.seen"),
          counterpart: t("driver.job.chat.counterpart"),
          status: t("driver.job.chat.status"),
        }}
      />

      <div className="djb__stop djb__stop--pickup">
        <p className="djb__place">
          {t("driver.job.pickup")}: {job.pickup.label ?? t("driver.job.place.unnamed")}
        </p>
        <p className="djb__coords">
          {job.pickup.latitude} , {job.pickup.longitude}
        </p>
        {/* `LOC-TRUST-01`: ملاحظاتُ المكانِ ورابطُ الراكبِ الأصليُّ حرفاً، وفتحُه. */}
        {job.pickup.notes === null ? null : (
          <p className="djb__notes">
            {t("driver.job.place.notes")}: {job.pickup.notes}
          </p>
        )}
        {job.pickup.link === null ? null : (
          <p className="djb__coords">
            {t("driver.job.place.link")}: {job.pickup.link}
          </p>
        )}
        {job.pickup.openUrl === null ? null : (
          <button
            type="button"
            className="djb__navigate"
            onClick={() => openLink(job.pickup.openUrl ?? "")}
          >
            {t("driver.job.openPickup")}
          </button>
        )}
      </div>
      <div className="djb__stop djb__stop--dropoff">
        <p className="djb__place">
          {t("driver.job.dropoff")}:{" "}
          {job.dropoff === null
            ? t("driver.job.place.none")
            : (job.dropoff.label ?? t("driver.job.place.unnamed"))}
        </p>
        {job.dropoff?.notes == null ? null : (
          <p className="djb__notes">
            {t("driver.job.place.notes")}: {job.dropoff.notes}
          </p>
        )}
        {job.dropoff?.link == null ? null : (
          <p className="djb__coords">
            {t("driver.job.place.link")}: {job.dropoff.link}
          </p>
        )}
        {job.dropoff?.openUrl == null ? null : (
          <button
            type="button"
            className="djb__navigate"
            onClick={() => openLink(job.dropoff?.openUrl ?? "")}
          >
            {t("driver.job.openDropoff")}
          </button>
        )}
      </div>

      <div className="djb__facts">
        <p className="djb__notes">
          {t("driver.job.notes")}:{" "}
          {job.notes === null || job.notes === "" ? t("driver.job.noNotes") : job.notes}
        </p>

        <StampRow
          labelKey="driver.job.stamp.matchedAt"
          value={job.matchedAt}
          serverTime={state.serverTime}
          t={t}
        />
        <StampRow
          labelKey="driver.job.stamp.arrivedAt"
          value={job.arrivedAt}
          serverTime={state.serverTime}
          t={t}
        />
        <StampRow
          labelKey="driver.job.stamp.startedAt"
          value={job.startedAt}
          serverTime={state.serverTime}
          t={t}
        />
      </div>

      <div className="djb__actions">
        {/* الملاحةُ **خارجَ التطبيقِ**: رابطٌ يُنقَرُ، لا خريطةٌ تُحمَّلُ. */}
        <button
          type="button"
          className="djb__navigate"
          onClick={() => {
            openLink(job.navigateTo.navigationUrl);
          }}
        >
          <Glyph name="navigate" className="djb__navigate-icon" />
          {t("driver.job.navigate")}
        </button>
        <button
          type="button"
          className="djb__advance"
          disabled={act.kind === "busy"}
          onClick={() => void runAction(job)}
        >
          {t(job.actionLabelKey)}
        </button>
      </div>

      {/*
        قسمُ «تعذّرَ الإكمالُ» (`PD-020` · `ADR 0159`) — بلاغُ سلامةٍ لا تغييرُ
        حالةٍ: يُعرَضُ في المَهمّةِ قبلَ الإكمالِ لا في طَورٍ دونَ طَورٍ، لأنَّ
        العجزَ لا يُنتَظِرُ ختمَ وصولٍ. وتأكيدٌ بخطوتَينِ كما في استغاثةِ الراكبِ:
        بلاغٌ يُوقِظُ فريقاً لا يُرسَلُ بلمسةٍ عابرةٍ.
      */}
      <div className="djb__cannot">
        {incident !== null && (
          <p className="djb__cannot-narrative" role="status">
            {t(cannotCompleteNarrativeKey(incident.status, incident.teamDeliveryStatus))}
          </p>
        )}
        {cannot.kind === "sent" ? (
          <p className="djb__cannot-sent" role="status">
            {t("driver.job.cannotComplete.sent")}
          </p>
        ) : null}
        {cannot.kind === "refused" ? (
          <p className="djb__cannot-refusal" role="alert">
            {t(cannotCompleteRefusalKey(cannot.refusal))}
          </p>
        ) : null}
        {cannot.kind === "failed" ? (
          <p className="djb__cannot-failed" role="alert">
            {t("driver.job.cannotComplete.failed")}
          </p>
        ) : null}
        {cannot.kind === "armed" || cannot.kind === "busy" ? (
          <div className="djb__cannot-confirm">
            <p className="djb__cannot-question">{t("driver.job.cannotComplete.confirmQuestion")}</p>
            <button
              type="button"
              className="djb__cannot-send"
              disabled={cannot.kind === "busy"}
              onClick={() => void sendCannot(job.orderId)}
            >
              {t("driver.job.cannotComplete.confirmSend")}
            </button>
            <button
              type="button"
              className="djb__cannot-cancel"
              disabled={cannot.kind === "busy"}
              onClick={() => setCannot({ kind: "idle" })}
            >
              {t("driver.job.cannotComplete.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="djb__cannot-arm"
            onClick={() => setCannot({ kind: "armed" })}
          >
            {t("driver.job.cannotComplete.label")}
          </button>
        )}
      </div>

      {/*
        زرُّ الاستغاثةِ (`F12-22` · DEC-29 · ADR 0226) — مسارُ السائقِ خاصُّ بهِ
        لا يُركِّبُ دورَ الراكبِ. زرٌّ أحمرُ يُؤكِّدُ بخطوتَينِ كما في استغاثةِ
        الراكبِ: بلاغٌ يُوقِظُ فريقاً لا يُرسَلُ بلمسةٍ عابرةٍ.
      */}
      <div className="djb__sos">
        {sos.kind === "sent" ? (
          <p className="djb__sos-sent" role="status">
            {sos.created ? t("driver.job.sos.sent") : t("driver.job.sos.alreadyOpen")}
          </p>
        ) : null}
        {sos.kind === "refused" ? (
          <p className="djb__sos-refusal" role="alert">
            {t("driver.job.sos.refused")}
          </p>
        ) : null}
        {sos.kind === "failed" ? (
          <p className="djb__sos-failed" role="alert">
            {t("driver.job.sos.failed")}
          </p>
        ) : null}
        {sos.kind === "busy" ? (
          <button type="button" className="djb__sos-button djb__sos-button--busy" disabled>
            {t("driver.job.sos.sending")}
          </button>
        ) : sos.kind === "sent" ? (
          <button type="button" className="djb__sos-button" disabled>
            {t("driver.job.sos.sent")}
          </button>
        ) : (
          <button type="button" className="djb__sos-button" onClick={() => void sendSos()}>
            {t("driver.job.sos.label")}
          </button>
        )}
      </div>

      {act.kind === "done" ? (
        <p className="djb__done" role="status">
          {t(act.key)}
        </p>
      ) : null}
      {act.kind === "done" &&
      act.key === DONE_KEY.COMPLETE_RIDE &&
      onCompleted !== undefined &&
      act.completedOrderId !== undefined ? (
        <button
          type="button"
          className="djb__summary"
          onClick={() => onCompleted(act.completedOrderId as string)}
        >
          {t("driver.job.viewSummary")}
        </button>
      ) : null}
      {act.kind === "failed" ? (
        <p className="djb__error" role="status">
          {t(act.key)}
        </p>
      ) : null}

      {onBack === undefined ? null : (
        <button type="button" className="djb__back" onClick={onBack}>
          {t("driver.job.backToBoard")}
        </button>
      )}
    </section>
  );
}
