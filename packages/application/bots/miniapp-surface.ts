/**
 * الغرض: طبقةُ البوتِ الخفيفةُ — تقرّرُ لكلِّ تحديثٍ هل يُخدَمُ في التطبيقِ المصغَّرِ (زرُّ
 *   «افتح وَصْلة» على الشاشةِ المقصودةِ) أم يبقى في المحادثةِ، وتبني ردَّ الدخولِ
 *   (`ADR 0213` · `ADR 0286` · `DEC-22` · `ADR 0028` §٢–٣).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}
 *
 * ## العقدُ المعماريُّ (`ADR 0286`) — البوتُ دخولٌ وإشعارٌ فقط
 *
 * `ADR 0286` شدّدَ عقدَ `ADR 0213`: **لا تنفيذَ لعملٍ تجاريٍّ في المحادثةِ إطلاقاً** في
 * وضعِ `miniapp` — وهو وضعُ التشغيلِ الفعليِّ الوحيدُ (`legacy` مسارُ اختبارِ توافقٍ معزول).
 * ما يمرُّ إلى الحوارِ القديمِ من رسائلِ المحادثةِ الخاصّةِ محصورٌ في قائمةٍ مغلقةٍ لا
 * تُوسَّعُ إلا بقرارٍ:
 *
 * - **`/sos` و`/language` وأزرارُهما** (`sos:` · `lang:`): قناةُ نجاةٍ مستقلّةٌ (`ADR 0031`
 *   · `ADR 0077`) ولغةُ المحادثةِ نفسِها — لا عملَ تجاريّاً في أيٍّ منهما.
 * - **تدفّقاتُ البياناتِ لا الأوامر**: الموقعُ الحيُّ (التتبّعُ)، والصورُ (مسارُ التوافقِ)،
 *   وبطاقةُ الاتصالِ (إثباتُ رقمِ التسجيلِ من التطبيقِ — `PRD-105`)، وطلباتُ الانضمامِ
 *   للقروباتِ، ورسائلُ التفاوضِ (تمريرُ نصٍّ بين طرفَينِ لا قرارٌ فيه).
 * - **الأوامرُ ذاتُ المواطنِ المعلنةِ** `home: "bot"` في `COMMAND_HOMES` — لكلٍّ منها
 *   سببٌ مكتوبٌ، وهي إعداداتُ حسابٍ وعرضٌ للقراءةِ لا دورةَ طلبٍ: `/city` · `/rating`
 *   · `/area`.
 *
 * **وكلُّ ما عدا ذلك يُجابُ بزرِّ `web_app`** يفتحُ الشاشةَ المقصودةَ: أوامرُ الانتقالِ،
 * والنصُّ الحرُّ، وأزرارُ الأعمالِ القديمةُ (`offer:` · `ride:` · `unsub:` · `sub:` ·
 * `avail:` · `rate:` · `trk:` · `sup:` · `fin:` …) — فلا يُنفَّذُ عملٌ في الخلفيةِ أبداً.
 * البطاقاتُ الجديدةُ (العروضُ والقروباتُ) لا تحملُ زرَّ عملٍ أصلاً: تحملُ زرَّ التطبيقِ.
 * - **سجلُّ الأوامرِ** (`COMMAND_HOMES`) يُسمّي لكلِّ أمرٍ موطنَه — التطبيقَ بشاشتِه، أو البوتَ
 *   بسببٍ مكتوبٍ. أمرٌ في قائمةِ البوتِ بلا موطنٍ مُعلَنٍ يُسقِطُ اختبارَ الشمولِ؛ فلا يبقى عملٌ
 *   في المحادثةِ بالسهوِ.
 * - **كلُّ ما سوى ذلك** يُجابُ بزرِّ `web_app` يفتحُ الشاشةَ نفسَها في التطبيقِ.
 *
 * ## لماذا وضعٌ لا حذفٌ
 *
 * `legacy` يُبقي السلوكَ القديمَ حرفاً بحرفٍ — وهو مسارُ اختبارِ التوافقِ المعزولُ فقط
 * (`ADR 0286`: يُرفضُ في الإنتاجِ ويُفعَّلُ خارجَه بـ`BOT_SURFACE_TEST_LEGACY=1` صريحاً).
 * والحوارُ القديمُ لا يُحذَفُ قبلَ إثباتاتِ 19.3؛ يصيرُ طبقةَ توافقٍ يُنادى من هنا وحدَه.
 */

