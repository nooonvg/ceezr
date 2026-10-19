/**
 * الغرض: حالاتُ استخدامِ عروضِ السائقِ — «لوحُ عروضي» و«تفاصيلُ عرضٍ» و«اقبَلْ»
 *   و«ارفُضْ» و«بدِّلْ توفُّري» (`F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-offers.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — «رحلتي النشطةُ» تبدأُ من طلبٍ قُبِلَ ههنا،
 *   وحالتُها تُقرأُ بمنفذٍ يُضافُ لا بتوسيعِ هذه الحالاتِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ القبولُ يمرُّ بالمخزنِ والرفضُ يمرُّ بمنفذٍ قائمٍ
 *
 * ليسَ تناظُراً في الشكلِ بل **وفاءً بكاتبٍ واحدٍ لكلِّ انتقالٍ** (القاعدة 0.6):
 * القبولُ انتقالٌ ذرّيٌّ يملكُه `claim_ride` في القاعدةِ (قفلٌ · إلغاءُ منافسٍ ·
 * سجلُّ تدقيقٍ · حكمُ مدينةٍ)، والرفضُ انتقالٌ يملكُه `offers.reject` بحرفِ
 * `BUG-003` (عرضٌ واحدٌ بمعرِّفِه لا كلُّ عرضٍ للسائقِ). فلو كُتِبَ لأحدِهما
 * طريقٌ ثانٍ ههنا لَصارَ للنظامِ حُكمانِ في انتقالٍ واحدٍ.
 *
 * ## ولِمَ التوفُّرُ في هذه الشريحةِ ولا شاشةٍ خاصّةٍ
 *
 * `SD-03` ينصُّ على «مبدّلِ متاح/غيرِ متاحٍ» **في شاشةِ العروضِ**: سائقٌ يرى
 * لوحاً فارغاً وسببُه أنَّه غيرُ متاحٍ يحتاجُ المبدّلَ في اليدِ نفسِها لا في
 * شاشةٍ أخرى يبحثُ عنها. والكاتبُ يبقى `record_attendance` لا سطراً ههنا.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تحكمُ على انتهاءِ المهلةِ**: تُنقَلُ ثوانِ الخادمِ وحكمُه
 *      (`isClaimable`)، والقبولُ يُرَدُّ من القاعدةِ إن انتهَت.
 *   ــ **لا تُعيدُ ذرّيّةً**: لا قراءةَ ثمَّ كتابةَ ههنا ألبتّةَ.
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ ولا خانةً لهما** (`ADR 0039` §٤ ·
 *      `م13-7` · `DEC-11`) — والطبقةُ الماليّةُ **غائبةٌ بإعلانٍ**.
 *   ــ **لا تُقدِّرُ زمنَ وصولٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`).
 *   ــ **لا تُرسِلُ إخطاراً للراكبِ**: الإخطارُ من صندوقِ الصادرِ بعدَ
 *      `claim_ride`، ولا مُرسِلَ ثانياً ههنا.
 */

import type {
  DriverOfferBoard,
  DriverOfferClaim,
  DriverOfferDetail,
} from "../../domain/driver/driver-offers.ts";
import type { DriverId, OfferId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { DriverDirectory, OfferDecisionPort } from "../bots/types.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type DriverOfferStore,
  type DriverOfferStoreError,
  isDriverOfferRejection,
} from "./offer-ports.ts";
import {
  noticeRiderOfTrip,
  type RiderTripNoticeDeps,
  recordRiderTripDeposit,
} from "./rider-trip-notice.ts";

/**
 * رموزُ العطبِ المنشورةُ — **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ وحدَه،
 * كي يُلزِمَ الحاجزُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ (القاعدة 0.6).
 */
export const DRIVER_OFFER_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "OFFER_STORE_NOT_AVAILABLE",
  "AVAILABILITY_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "OFFER_ID_INVALID",
  "AVAILABILITY_INVALID",
  "OFFER_NOT_FOUND",
  "OFFER_ALREADY_ANSWERED",
  "OFFER_EXPIRED",
  "OFFER_TAKEN",
  "ORDER_HELD",
  "CITY_MISMATCH",
  "CLAIM_REFUSED",
  "DRIVER_HAS_ACTIVE_ORDER",
] as const;

export type DriverOfferPublicErrorCode = (typeof DRIVER_OFFER_PUBLIC_ERROR_CODES)[number];

export interface DriverOfferRejection {
  readonly code: DriverOfferPublicErrorCode;
}

export interface DriverOfferDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverOfferStore;
  /** **المنفذُ القائمُ** — لا يُنشَأُ له بديلٌ: `record_attendance` كاتبُ التوفُّرِ. */
  readonly drivers: Pick<DriverDirectory, "findByTelegramId" | "setAvailability">;
  /** **المنفذُ القائمُ** — رفضُ عرضٍ واحدٍ بمعرِّفِه (`BUG-003`). */
  readonly offers: OfferDecisionPort;
  readonly now: () => Date;
  /** `RIDE-NOTICE-01` — إخطارُ الراكبِ بالقبولِ على بوتِه؛ غيابُه يُسكِتُ الإخطارَ وحدَه. */
  readonly riderNotice?: RiderTripNoticeDeps;
}

