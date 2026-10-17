/**
 * محوّلُ صندوقِ الصادرِ الموحَّدِ إلى RPCs الذرّيّة (BUG-004). كلُّ تغيّرِ حالةٍ يبقى
 * في PostgreSQL: claim بـFOR UPDATE SKIP LOCKED + claim_token، وfinish بالرمزِ لا
 * بالصفّ، وabandon بالرمزِ كذلك. المحوّلُ لا يعرفُ نوعًا بعينِه: يمرّرُ kind والحمولةَ
 * كما بنتهما القاعدةُ إلى معالجِ النوعِ. مرآةٌ لـcreateSafetyDeliveryPort في البنية،
 * تزيدُ عليها abandon.
 */
import type {
  FinishOutcome,
  NotificationOutboxPort,
  OutboxDelivery,
} from "../../application/notification/deliver-notification.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql, withRequestContext } from "../db/client.ts";
import { readCorrelationId } from "../observability/correlation.ts";

const FINISH_OUTCOMES: readonly string[] = ["delivered", "dead", "retried"];

/**
 * مآلُ القاعدةِ يُقرأُ كما هو لا كما يُشتهى: نصٌّ غيرُ معروفٍ يعودُ `null` فلا
 * يُحسبَ موتاً ولا تسليماً بالغلطِ. (CAP-002)
 */
function finishOutcome(value: unknown): FinishOutcome | null {
  const text = typeof value === "string" ? value : null;
  return text !== null && FINISH_OUTCOMES.includes(text) ? (text as FinishOutcome) : null;
}

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