import { t } from "../../shared/i18n/index.ts";
import {
  type MiniAppAudience,
  type MiniAppTarget,
  miniAppUrl,
} from "../../shared/miniapp-link/index.ts";
import {
  allItemsFor,
  type BotAudience,
  COMMAND_CALLBACK_PREFIX,
  commandForMenuText,
} from "./main-menu.ts";
import type {
  ActiveOrderSummary,
  BotReply,
  DialogState,
  IncomingUpdate,
  Keyboard,
  SessionStore,
} from "./types.ts";

/** وضعُ سطحِ البوتِ — `BOT_SURFACE_MODE`. */
export type BotSurfaceMode = "legacy" | "miniapp";

export interface MiniAppSurfaceConfig {
  readonly mode: BotSurfaceMode;
  /** أصلُ التطبيقِ المصغَّرِ (`MINIAPP_URL`) — لازمٌ في وضعِ `miniapp`، والضبطُ يرفضُ غيابَه. */
  readonly miniAppUrl: string | null;
}

/** موطنُ أمرٍ: شاشةٌ في التطبيقِ، أو البوتُ بسببٍ مكتوبٍ، أو ردُّ الدخولِ نفسُه. */
export type CommandHome =
  | { readonly home: "entry" }
  | { readonly home: "miniapp"; readonly screen: MiniAppScreenIntent }
  | { readonly home: "bot"; readonly why: string };

/**
 * الشاشةُ المقصودةُ كما يعرفُها السجلُّ. `active_ride` ليست شاشةً في الرابطِ: تُحَلُّ لحظةَ
 * الطلبِ إلى `ride_<orderId>` إن كان للراكبِ مشوارٌ جارٍ، وإلّا إلى السجلِّ.
 */
export type MiniAppScreenIntent =
  | "home"
  | "history"
  | "support"
  | "active_ride"
  | "offers"
  | "job"
  | "subscription";

const BOT_BASIC_SOS =
  "قناةُ طوارئَ مستقلّةٌ عن التطبيقِ — `ADR 0031` §٥: الطوارئُ لا تعتمدُ على سطحٍ واحدٍ.";
const BOT_BASIC_LANGUAGE =
  "لغةُ المحادثةِ نفسِها وإشعاراتِها — أمرٌ أساسيٌّ من أوامرِ البوتِ (`ADR 0028` §٢).";
const BOT_ACCOUNT_SETTING =
  "إعدادُ حسابٍ بلا شاشةٍ في التطبيقِ بعدُ (`ADR 0286` يوثّقُ الفجوةَ وقرارَها للمالك).";
const BOT_READONLY_VIEW = "عرضٌ للقراءةِ فقط لا يُنشئُ حالةً ولا يُغيّرُها (`ADR 0286`).";

/**
 * جردُ `ADR 0286` — أوامرُ حوارٍ قديمةٍ: خطواتٌ داخلَ مسارِ التسجيلِ القديمِ لا
 * أعمالًا مستقلةً. لا تُعلَنُ في قوائمِ البوتِ (لا القديمةَ ولا سطحَ التطبيقِ) ولا
 * تُصنَّفُ أعمالاً؛ وفي وضعِ التطبيقِ يُصفَّرُ الحوارُ قبلَها فلا تجدُ طورًا
 * فتُرَدُّ مجهولةً. اختبارُ الشمولِ (`bot-surface-inventory`) يُسقِطُ أيَّ أمرٍ
 * يُضافُ إلى الحواراتِ بلا موطنٍ: هنا أو في `COMMAND_HOMES` أو في أوامرِ المالكِ.
 */
export const LEGACY_DIALOG_STEP_COMMANDS: Readonly<Record<BotAudience, ReadonlySet<string>>> = {
  rider: new Set(["/skip"]),
  driver: new Set(["/cancel"]),
};

/**
 * جردُ `ADR 0286` — أوامرُ تشغيلٍ للمالكِ والدعمِ عبرَ بوتِ السائقِ (قروبُ الدعمِ):
 * ليست أعمالَ مستخدمٍ ولا تُفتَحُ لها شاشةٌ في التطبيقِ؛ استثناءٌ يُرفَعُ للمالكِ
 * أمرًا (إن أُريدَ لها سطحٌ فقرارُهُ مالكُ المنتجِ لا الحوارُ).
 */
