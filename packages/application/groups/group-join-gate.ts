/**
 * الغرض: بوّابةُ دخولِ قروبِ السائقينَ غيرِ المشتركينَ — طلبُ الانضمامِ يُقبلُ
 *   لسائقٍ مسجَّلٍ موثَّقٍ في مدينةِ القروبِ، ويُرفضُ لغيرِهِ معَ أفضلِ جهدٍ في
 *   إرشادِ غيرِ المسجَّلِ إلى رابطِ التسجيلِ. والعضويّةُ تُسجَّلُ في القاعدةِ
 *   ليصيرَ قياسُ التحويلِ منَ القروبِ إلى الاشتراكِ ممكناً لأوّلِ مرّةٍ.
 * الحالة: منفَّذ فعلياً — البند `PD-001` · `ADR 0157` (خارطةُ دَينِ المنتَج).
 * ينتمي إلى: application/groups
 * يُتوقع أن يستخدمه لاحقاً: packages/application/bots/driver-dialog.ts (توزيعُ
 *   `join_request` قبلَ الحوار)، apps/gateway/src/container.ts (التوصيل).
 * ملاحظات مستقبلية: مغادرةُ الأعضاءِ (`chat_member`) ليست ههنا ولا تُدَّعى —
 *   المقامُ المبنيُّ هوَ من **دخلَ عبرَ البوّابةِ** بقرارِها، لا جردُ الأعضاءِ الحيّ.
 *
 * ## ترتيبُ الأحكامِ داخلَ البوّابةِ — لماذا هكذا
 *
 * ١) القروبُ المجهولُ يُرفضُ **قبلَ** البحثِ عنِ السائقِ: عزوُ القروبِ إلى مدينتِهِ
 *    شرطُ أيِّ حكمٍ آخرَ (عمودُ `cities.telegram_unsubscribed_drivers_group_id` هوَ
 *    مصدرُ العزوِ الوحيدُ — لا الرابطَ العامَّ ولا الاسمَ). ولا يُسجَّلُ صفٌّ لهُ
 *    في `group_memberships` لأنَّ الجدولَ منسوبٌ إلى مدينةٍ (`city_id not null`)
 *    — فالحادثةُ تُسجَّلُ في السجلِّ المهيكلِ حصراً.
 * ٢) غيرُ المسجَّلِ يُرفضُ **ولا يُسجَّلُ صفّاً**: الجدولُ يحملُ سائقينَ منسوبينَ
 *    (`driver_id`)، ومن لا صفَّ لهُ في `drivers` ليسَ لهُ ما يُنسبُ إليهِ. عدُّ
 *    محاولاتِ غيرِ المسجَّلينَ مقامٌ آخرُ — يُغطّيهِ السجلُّ المهيكلُ لا الجدولَ.
 * ٣) قرارُ تيليجرامَ (approve/decline) **يسبقُ** كتابةَ العضويّةِ: العضويّةُ سجلُّ
 *    ما جرى فعلًا، فمن نجحَ نداءُ القبولِ عندَ تلغرامَ ثمَّ عجزَتِ الكتابةُ
 *    يُسجَّلُ العجزُ في السجلِّ — ولا يُدَّعى قبولٌ لم يبلغْ تلغرامَ قطُّ.
 * ٤) رفضُ المطالبةِ البرمجيُّ (`register_unsubscribed_claim`) باقٍ خطَّ الدفاعِ
 *    الدائمَ: هذهِ البوّابةُ **زيادةٌ** عليهِ لا بديلٌ عنهُ، ومتى لم تتوفَّر
 *    شروطُها التشغيليّةُ (طلباتُ الانضمامِ مفعَّلةٌ والبوتُ مشرفٌ بصلاحيّةِ دعوةٍ)
 *    فهيَ خاملةٌ والرفضُ البرمجيُّ هوَ الحكمَ.
 */

import { pseudonymise } from "../../infrastructure/observability/structured-log.ts";
import { initialLanguageFromHint, translate } from "../../shared/i18n/index.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { DriverDirectory } from "../bots/types.ts";
import type { PortFailureError } from "../ports/index.ts";