export function createNotificationOutboxPort(sql: Sql): NotificationOutboxPort {
  return {
    claim: () =>
      guard("rpc.claim_notification_delivery", async () => {
        const rows = await sql<{ result: unknown }[]>`select claim_notification_delivery() result`;
        const row = envelope(rows[0]?.result, "claim_notification_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const delivery = row.delivery as Record<string, unknown> | null;
        if (delivery == null) {
          // `SEC-19-ب-٣` — صفٌّ عُذِرَ تسليمُه في القاعدةِ: العنوانُ غائبٌ فلا
          // يُحاوَلُ إرسالُه. ويُمَرَّرُ للعدِّ فيُكملُ الشوطَ لا يُنهيهِ.
          const undeliverableId = row.undeliverable;
          if (undeliverableId != null) {
            return {
              delivery: null,
              undeliverable: {
                deliveryId: String(undeliverableId),
                kind: String(row.kind),
                reason: String(row.reason),
                batchLimit: Number(row.batch_limit),
              },
              backpressure: null,
            };
          }
          // لا صفَّ: إمّا الطابورُ فارغٌ، وإمّا سقفُ تزامنِ المستهلِكِ منعَ الالتقاطَ
          // (`F6-06`). ويُقرأُ السببُ كما أعلنَته القاعدةُ لا كما يُشتهى: نصٌّ غيرُ
          // معروفٍ يعودُ `null` فلا يُحسبَ تشبُّعاً بالغلطِ.
          const reason = row.backpressure;
          return {
            delivery: null,
            backpressure: reason === "CONSUMER_CONCURRENCY" ? "CONSUMER_CONCURRENCY" : null,
          };
        }
        const payload = delivery.payload;

        // معرِّفُ الطلبِ الذي أنشأَ الصفَّ (`F8-01`) يُقرأُ بقراءةٍ ثانيةٍ بالمفتاحِ
        // الأوّليِّ **لا بتعديلِ `claim_notification_delivery`**: تلكَ دالّةٌ ذرّيّةٌ
        // حاكمةٌ (`FOR UPDATE SKIP LOCKED` · ضغطٌ عكسيٌّ · أولويّةُ مرورٍ) يُعادُ
        // تعريفُها بجسمِها كلِّه في أيِّ هجرةٍ تمسُّها، فنسخُ مائةٍ وخمسينَ سطراً
        // لأجلِ حقلِ مراقبةٍ يُنشئُ مصدرَ حقيقةٍ ثانياً للالتقاطِ — والقاعدةُ 0.6
        // تمنعُ ذلك. والقراءةُ ههنا **بعدَ** الالتقاطِ فالصفُّ مملوكٌ برمزِ الحجزِ،
        // فلا تسابُقَ. وفشلُها لا يُخفى: `guard` يردُّه عطباً كسائرِ الاستعلامِ.
        const correlationRows = await sql<{ request_id: string | null }[]>`
          select request_id from notification_outbox where id = ${String(delivery.delivery_id)}::uuid
        `;

        return {
          delivery: {
            deliveryId: String(delivery.delivery_id),
            kind: String(delivery.kind),
            cityId: String(delivery.city_id) as CityId,
            claimToken: String(delivery.claim_token),
            attempts: Number(delivery.attempts),
            maxAttempts: Number(delivery.max_attempts),
            // `LOAD-01 Recovery` — عدّادُ انتظارِ إشارةِ اللوحِ (اختياريٌّ:
            // الصفوفُ القديمةُ قبلهُ = صفرٌ).
            signalWaitCount: Number(delivery.signal_wait_count ?? 0),
            batchLimit: Number(delivery.batch_limit),
            // معرِّفُ الطلبِ الذي أنشأَ الصفَّ (`F8-01`): تكتبُه مُشغِّلاتُ القاعدةِ
            // عندَ الإدراجِ، ويُعادُ ههنا **كما هوَ في الصفِّ** فيستعيدُ العاملُ
            // سلسلةَ الارتباطِ. ونصٌّ غيرُ صالحٍ أو غيابٌ يعودُ `null` لا مولَّداً.
            requestId: readCorrelationId(correlationRows[0]?.request_id),
            payload:
              typeof payload === "object" && payload !== null
                ? (payload as Record<string, unknown>)
                : {},
          } satisfies OutboxDelivery,
        };
      }),
    // `LOAD-01 Recovery` — تسليمٌ عبرَ اللوحِ بإيصالٍ، وعودةٌ بانتظارِ الإشارةِ:
    // الرمزانِ الحارسانِ كما في أخواتِهما — لا عملَ إلا على صفٍّ `sending`
    // يحملُ الرمزَ نفسَهُ.
    finishViaBoard: (input) =>
      guard("rpc.finish_notification_delivery_via_board", async () => {
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<{ result: unknown }[]>`select finish_notification_delivery_via_board(
              ${input.deliveryId}::uuid, ${input.claimToken}::uuid) result`,
        );
        const row = envelope(rows[0]?.result, "finish_notification_delivery_via_board");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    requeueSignalWait: (input) =>
      guard("rpc.requeue_notification_delivery_signal_wait", async () => {
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<{ result: unknown }[]>`select requeue_notification_delivery_signal_wait(
              ${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.retryAfterMs}::integer) result`,
        );
        const row = envelope(rows[0]?.result, "requeue_notification_delivery_signal_wait");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    finish: (input) =>
      guard("rpc.finish_notification_delivery", async () => {
        // `F8-01` — موضعٌ موصولٌ مُعلَنٌ: إعلانُ نتيجةِ التسليمِ يجري في معاملةٍ
        // مضبوطةٍ بمعرِّفِ الطلبِ الذي أنشأَ الصفَّ (استعادَه العاملُ من الصفِّ)،
        // فأثرُ الإرسالِ في القاعدةِ يُقرأُ بمعرِّفِ الطلبِ نفسِه لا بمعرِّفٍ آخرَ.
        const rows = await withRequestContext(
          sql,
          (tx) =>
            tx<
              { result: unknown }[]
            >`select finish_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.messageId}::text, ${input.messageId !== null}, ${input.error}::text) result`,
        );
        const row = envelope(rows[0]?.result, "finish_notification_delivery");
        return { ok: row.ok === true, outcome: finishOutcome(row.outcome) };
      }),
    abandon: (input) =>
      guard("rpc.abandon_notification_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select abandon_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.reason}::text) result`;
        const row = envelope(rows[0]?.result, "abandon_notification_delivery");
        return row.ok === true;
      }),
    requeue: (input) =>
      guard("rpc.requeue_notification_delivery", async () => {
        // `D8` — إعادةُ ازدحامٍ: موعدُ الفتحةِ من المُرسِلِ، مسقوفٌ بدقيقةٍ حتى لا
        // يعلَقَ صفٌّ أبدًا بموعدٍ بعيدٍ من تقديرٍ شاذٍّ.
        const retryAfterMs = Math.min(Math.max(0, Math.floor(input.retryAfterMs)), 60_000);
        const rows = await sql<
          { result: unknown }[]
        >`select requeue_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${retryAfterMs}::integer) result`;
        const row = envelope(rows[0]?.result, "requeue_notification_delivery");
        return row.ok === true;
      }),
    undeliverable: (input) =>
      guard("rpc.mark_notification_undeliverable", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select mark_notification_undeliverable(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.reason}::text) result`;
        const row = envelope(rows[0]?.result, "mark_notification_undeliverable");
        return row.ok === true;
      }),
  };
}