/** أثرُ الرفضِ — «هل حُرِّكَ صفٌّ» جوابٌ صريحٌ لا صمتٌ يُقرأُ نجاحاً. */
export interface DriverOfferRejected {
  readonly offerId: string;
}

/** أثرُ تبديلِ التوفُّرِ — الحالةُ بعدَ الكتابةِ كما طُلِبَت. */
export interface DriverAvailabilityChanged {
  readonly isAvailable: boolean;
}

function rejection(code: DriverOfferPublicErrorCode): DriverOfferRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverOfferPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession(
  deps: DriverOfferDeps,
  accessToken: string | undefined,
): Promise<Result<string, DriverOfferRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * معرِّفُ العرضِ **يُفحَصُ شكلاً قبلَ الذهابِ إلى القاعدةِ**: نصٌّ غيرُ معرِّفٍ
 * يُعيدُ من `uuid` عطبَ نوعٍ خاماً، وعطبُ نوعٍ يُقرأُ `503` فيُظَنُّ الخادمُ
 * ساقطاً وهوَ سليمٌ. والشكلُ **ليسَ ملكيّةً**: المِلكيّةُ حكمُ القاعدةِ.
 */
function readOfferId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * تحويلُ رفضِ المخزنِ إلى رمزٍ منشورٍ — **شاملٌ حرفاً** لاتّحادِ الرفضِ، فرمزٌ
 * جديدٌ في القاعدةِ يُسقِطُ البناءَ (`switch` مُستنفَدٌ) ولا يمرُّ خاماً لشاشةٍ.
 */
function publicCodeFrom(error: DriverOfferStoreError): DriverOfferRejection {
  if (!isDriverOfferRejection(error)) return rejection("OFFER_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    // حسابٌ لا صفَّ له ليسَ جلسةً فاسدةً (القسم 9.8) — ولا يُفرَّقُ عن «ليسَ سائقاً».
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
    case "OFFER_NOT_FOUND":
      return rejection("OFFER_NOT_FOUND");
    case "ORDER_NOT_CLAIMABLE":
      return rejection("OFFER_TAKEN");
    case "OFFER_NOT_VALID":
      return rejection("OFFER_EXPIRED");
    case "ORDER_HELD":
      return rejection("ORDER_HELD");
    case "CITY_MISMATCH":
      return rejection("CITY_MISMATCH");
    case "CLAIM_REFUSED":
      return rejection("CLAIM_REFUSED");
    case "DRIVER_HAS_ACTIVE_ORDER":
      return rejection("DRIVER_HAS_ACTIVE_ORDER");
  }
}

export async function readDriverOfferBoard(
  deps: DriverOfferDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<DriverOfferBoard, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.readBoard({ telegramUserId: session.value });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

/**
 * `LOAD-01 Recovery` — إيصالاتُ اللوحِ: العميلُ يُقرُّ بعرضٍ وصلَ وطبّقَهُ،
 * فيُسجَّلُ وصولُهُ موثَّقًا منَ جهةِ الخادمِ. **جلبُ اللوحِ لا يكفي**: الإيصالُ
 * يأتي بعدَ التطبيقِ — فصلُ «أُرسِلَ» عنِ «وَصَلَ» هوَ عينُ أمانةِ القياسِ.
 */
export async function recordDriverOfferBoardReceipts(
  deps: DriverOfferDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly offerIds: readonly string[];
  },
): Promise<Result<{ readonly recorded: number }, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const recorded = await deps.store.recordBoardReceipts({
    telegramUserId: session.value,
    offerIds: input.offerIds,
  });
  if (!recorded.ok) return err(publicCodeFrom(recorded.error));
  return ok(recorded.value);
}

export async function readDriverOfferDetail(
  deps: DriverOfferDeps,
  input: { readonly accessToken: string | undefined; readonly offerId: unknown },
): Promise<Result<DriverOfferDetail, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const offerId = readOfferId(input.offerId);
  if (offerId === null) return err(rejection("OFFER_ID_INVALID"));

  const read = await deps.store.readDetail({ telegramUserId: session.value, offerId });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