/** القروبُ كما تعرفهُ البوّابةُ: مدينةٌ ومعرّفُ محادثةٍ — لا أكثرَ ولا أقلَّ. */
export interface UnsubscribedGroupRef {
  readonly cityId: CityId;
  /** معرّف قروب تلغرام كنصّ — قيمتهُ bigint سالبة، والنصُّ يمنعُ فقدَ الدقّة. */
  readonly groupChatId: string;
}

/**
 * عزوُ القروبِ إلى مدينتِهِ. مصدرُ الحقيقةِ الوحيدُ: عمودُ
 * `cities.telegram_unsubscribed_drivers_group_id`. يُعيدُ `null` حينَ لا يعرفُ
 * أيُّ مدينةٍ هذا القروبَ — والبوّابةُ تُلفظُهُ لا تُخمِّنُهُ.
 */
export interface UnsubscribedGroupCityDirectory {
  findByGroupChatId(
    groupChatId: string,
  ): Promise<Result<UnsubscribedGroupRef | null, PortFailureError>>;
}

/** قرارُ بوّابةٍ وصلَ تلغرامَ فعلًا وكُتبَ في جدولِ العضويّةِ. */
export interface GroupMembershipDecision {
  readonly groupChatId: string;
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly status: "approved" | "declined";
  /** مطلوبٌ عندَ الرفضِ (`ح-7` روحًا: قرارٌ بلا سببٍ قراءةٌ لا حكمٌ). */
  readonly reason: string | null;
  /** من أينَ جاءَ القرارُ — قيمةٌ ثابتةٌ اليومَ توسعتْ يومَ صارَ للبوّابةِ طرقٌ. */
  readonly source: "driver_bot_join_request";
}

/**
 * سجلُّ عضويّةٍ **بأدنى ما يلزمُ للحكمِ والقياسِ**: صفٌّ واحدٌ لكلِّ
 * (قروبٍ × سائقٍ) يُحدَّثُ عندَ كلِّ طلبٍ — أوّلُ طلبٍ محفوظٌ في `requested_at`
 * لا يُطمَسُ، فيبقى زمنُ الدخولِ صادقاً ولو تكرَّرَ الطلبُ.
 */
export interface GroupMembershipStore {
  recordDecision(decision: GroupMembershipDecision): Promise<Result<void, PortFailureError>>;
}

/**
 * أفعالُ تيليجرامَ التي تحتاجُها البوّابةُ. كلُّها تُعيدُ `boolean` لا ترمي:
 * فشلُ النداءِ حدثٌ يُسجَّلُ ويُعالَجُ، لا استثناءً يُسقطُ المسارَ كلَّهُ.
 */
export interface TelegramGroupGatePort {
  approve(groupChatId: string, telegramUserId: string): Promise<boolean>;
  decline(groupChatId: string, telegramUserId: string): Promise<boolean>;
  /**
   * `GRP-GATE-02` — إخراجٌ لا حظرٌ (قرارُ المالكِ): حظرٌ ثمَّ رفعُه فوراً، فيعودُ متى سجّلَ
   * ووُثِّقَ. اختياريٌّ: منفذٌ لا يُنفِّذُه يُبقي البوّابةَ على طلباتِ الانضمامِ وحدَها.
   */
  remove?(groupChatId: string, telegramUserId: string): Promise<boolean>;
  /** `GRP-GATE-02` — مشرفو القروبِ ومالكُه لا يُخرَجون. `null` ⇒ تعذّرت القراءةُ فلا يُحكَم. */
  isGroupAdmin?(groupChatId: string, telegramUserId: string): Promise<boolean | null>;
  /** رسالةٌ خاصّةٌ — أفضلُ جهدٍ: تلغرامُ لا يضمنُ وصولَها لمن لم يبدأِ البوتَ. */
  messageUser(userChatId: string, text: string): Promise<boolean>;
  /**
   * رابطُ `/start` عميقٌ للتسجيلِ، مبنيٌّ من هويّةِ البوتِ نفسِهِ (`getMe`) لا من
   * إعدادٍ يدويٍّ يتقادمُ. `null` إن تعذَّرَ — فلا يُوعَدُ برابطٍ لا يُبنى.
   */
  registrationLink(): Promise<string | null>;
}