export const OWNER_OPS_COMMANDS: ReadonlySet<string> = new Set(["/activate", "/answer", "/flag"]);

/**
 * السجلُّ — مصدرُ الحقيقةِ الوحيدُ لـ«أين يُخدَمُ هذا الأمرُ». يشملُ كلَّ ما في
 * `allItemsFor(audience)` ومعَهُ `/start` و`/help` و`/app`؛ واختبارُ الشمولِ يُسقِطُ أيَّ أمرٍ
 * يُضافُ إلى القائمةِ بلا موطنٍ.
 */
export const COMMAND_HOMES: Readonly<Record<BotAudience, Readonly<Record<string, CommandHome>>>> = {
  rider: {
    "/start": { home: "entry" },
    "/help": { home: "entry" },
    "/app": { home: "entry" },
    "/ride": { home: "miniapp", screen: "home" },
    "/cancel": { home: "miniapp", screen: "active_ride" },
    "/status": { home: "miniapp", screen: "active_ride" },
    "/history": { home: "miniapp", screen: "history" },
    "/tickets": { home: "miniapp", screen: "support" },
    "/support": { home: "miniapp", screen: "support" },
    "/delivery": {
      home: "miniapp",
      screen: "home",
    },
    "/city": {
      home: "bot",
      why: BOT_ACCOUNT_SETTING,
    },
    "/language": { home: "bot", why: BOT_BASIC_LANGUAGE },
    "/sos": { home: "bot", why: BOT_BASIC_SOS },
    "/rating": {
      home: "bot",
      why: BOT_READONLY_VIEW,
    },
  },
  driver: {
    "/start": { home: "entry" },
    "/help": { home: "entry" },
    "/app": { home: "entry" },
    "/trip": { home: "miniapp", screen: "job" },
    "/available": { home: "miniapp", screen: "offers" },
    "/unavailable": { home: "miniapp", screen: "offers" },
    "/finance": { home: "miniapp", screen: "subscription" },
    "/subscription": { home: "miniapp", screen: "subscription" },
    "/support": { home: "miniapp", screen: "support" },
    "/area": {
      home: "bot",
      why: BOT_ACCOUNT_SETTING,
    },
    "/city": {
      home: "bot",
      why: BOT_ACCOUNT_SETTING,
    },
    "/language": { home: "bot", why: BOT_BASIC_LANGUAGE },
    "/sos": { home: "bot", why: BOT_BASIC_SOS },
    "/rating": {
      home: "bot",
      why: BOT_READONLY_VIEW,
    },
  },
};

/**
 * `ADR 0286` — بادئاتُ الأزرارِ التي يبقى لها معالجٌ في البوتِ: الطوارئُ واللغةُ فقط.
 * كلُّ ما عداها زرُّ عملٍ تجاريٍّ يُجابُ بتوجيهٍ إلى التطبيقِ ولا يُنفَّذُ خلفيّاً.
 */
export const BOT_ALLOWED_CALLBACK_PREFIXES: ReadonlySet<string> = new Set(["lang", "sos"]);

/** ما يقرّرُه السطحُ لتحديثٍ واحدٍ. */
export type SurfaceDecision =
  /** يُمرَّرُ إلى الحوارِ القديمِ بلا مساسٍ — **وبلا أيِّ انتظارٍ قبلَه** (انظر أدناه). */
  | { readonly kind: "legacy" }
  /**
   * نصٌّ حرٌّ في محادثةٍ خاصّةٍ: إن كان للمستخدمِ حوارٌ جارٍ فهو جوابُ خطوتِه (يُمرَّرُ)، وإلّا
   * فهو طرقٌ على البابِ (ردُّ الدخولِ). الفصلُ يحتاجُ قراءةَ الجلسةِ فلا يُحسَمُ هنا.
   */
  | { readonly kind: "free_text" }
  /**
   * ردُّ الدخولِ: ترحيبٌ وزرُّ التطبيقِ. `registrationDecides` للسائقِ في `/start`: غيرُ
   * المسجَّلِ يُوجَّهُ إلى التطبيقِ أيضاً — تسجيلُه فيه (`POST /v1/onboarding/driver`) وبطاقةُ
   * الاتصالِ إثباتُ رقمِه (`PRD-105`)، فلا يُفتَحُ حوارُ تسجيلٍ في البوتِ.
   */
  | { readonly kind: "entry"; readonly command: string; readonly registrationDecides: boolean }
  /** أمرٌ موطنُه التطبيقُ: زرٌّ يفتحُ شاشتَه. */
  | { readonly kind: "open"; readonly command: string; readonly screen: MiniAppScreenIntent }
  /**
   * `ADR 0286` — زرُّ عملٍ تجاريٍّ قديمٌ (قبولُ عرضٍ، حالةُ رحلةٍ، مطالبةُ قروبٍ، اشتراكٌ…):
   * لا يُنفَّذُ، ويُجابُ بزرِّ التطبيقِ على شاشةِ العملِ. القرارُ متزامنٌ خالصٌ فلا يعرفُ
   * البادئةَ إلا من نصِّ الزرِّ.
   */
  | { readonly kind: "app_button" };