export async function acceptDriverOffer(
  deps: DriverOfferDeps,
  input: { readonly accessToken: string | undefined; readonly offerId: unknown },
): Promise<Result<DriverOfferClaim & { readonly secondsLeft?: number }, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const offerId = readOfferId(input.offerId);
  if (offerId === null) return err(rejection("OFFER_ID_INVALID"));

  // LOAD-01 (الدفعةُ الخامسةَ عشرةَ) — حينَ يُطلَبُ إشعارُ الراكبِ ويدعمُ المخزنُ ذلك: القبولُ وإيداعُ
  // MATCHED في عبارةٍ واحدة (كانا حجزَين متتاليَين لمقعدِ التجمُّعِ قبلَ الردّ). القبولُ نفسُه بلا تغيير.
  const combined =
    deps.riderNotice !== undefined && deps.store.acceptWithMatchedNotice !== undefined
      ? await deps.store.acceptWithMatchedNotice({ telegramUserId: session.value, offerId })
      : undefined;
  const claimed =
    combined === undefined
      ? await deps.store.accept({ telegramUserId: session.value, offerId })
      : combined.ok
        ? ok(combined.value.claim)
        : combined;
  if (!claimed.ok) return err(publicCodeFrom(claimed.error));
  // `WR-09` — الحجزُ ليسَ إسناداً: إشعارُ المرشَّحِ أودعَته القاعدةُ في معاملتِه.
  if (claimed.value.pendingRider !== true) {
    const deposit = combined?.ok === true ? combined.value.matchedNotice : undefined;
    if (deposit !== undefined) {
      recordRiderTripDeposit(deps.riderNotice, claimed.value.orderId, "MATCHED", deposit);
    } else {
      // لا إيداعَ في العبارةِ (منفذٌ قديمٌ أو ردٌّ بلا الحقل) ⇒ المسارُ المستقلُّ؛ ومفتاحُ منعِ
      // التكرارِ `rider_trip:<order>:MATCHED` يجعلُ أيَّ تكرارٍ صفّاً واحداً.
      await noticeRiderOfTrip(deps.riderNotice, claimed.value.orderId, "MATCHED");
    }
    return ok(claimed.value);
  }
  // الباقي يُحسَبُ ههنا بساعةِ الخادمِ ولا تُنشَرُ لحظةُ الانتهاءِ للعميل
  // (`check-driver-offers-contract`: موعدٌ مطلقٌ يُقارَنُ بساعةِ الجهازِ فينحرف).
  const deadline =
    claimed.value.expiresAt === undefined || claimed.value.expiresAt === null
      ? Number.NaN
      : Date.parse(claimed.value.expiresAt);
  const secondsLeft = Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - deps.now().getTime()) / 1000))
    : 0;
  return ok({ ...claimed.value, secondsLeft });
}

/**
 * الرفضُ **بالمنفذِ القائمِ**، وحلُّ الهويّةِ قبلَه لأنَّ المنفذَ يُخاطَبُ
 * بمعرِّفِ سائقٍ لا بمعرِّفِ تلغرامَ. و«لم يُحرَّكْ صفٌّ» **ليسَ نجاحاً**:
 * عرضٌ قُبِلَ أو انتهى أو ليسَ لهذا السائقِ — والشاشةُ تقولُه ولا تُخفيه.
 */
export async function rejectDriverOffer(
  deps: DriverOfferDeps,
  input: { readonly accessToken: string | undefined; readonly offerId: unknown },
): Promise<Result<DriverOfferRejected, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const offerId = readOfferId(input.offerId);
  if (offerId === null) return err(rejection("OFFER_ID_INVALID"));

  const found = await deps.drivers.findByTelegramId(session.value);
  if (!found.ok) return err(rejection("OFFER_STORE_NOT_AVAILABLE"));
  if (found.value === null) return err(rejection("NOT_A_DRIVER"));

  const rejected = await deps.offers.reject(offerId as OfferId, found.value.id as DriverId);
  if (!rejected.ok) return err(rejection("OFFER_STORE_NOT_AVAILABLE"));
  if (!rejected.value) return err(rejection("OFFER_ALREADY_ANSWERED"));
  return ok({ offerId });
}

export async function setDriverAvailability(
  deps: DriverOfferDeps,
  input: { readonly accessToken: string | undefined; readonly isAvailable: unknown },
): Promise<Result<DriverAvailabilityChanged, DriverOfferRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  // **لا تخميناً لقيمةٍ منطقيّةٍ**: `"false"` نصّاً يُقرأُ صادقاً في أيِّ تحويلٍ
  // متسامحٍ، فيُبدَّلُ التوفُّرُ عكسَ ما أرادَ السائقُ.
  if (typeof input.isAvailable !== "boolean") return err(rejection("AVAILABILITY_INVALID"));

  const found = await deps.drivers.findByTelegramId(session.value);
  if (!found.ok) return err(rejection("AVAILABILITY_NOT_AVAILABLE"));
  if (found.value === null) return err(rejection("NOT_A_DRIVER"));

  const written = await deps.drivers.setAvailability(found.value.id, input.isAvailable);
  if (!written.ok) return err(rejection("AVAILABILITY_NOT_AVAILABLE"));
  return ok({ isAvailable: input.isAvailable });
}
