/**
 * الغرض: نشر بطاقة الطلب في قروب السائقين غير المشتركين وفتح دورة تفاوض جديدة.
 *   البطاقة تحمل نوع الخدمة والمنطقة التقريبية وزرّ «قبول» — بلا رقم هاتف العميل
 *   وبلا موقعه الدقيق (القسم 3.4، الخطوة 1). فتح الدورة نفسه ذرّي في القاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts، apps/gateway
 * ملاحظات مستقبلية: عند توفّر عناوين مقروءة (reverse geocoding) تُستبدل المنطقة التقريبية بها.
 */

import { approximateArea } from "../../domain/dispatch/negotiation.ts";
import type { CityId, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import type { OfferMode } from "../../shared/order-terms/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { OrderRepository, PortFailureError } from "../ports/index.ts";

/** دورة فُتحت فعلاً في القاعدة، بكل ما يحتاجه الناشر. */
export interface OpenedCycle {
  readonly negotiationId: string;
  readonly cycle: number;
  readonly cityId: CityId;
  readonly service: ServiceType;
  /** معرّف قروب تلغرام كنصّ — قيمته bigint سالبة، والنصّ يمنع أي فقد دقّة. */
  readonly groupId: string;
  readonly collectDeadline: Date;
  /** سائقو الدورة السابقة: يُخفى عنهم الزرّ لأن تسجيلهم سيُرفض على أي حال. */
  readonly excludedDriverIds: readonly DriverId[];
  /**
   * أأُودِعَ إخطارُ «دائرةٌ أوسعُ» لصاحبِ الطلبِ في معاملةِ فتحِ الدورةِ نفسِها؟
   * (BUG-004) يقعُ للدورةِ الأولى وحدَها، وتقولُه القاعدةُ لا هذه الطبقةُ: الإيداعُ
   * والفتحُ معاملةٌ واحدةٌ، فما تراهُ هنا هو ما التزمَ فعلاً.
   */
  readonly notificationQueued: boolean;
}

export type OpenCycleOutcome =
  | { readonly opened: true; readonly cycle: OpenedCycle }
  | { readonly opened: false; readonly reason: string };

/** منفذ الكتابة الذرّية — يقابل الدالتين open_unsubscribed_cycle و attach. */
export interface UnsubscribedCyclePort {
  openCycle(orderId: OrderId): Promise<Result<OpenCycleOutcome, PortFailureError>>;
  /** يربط معرّف رسالة القروب بالدورة بعد نجاح النشر فعلاً، لا قبله. */
  attachGroupMessage(
    negotiationId: string,
    messageId: string,
  ): Promise<Result<void, PortFailureError>>;
}

/** بيانات البطاقة كما تراها طبقة التطبيق — بلا نصّ ولا تنسيق تلغرام. */
export interface UnsubscribedCard {
  readonly groupId: string;
  readonly negotiationId: string;
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly cycle: number;
  /** منطقة تقريبية لا عنوان دقيق — قرار الخصوصية في الدومين لا هنا. */
  readonly areaLabel: string;
  readonly notes: string | null;
  readonly excludedDriverIds: readonly DriverId[];
  /** `ORDER-TERMS-01` — وقتُ حضورِ السائقِ (null ⇒ الآن). غائبٌ ⇒ لا سطرَ (مسارٌ قديمٌ). */
  readonly pickupAt?: Date | null;
  /** `ORDER-OFFER-01` — مبلغُ الراكبِ (null ⇒ قابلٌ للتفاوض). غائبٌ ⇒ لا سطرَ. */
  readonly offerSar?: number | null;
  /** `WR-05` — سياسةُ المبلغ (`null` ⇒ طلبٌ أقدمُ منها). غائبٌ ⇒ النصُّ القديم. */
  readonly offerMode?: OfferMode | null;
  /**
   * `GRP-CARD-01` — اسما المكانَين كما اختارَهما الراكبُ (معلمٌ أو مكانٌ مُسمّى، لا عنوانٌ دقيقٌ).
   * غائبٌ ⇒ تبقى المنطقةُ التقريبيّةُ وحدَها كما كانت.
   */
  readonly pickupLabel?: string | null;
  readonly dropoffLabel?: string | null;
}

export interface UnsubscribedGroupPublisher {
  /** يعيد معرّف الرسالة المنشورة، أو null إن رفض تلغرام النشر بلا عطل تقني. */
  publishCard(card: UnsubscribedCard): Promise<Result<string | null, PortFailureError>>;
}

/** ملاحظة الطلب (وصف الطرد في التوصيل) — تُقرأ منفصلة لأن كيان Order لا يحملها. */
export interface OrderNotesReader {
  readNotes(orderId: OrderId): Promise<Result<string | null, PortFailureError>>;
  /** `ORDER-TERMS-01` — وقتُ الحضورِ. اختياريٌّ: من لا يقرؤه تخلو بطاقتُه منه. */
  readTerms?(orderId: OrderId): Promise<
    Result<
      {
        readonly pickupAt: Date | null;
        readonly offerSar?: number | null;
        readonly offerMode?: OfferMode | null;
        readonly pickupLabel?: string | null;
        readonly dropoffLabel?: string | null;
      },
      PortFailureError
    >
  >;
}

export interface PublishToUnsubscribedGroupDependencies {
  readonly orders: OrderRepository;
  readonly notes: OrderNotesReader;
  readonly cycles: UnsubscribedCyclePort;
  readonly publisher: UnsubscribedGroupPublisher;
}

export class OrderNotFoundForPublishError {
  readonly code = "ORDER_NOT_FOUND_FOR_PUBLISH" as const;
  constructor(readonly orderId: OrderId) {}
}

export class CardNotPublishedError {
  readonly code = "CARD_NOT_PUBLISHED" as const;
  constructor(
    readonly orderId: OrderId,
    readonly negotiationId: string,
  ) {}
}

export type PublishToUnsubscribedGroupError =
  | PortFailureError
  | OrderNotFoundForPublishError
  | CardNotPublishedError;

export interface PublishReport {
  readonly orderId: OrderId;
  readonly published: boolean;
  /** null عندما ترفض القاعدة فتح دورة (طلب غير باحث، دورة قائمة، نفاد الدورات). */
  readonly negotiationId: string | null;
  readonly cycle: number | null;
  readonly messageId: string | null;
  /** سبب عدم النشر كما جاء من القاعدة، حرفياً بلا تفسير. */
  readonly reason: string | null;
  /** أأُودِعَ إخطارُ الدائرةِ الأوسعِ لصاحبِ الطلبِ؟ يقعُ عندَ الدورةِ الأولى فقط. */
  readonly notificationQueued: boolean;
}

/**
 * يفتح دورة جديدة ثم ينشر البطاقة. الترتيب مقصود: لا نُنشر بطاقة بلا دورة تُسجَّل عليها
 * الضغطات، ولو نُشرت أولاً لكان كل ضغط في تلك الفجوة ضائعاً بلا مكان يُكتب فيه.
 * وإن فشل النشر بعد فتح الدورة، نُعيد خطأً صريحاً: الدورة تبقى مفتوحة ويلتقطها العامل
 * عند انتهاء مهلة الجمع، فتُعاد المحاولة بدورة تالية بدل بقاء الطلب معلَّقاً بصمت.
 */
export async function publishToUnsubscribedGroup(
  input: { readonly orderId: OrderId },
  deps: PublishToUnsubscribedGroupDependencies,
): Promise<Result<PublishReport, PublishToUnsubscribedGroupError>> {
  const found = await deps.orders.findById(input.orderId);
  if (!found.ok) return found;
  if (found.value === null) return err(new OrderNotFoundForPublishError(input.orderId));
  const order = found.value;

  const opened = await deps.cycles.openCycle(input.orderId);
  if (!opened.ok) return opened;

  if (!opened.value.opened) {
    return ok({
      orderId: input.orderId,
      published: false,
      negotiationId: null,
      cycle: null,
      messageId: null,
      reason: opened.value.reason,
      notificationQueued: false,
    });
  }

  const cycle = opened.value.cycle;

  const notes = await deps.notes.readNotes(input.orderId);
  if (!notes.ok) return notes;
  const terms =
    deps.notes.readTerms === undefined ? null : await deps.notes.readTerms(input.orderId);
  if (terms !== null && !terms.ok) return terms;

  const published = await deps.publisher.publishCard({
    groupId: cycle.groupId,
    negotiationId: cycle.negotiationId,
    orderId: input.orderId,
    cityId: cycle.cityId,
    service: cycle.service,
    cycle: cycle.cycle,
    areaLabel: approximateArea(order.pickup),
    notes: notes.value,
    excludedDriverIds: cycle.excludedDriverIds,
    ...(terms === null
      ? {}
      : {
          pickupAt: terms.value.pickupAt,
          ...(terms.value.offerSar === undefined ? {} : { offerSar: terms.value.offerSar }),
          ...(terms.value.offerMode === undefined ? {} : { offerMode: terms.value.offerMode }),
          ...(terms.value.pickupLabel === undefined
            ? {}
            : { pickupLabel: terms.value.pickupLabel }),
          ...(terms.value.dropoffLabel === undefined
            ? {}
            : { dropoffLabel: terms.value.dropoffLabel }),
        }),
  });
  if (!published.ok) return published;
  if (published.value === null) {
    return err(new CardNotPublishedError(input.orderId, cycle.negotiationId));
  }

  const attached = await deps.cycles.attachGroupMessage(cycle.negotiationId, published.value);
  if (!attached.ok) return attached;

  return ok({
    orderId: input.orderId,
    published: true,
    negotiationId: cycle.negotiationId,
    cycle: cycle.cycle,
    messageId: published.value,
    reason: null,
    notificationQueued: cycle.notificationQueued,
  });
}