/** المحادثةُ الخاصّةُ وحدَها: معرّفُ المحادثةِ يساوي معرّفَ المرسِلِ. */
function isPrivateChat(update: IncomingUpdate): boolean {
  return update.from.chatId === update.from.telegramUserId;
}

/** يستخرجُ الأمرَ من نصٍّ أو زرِّ قائمةٍ أو زرِّ `cmd:` — أو `null`. */
export function commandOf(audience: BotAudience, update: IncomingUpdate): string | null {
  if (update.kind === "text") {
    const trimmed = update.text.trim();
    if (trimmed.startsWith("/")) {
      // `/start@WaslahBot payload` ⇒ `/start`
      const head = trimmed.split(/\s+/)[0] ?? trimmed;
      return (head.split("@")[0] ?? head).toLowerCase();
    }
    return commandForMenuText(audience, trimmed);
  }
  if (update.kind === "callback" && update.data.startsWith(`${COMMAND_CALLBACK_PREFIX}:`)) {
    return update.data.slice(COMMAND_CALLBACK_PREFIX.length + 1);
  }
  return null;
}

/** بادئةُ زرٍّ قديمٍ — `offer:accept:x` ⇒ `offer`. */
function callbackPrefix(update: IncomingUpdate): string {
  return update.kind === "callback" ? (update.data.split(":")[0] ?? "") : "";
}

/**
 * القرارُ — دالّةٌ **متزامنةٌ خالصةٌ** بلا قراءةٍ.
 *
 * التزامنُ ليس تفصيلاً: `/sos` موطنُه البوتُ فقرارُه `legacy`، ويُمرَّرُ إلى الحوارِ قبلَ أيِّ
 * `await` في هذه الطبقةِ — فيبقى ما يحرسُه `check-sos-intake-isolation` (`ADR 0077`) صادقاً:
 * لا قراءةَ تسبقُ `trigger_sos` فتُسقِطُ الاستغاثةَ إن أخفقت. وكذلك أزرارُ الطوارئِ واللغةِ.
 */
export function decideSurface(audience: BotAudience, update: IncomingUpdate): SurfaceDecision {
  if (!isPrivateChat(update)) return { kind: "legacy" };
  const command = commandOf(audience, update);
  if (command !== null) {
    const home = COMMAND_HOMES[audience][command];
    if (home === undefined || home.home === "bot") return { kind: "legacy" };
    if (home.home === "entry") {
      return {
        kind: "entry",
        command,
        registrationDecides: audience === "driver" && command === "/start",
      };
    }
    return { kind: "open", command, screen: home.screen };
  }
  if (update.kind === "text") return { kind: "free_text" };
  // `ADR 0286` — زرُّ عملٍ تجاريٍّ قديمٌ لا يُنفَّذُ في البوتِ؛ وأزرارُ الطوارئِ واللغةِ
  // وحدها تمرُّ إلى معالجِها.
  if (update.kind === "callback") {
    return BOT_ALLOWED_CALLBACK_PREFIXES.has(callbackPrefix(update))
      ? { kind: "legacy" }
      : { kind: "app_button" };
  }
  return { kind: "legacy" };
}

/** هل يُعامَلُ النصُّ الحرُّ جوابَ خطوةٍ جاريةٍ؟ */
export function freeTextBelongsToDialog(state: DialogState): boolean {
  return state.step !== "idle";
}