export interface GroupJoinGateDependencies {
  readonly cities: UnsubscribedGroupCityDirectory;
  readonly drivers: DriverDirectory;
  readonly memberships: GroupMembershipStore;
  readonly gate: TelegramGroupGatePort;
  /** تسجيلُ الأحداثِ — يُمرَّر ليكونَ صامتاً في اختبارِ الوحدةِ. */
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

/** طلبُ انضمامٍ كما يصلُ منَ المُحوِّلِ — بلا شيءٍ من تلغرامَ سوى ما يُحكَمُ بهِ. */
export interface DriverGroupJoinRequest {
  readonly groupChatId: string;
  readonly telegramUserId: string;
  readonly userChatId: string;
  /** لغةُ عميلِ تلغرامَ — افتراضٌ أوّليٌّ فقط. */
  readonly languageHint: string;
}

/** أسبابُ الرفضِ — ثوابتُ مقروءةٌ في الجدولِ والسجلِّ، لا نصوصٍ حرةٍ تُربَّكُ القياسَ. */
export const JOIN_GATE_DECLINE_REASONS = {
  cityMismatch: "city_mismatch",
  driverNotVerified: "driver_not_verified",
} as const;

/**
 * يعالجُ طلبَ انضمامٍ واحدًا. يعيدُ `true` حينَ اكتملَ الحكمُ (قبولاً أو رفضاً)،
 * و`false` عندَ عجزٍ تقنيٍّ (قاعدةٌ لا تُقرأُ، تلغرامُ لا يُجيبُ) — فلا يُدَّعى
 * نجاحٌ ولا يُبتلَعُ فشلٌ.
 */
export async function handleDriverGroupJoinRequest(
  request: DriverGroupJoinRequest,
  deps: GroupJoinGateDependencies,
): Promise<boolean> {
  const log = deps.log ?? (() => {});
  const { groupChatId, telegramUserId } = request;

  const city = await deps.cities.findByGroupChatId(groupChatId);
  if (!city.ok) {
    log("group_join.city_lookup_failed", { group: groupChatId });
    return false;
  }
  if (city.value === null) {
    // قروبٌ لا تعرفُهُ أيُّ مدينةٍ: الرفضُ هوَ الأمانَ (لا يُتركَ الطلبُ معلَّقًا
    // يراهُ صاحبُهُ صمتاً)، والحادثةُ في السجلِّ حصراً — لا مدينةَ تُنسبُ إليها.
    const declined = await deps.gate.decline(groupChatId, telegramUserId);
    log("group_join.unknown_group_declined", {
      group: groupChatId,
      user: pseudonymise(telegramUserId),
      delivered: declined,
    });
    return declined;
  }
  const cityId = city.value.cityId;

  const found = await deps.drivers.findByTelegramId(telegramUserId);
  if (!found.ok) {
    log("group_join.driver_lookup_failed", { group: groupChatId });
    return false;
  }
  const driver = found.value;

  // غيرُ المسجَّلِ: رفضٌ + إرشادٌ لأفضلِ جهدٍ. لا صفَّ عضويّةٍ (انظر رأسِ الملفِّ).
  if (driver === null) {
    const declined = await deps.gate.decline(groupChatId, telegramUserId);
    let messaged = false;
    if (declined) {
      const link = await deps.gate.registrationLink();
      const text =
        link === null
          ? translate(
              initialLanguageFromHint(request.languageHint),
              "driver.join_gate_not_registered_no_link",
            )
          : translate(
              initialLanguageFromHint(request.languageHint),
              "driver.join_gate_not_registered",
              { link },
            );
      messaged = await deps.gate.messageUser(request.userChatId, text);
    }
    log("group_join.unregistered_declined", {
      group: groupChatId,
      user: pseudonymise(telegramUserId),
      delivered: declined,
      messaged,
    });
    return declined;
  }

  const rejection =
    driver.cityId !== cityId
      ? JOIN_GATE_DECLINE_REASONS.cityMismatch
      : driver.isVerified
        ? null
        : JOIN_GATE_DECLINE_REASONS.driverNotVerified;

  if (rejection !== null) {
    const declined = await deps.gate.decline(groupChatId, telegramUserId);
    if (!declined) {
      log("group_join.telegram_decline_failed", { group: groupChatId, reason: rejection });
      return false;
    }
    const recorded = await deps.memberships.recordDecision({
      groupChatId,
      driverId: driver.id,
      cityId,
      status: "declined",
      reason: rejection,
      source: "driver_bot_join_request",
    });
    if (!recorded.ok) {
      log("group_join.membership_write_failed", { group: groupChatId, reason: rejection });
    }
    return true;
  }

  const approved = await deps.gate.approve(groupChatId, telegramUserId);
  if (!approved) {
    log("group_join.telegram_approve_failed", { group: groupChatId });
    return false;
  }
  const recorded = await deps.memberships.recordDecision({
    groupChatId,
    driverId: driver.id,
    cityId,
    status: "approved",
    reason: null,
    source: "driver_bot_join_request",
  });
  if (!recorded.ok) {
    log("group_join.membership_write_failed", { group: groupChatId });
  }
  return true;
}

export interface DriverGroupDirectJoin {
  readonly groupChatId: string;
  readonly telegramUserId: string;
  readonly languageHint: string;
  readonly isBot: boolean;
}

/**
 * `GRP-GATE-02` — من دخلَ قروبَ سائقي مدينةٍ مباشرةً (الرابطُ العامُّ يتجاوزُ طلبَ الانضمامِ)
 * يُحكَمُ فيه بالمعيارِ نفسِه: سائقٌ مسجَّلٌ موثَّقٌ في مدينةِ القروبِ يبقى، وكلُّ من سواه يُخرَجُ
 * ويُراسَلُ خاصّةً (أفضلُ جهدٍ) بطريقِ العودةِ. ولا صفَّ عضويّةٍ: القيدُ في الجدولِ يحصرُ
 * المصدرَ في طلبِ الانضمامِ، والإخراجُ حدثٌ يُسجَّلُ في السجلِّ المُنظَّمِ.
 *
 * ما لا يُمَسُّ: قروبٌ لا تعرفُه مدينةٌ (ليسَ قروبَنا لنحكمَ فيه)، والبوتاتُ، ومشرفو القروبِ —
 * وتعذُّرُ قراءةِ الإشرافِ أو الهويّةِ يُبقي العضوَ (الخطأُ في الإبقاءِ يُصلَحُ، والإخراجُ الجزافُ
 * لسائقٍ حقيقيٍّ يُنفِّرُه).
 */
export async function handleDriverGroupDirectJoin(
  join: DriverGroupDirectJoin,
  deps: GroupJoinGateDependencies,
): Promise<"kept" | "removed" | "skipped"> {
  const log = deps.log ?? (() => {});
  const { groupChatId, telegramUserId } = join;
  if (join.isBot || deps.gate.remove === undefined) return "skipped";

  const city = await deps.cities.findByGroupChatId(groupChatId);
  if (!city.ok || city.value === null) return "skipped";
  const cityId = city.value.cityId;

  const found = await deps.drivers.findByTelegramId(telegramUserId);
  if (!found.ok) {
    log("group_join.direct_driver_lookup_failed", { group: groupChatId });
    return "skipped";
  }
  const driver = found.value;
  if (driver !== null && driver.cityId === cityId && driver.isVerified) return "kept";

  const admin =
    deps.gate.isGroupAdmin === undefined
      ? false
      : await deps.gate.isGroupAdmin(groupChatId, telegramUserId);
  if (admin !== false) return "skipped";

  const reason =
    driver === null
      ? "not_registered"
      : driver.cityId !== cityId
        ? JOIN_GATE_DECLINE_REASONS.cityMismatch
        : JOIN_GATE_DECLINE_REASONS.driverNotVerified;
  const removed = await deps.gate.remove(groupChatId, telegramUserId);
  let messaged = false;
  if (removed) {
    const link = await deps.gate.registrationLink();
    const text =
      driver === null
        ? link === null
          ? translate(
              initialLanguageFromHint(join.languageHint),
              "driver.join_gate_not_registered_no_link",
            )
          : translate(
              initialLanguageFromHint(join.languageHint),
              "driver.join_gate_not_registered",
              { link },
            )
        : translate(
            initialLanguageFromHint(join.languageHint),
            "driver.join_gate_removed_not_eligible",
          );
    messaged = await deps.gate.messageUser(telegramUserId, text);
  }
  const meta = { group: groupChatId, user: pseudonymise(telegramUserId), reason, messaged };
  if (removed) log("group_join.direct_join_removed", meta);
  else log("group_join.direct_join_remove_failed", meta);
  return removed ? "removed" : "skipped";
}