/** يحوّلُ نيّةَ الشاشةِ إلى هدفِ رابطٍ. */
export function resolveTarget(
  audience: MiniAppAudience,
  screen: MiniAppScreenIntent,
  activeOrders: readonly ActiveOrderSummary[],
): MiniAppTarget {
  if (audience === "rider") {
    if (screen === "active_ride") {
      const ride = activeOrders.find((order) => order.service === "transport");
      return ride === undefined
        ? { audience, screen: "history" }
        : { audience, screen: "ride", id: String(ride.orderId) };
    }
    if (screen === "history" || screen === "support" || screen === "home") {
      return { audience, screen };
    }
    return { audience, screen: "home" };
  }
  if (
    screen === "job" ||
    screen === "subscription" ||
    screen === "support" ||
    screen === "offers"
  ) {
    return { audience, screen };
  }
  return { audience, screen: "offers" };
}

/** زرُّ `web_app` واحدٌ يفتحُ الهدفَ. */
export function openAppKeyboard(
  config: MiniAppSurfaceConfig,
  label: string,
  target: MiniAppTarget | null,
): Keyboard {
  if (config.miniAppUrl === null) throw new Error("MINIAPP_URL_MISSING");
  return {
    kind: "inline",
    rows: [[{ label, webAppUrl: miniAppUrl(config.miniAppUrl, target) }]],
  };
}

/**
 * لوحةُ الردِّ الدائمةُ في وضعِ التطبيقِ: الأوامرُ الأساسيّةُ المقيمةُ في البوتِ وحدَها
 * (الطوارئُ واللغةُ). تحلُّ محلَّ القائمةِ الكبيرةِ القديمةِ على جهازِ المستخدمِ فلا يبقى
 * أمامَه زرٌّ لعملٍ انتقلَ، ونصّاها يُترجَمانِ إلى أمرَيهما بـ`commandForMenuText` القائمةِ.
 */
export function basicMenuKeyboard(language: string): Keyboard {
  const tr = t(language);
  return {
    kind: "reply",
    rows: [[tr("safety.menu_sos"), tr("menu.language")]],
    persistent: true,
  };
}

export interface EntryContext {
  readonly audience: BotAudience;
  readonly chatId: string;
  readonly language: string;
  /** للراكبِ غيرِ المسجَّلِ يُفتَحُ التطبيقُ على شاشةِ التسجيلِ. */
  readonly registered: boolean;
}

/** ردُّ الدخولِ: رسالةُ ترحيبٍ تستبدلُ القائمةَ، ثمَّ زرُّ التطبيقِ. */
export function entryReplies(
  config: MiniAppSurfaceConfig,
  context: EntryContext,
  command: string,
): readonly BotReply[] {
  const tr = t(context.language);
  const target: MiniAppTarget | null =
    context.audience === "rider" && !context.registered
      ? { audience: "rider", screen: "onboarding" }
      : null;
  const open = openAppKeyboard(config, tr("miniapp.open_button"), target);
  if (command === "/start" || command === "/help") {
    const intro =
      command === "/help"
        ? tr(
            context.audience === "driver"
              ? "miniapp.entry.help_driver"
              : "miniapp.entry.help_rider",
          )
        : tr(
            context.audience === "driver"
              ? "miniapp.entry.welcome_driver"
              : "miniapp.entry.welcome_rider",
          );
    return [
      { chatId: context.chatId, text: intro, keyboard: basicMenuKeyboard(context.language) },
      { chatId: context.chatId, text: tr("miniapp.entry.open_prompt"), keyboard: open },
    ];
  }
  return [{ chatId: context.chatId, text: tr("miniapp.entry.open_prompt"), keyboard: open }];
}

/** ردُّ أمرٍ انتقلَ: رسالةٌ واحدةٌ بزرٍّ يفتحُ شاشتَه. */
export function movedReplies(
  config: MiniAppSurfaceConfig,
  chatId: string,
  language: string,
  target: MiniAppTarget,
): readonly BotReply[] {
  const tr = t(language);
  return [
    {
      chatId,
      text: tr("miniapp.entry.moved"),
      keyboard: openAppKeyboard(config, tr("miniapp.open_button"), target),
    },
  ];
}

/**
 * أوامرُ `setMyCommands` في وضعِ التطبيقِ: `/start` و`/app` و`/help`، والأوامرُ التي ما زالَ
 * موطنُها البوتَ. الأوامرُ المنتقلةُ لا تُعلَنُ — وتبقى مفهومةً إن كُتِبَت (تُجابُ بزرِّ التطبيقِ).
 * والوصفُ مفتاحُ القائمةِ القائمِ نفسُه بلاحقةِ `.description` — لا نصَّ ثانياً يتباعد.
 */
export function surfaceCommandsFor(
  audience: BotAudience,
  language: string,
): readonly { readonly command: string; readonly description: string }[] {
  const tr = t(language);
  const homes = COMMAND_HOMES[audience];
  const kept = allItemsFor(audience)
    .filter((item) => homes[item.command]?.home === "bot")
    .map((item) => ({
      command: item.command.slice(1),
      description: tr(`${item.key}.description`),
    }));
  return [
    { command: "start", description: tr("menu.start.description") },
    { command: "app", description: tr("miniapp.command.app.description") },
    ...kept,
    { command: "help", description: tr("menu.help.description") },
  ];
}

/**
 * ما تحتاجُه الطبقةُ الخفيفةُ من العالمِ — قراءاتٌ قائمةٌ في تبعيّاتِ الحوارِ نفسِها، لا منافذُ
 * جديدةٌ. كلُّ قراءةٍ تُخفِقُ يعودُ برسالةِ عطلٍ صريحةٍ بلا عملٍ خلفيٍّ: الطبقةُ لا تُنفِّذُ
 * عملاً ولا تُمرِّرُ إلى الحوارِ القديمِ حين تتعذّرُ القراءةُ (`ADR 0286`).
 */
export interface SurfacePorts {
  readonly sessions: SessionStore;
  readonly initialState: DialogState;
  /** `true`/`false` — أو `null` إن تعذّرت القراءةُ. */
  isRegistered(telegramUserId: string): Promise<boolean | null>;
  /** طلباتُ الراكبِ النشطةُ لحلِّ `active_ride` — للسائقِ لا تُنادى. */
  activeOrdersOf?(telegramUserId: string): Promise<readonly ActiveOrderSummary[] | null>;
  /** ما يجبُ أن يحدثَ عند كلِّ `/start` في أيِّ وضعٍ (ترقيةُ المسؤولِ الأوّلِ — `ADR 0212`). */
  onStart?(telegramUserId: string): Promise<void>;
  /**
   * `NEG-SELECT-01` — هل صاحبُ الرسالةِ في محادثةِ تفاوضٍ مفتوحةٍ الآنَ؟ النصُّ الحرُّ عندئذٍ
   * رسالةٌ للطرفِ الآخرِ لا طلبُ دخولٍ إلى التطبيقِ — فيمضي إلى الحوارِ القديمِ الذي يُمرِّرُه.
   * تمريرُ نصٍّ بين طرفَينِ تفاوضٍ ليس عملاً تجاريّاً يُنفَّذُ خلفيّاً (`ADR 0286` يوثّقُه
   * استثناءً: قناةُ تواصلٍ لا قرارَ فيها). `null` ⇒ تعذّرت القراءةُ (يمضي للقديمِ أيضاً).
   */
  inNegotiation?(telegramUserId: string): Promise<boolean | null>;
}

/**
 * نقطةُ الدخولِ — تلفُّ الحوارَ القديمَ. في وضعِ `legacy` تُمرِّرُ كلَّ شيءٍ حرفاً — وهو وضعُ
 * اختبارِ توافقٍ معزولٌ لا يُقبلُ في تشغيلٍ فعليٍّ (`ADR 0286`).
 *
 * `legacy` دالّةٌ لا ردودٌ محسوبةٌ: لا يُحسَبُ الحوارُ القديمُ إلّا إن قرّرَ السطحُ ذلك، فلا
 * تُكتَبُ جلسةٌ ولا يُقرأُ دليلٌ لتحديثٍ خدمَه التطبيقُ.
 */
export async function handleSurfaceUpdate(
  audience: BotAudience,
  update: IncomingUpdate,
  config: MiniAppSurfaceConfig,
  ports: SurfacePorts,
  legacy: () => Promise<readonly BotReply[]>,
): Promise<readonly BotReply[]> {
  if (config.mode === "legacy") return legacy();
  // `ADR 0286` — لا سقوطَ صامتَ إلى الحوارِ القديمِ حينَ ينقصُ عنوانُ التطبيقِ: الضبطُ
  // يمنعُ الإقلاعَ أصلًا، وهنا حائطٌ لا بابٌ — خطأٌ صريحٌ لا مسارُ أعمالٍ في المحادثةِ.
  if (config.miniAppUrl === null) {
    throw new Error("MINIAPP_URL_MISSING: سطحُ miniapp بلا عنوانِ تطبيقٍ — لا مسارَ أعمالٍ");
  }
  const decision = decideSurface(audience, update);
  // لا انتظارَ قبلَ هذا السطرِ — انظر `decideSurface`.
  if (decision.kind === "legacy") return legacy();

  const telegramUserId = update.from.telegramUserId;
  const chatId = update.from.chatId;
  const stored = await ports.sessions.load(telegramUserId);
  if (!stored.ok) {
    // `ADR 0286` — تعذُّرُ القراءةِ لا يفتحُ مسارَ أعمالٍ في المحادثةِ: ردُّ عطلٍ صريحٌ
    // لا تنفيذَ خلفيّاً ولا سقوطٌ إلى الحوارِ القديمِ.
    return [{ chatId, text: t("ar")("common.error_try_again"), keyboard: null }];
  }
  const state = stored.value ?? ports.initialState;
  const language = state.language;

  if (decision.kind === "app_button") {
    // `ADR 0286` — زرُّ عملٍ قديمٌ: توجيهٌ لا تنفيذٌ. السائقُ إلى لوحِ عروضِه والراكبُ إلى
    // رحلتِه النشطةِ، وبإصبعِه يُتمُّ العملَ في التطبيقِ حيثُ يُتحقَّقُ من ملكيّتِه.
    return movedReplies(
      config,
      chatId,
      language,
      resolveTarget(audience, audience === "driver" ? "offers" : "home", []),
    );
  }

  if (decision.kind === "free_text") {
    // التفاوضُ المفتوحُ أولًا: نصٌّ بين طرفَينِ تفاوضٍ رسالةُ تمريرٍ لا أمرُ دخولٍ.
    if (ports.inNegotiation !== undefined) {
      const negotiating = await ports.inNegotiation(telegramUserId);
      if (negotiating === null) {
        return [{ chatId, text: t(language)("common.error_try_again"), keyboard: null }];
      }
      if (negotiating) return legacy();
    }
    // `ADR 0286` — حوارٌ جارٍ لا يُستكمَلُ في المحادثةِ: يُصفَّرُ إلى الخمولِ ويُوجَّهُ صاحبُه
    // إلى التطبيقِ. لا عملَ يتّمُّ هنا، ولا يُطوى نصُّ خطوتِه في جلسةٍ تنتظرُ جواباً ميّتاً.
    if (freeTextBelongsToDialog(state)) {
      const reset = await ports.sessions.save(telegramUserId, { ...state, step: "idle" });
      if (!reset.ok) {
        return [{ chatId, text: t(language)("common.error_try_again"), keyboard: null }];
      }
      return movedReplies(config, chatId, language, resolveTarget(audience, "home", []));
    }
    const registered = await ports.isRegistered(telegramUserId);
    if (registered === null) {
      return [{ chatId, text: t(language)("common.error_try_again"), keyboard: null }];
    }
    return entryReplies(config, { audience, chatId, language, registered }, "/app");
  }

  if (decision.kind === "entry") {
    const registered = await ports.isRegistered(telegramUserId);
    if (registered === null) {
      return [{ chatId, text: t(language)("common.error_try_again"), keyboard: null }];
    }
    // `ADR 0286` — تسجيلُ السائقِ في التطبيقِ: `POST /v1/onboarding/driver` يقرأُ إثباتَ
    // الرقمِ من بطاقةِ الاتصالِ (`PRD-105`)، والتطبيقُ يوجّهُ غيرَ المسجَّلِ إلى سطحِ التسجيلِ.
    if (decision.command === "/start" && ports.onStart !== undefined) {
      await ports.onStart(telegramUserId);
    }
    return entryReplies(config, { audience, chatId, language, registered }, decision.command);
  }

  let active: readonly ActiveOrderSummary[] = [];
  if (audience === "rider" && decision.screen === "active_ride") {
    const read = (await ports.activeOrdersOf?.(telegramUserId)) ?? null;
    if (read === null) {
      return [{ chatId, text: t(language)("common.error_try_again"), keyboard: null }];
    }
    active = read;
  }
  return movedReplies(config, chatId, language, resolveTarget(audience, decision.screen, active));
}
