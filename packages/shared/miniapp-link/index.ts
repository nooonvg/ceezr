/**
 * الغرض: قواعدُ رابطِ الدخولِ إلى التطبيقِ المصغَّرِ — **مصدرُ حقيقةٍ واحدٌ** يبني منه البوتانِ
 *   والعاملُ أزرارَ «افتح في وَصْلة»، ويقرأ منه التطبيقُ المصغَّرُ الشاشةَ التي يهبطُ عليها
 *   (`ADR 0213` · `DEC-22`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/shared/miniapp-link
 * يُتوقع أن يستخدمه لاحقاً: packages/application/bots · packages/infrastructure/notification ·
 *   apps/miniapp/src/routing
 *
 * ## لماذا ملفٌّ واحدٌ يكتبُ ويقرأ
 *
 * الرابطُ عقدٌ بين طرفَين يُنشَران منفصلَين (البوّابةُ والأصولُ الثابتة). لو كتبَ البوتُ
 * صيغةً وقرأ التطبيقُ صيغةً أخرى لانكسرَ الهبوطُ صامتاً: يفتحُ المستخدمُ الزرَّ فيرى
 * الشاشةَ الرئيسةَ لا عرضَه. فالكاتبُ والقارئُ دالّتانِ متجاورتانِ، واختبارُ الذهابِ
 * والإيابِ يحرسُ تطابقَهما.
 *
 * ## الصيغةُ
 *
 * `<screen>` أو `<screen>_<id>` — والحروفُ ضمنَ `[A-Za-z0-9_-]` بطولٍ لا يتجاوزُ ٦٤، وهي
 * القيودُ نفسُها التي يفرضُها تيليجرامُ على `start_param`؛ فالصيغةُ صالحةٌ اليومَ في معاملِ
 * `open` لرابطِ زرِّ `web_app`، وصالحةٌ غداً في `startapp` بلا تحويلٍ.
 *
 * ## ما لا يعنيه الرابطُ
 *
 * **الرابطُ ملاحةٌ لا صلاحيّة.** وجودُ `offer_<id>` في العنوانِ لا يمنحُ حاملَه العرضَ؛
 * كلُّ شاشةٍ تسألُ الخادمَ بجلستِها الموقّعةِ، والخادمُ يفحصُ الملكيّةَ (`check-object-authorization`).
 * ولذلك يجوزُ للتطبيقِ أن يقرأه من عنوانِ الصفحةِ ولا يُعَدُّ ذلك ثقةً بمدخلٍ غيرِ موقَّعٍ.
 */

export type MiniAppAudience = "rider" | "driver";

/** الشاشاتُ التي يُهبَطُ عليها بلا معرِّفٍ. */
const PLAIN_SCREENS = {
  rider: ["home", "history", "support", "notifications", "account", "sos", "onboarding"],
  driver: [
    "offers",
    "job",
    "subscription",
    "activity",
    "vehicle",
    "documents",
    "support",
    "account",
  ],
} as const satisfies Record<MiniAppAudience, readonly string[]>;

/** الشاشاتُ التي تحتاجُ معرِّفَ كائنٍ. */
const ID_SCREENS = {
  rider: ["ride", "summary"],
  driver: ["offer", "summary"],
} as const satisfies Record<MiniAppAudience, readonly string[]>;

export type RiderPlainScreen = (typeof PLAIN_SCREENS.rider)[number];
export type DriverPlainScreen = (typeof PLAIN_SCREENS.driver)[number];
export type RiderIdScreen = (typeof ID_SCREENS.rider)[number];
export type DriverIdScreen = (typeof ID_SCREENS.driver)[number];

export type MiniAppTarget =
  | { readonly audience: "rider"; readonly screen: RiderPlainScreen }
  | { readonly audience: "rider"; readonly screen: RiderIdScreen; readonly id: string }
  | { readonly audience: "driver"; readonly screen: DriverPlainScreen }
  | { readonly audience: "driver"; readonly screen: DriverIdScreen; readonly id: string };

/** اسمُ معاملِ الاستعلامِ الذي يحملُ الهدفَ في رابطِ زرِّ `web_app`. */
export const MINIAPP_TARGET_PARAM = "open";

/** حدُّ تيليجرام لـ`start_param` — ويُلتزَم به في `open` أيضاً ليبقى الرمزُ واحداً. */
export const MINIAPP_TARGET_MAX_LENGTH = 64;

/** المعرِّفاتُ عندنا `uuid` — فالمسموحُ حروفٌ ست عشريّةٌ وشرطةٌ فقط. */
const ID_PATTERN = /^[0-9a-fA-F-]{1,56}$/;
const SCREEN_PATTERN = /^[a-z]{1,16}$/;

function isPlain(audience: MiniAppAudience, screen: string): boolean {
  return (PLAIN_SCREENS[audience] as readonly string[]).includes(screen);
}

function isIdScreen(audience: MiniAppAudience, screen: string): boolean {
  return (ID_SCREENS[audience] as readonly string[]).includes(screen);
}

/** يرمّزُ الهدفَ نصّاً. يرمي على معرِّفٍ خارجَ الصيغةِ: ذاك خطأُ برمجةٍ لا مدخلُ مستخدمٍ. */
export function encodeMiniAppTarget(target: MiniAppTarget): string {
  if (!("id" in target)) return target.screen;
  if (!ID_PATTERN.test(target.id)) {
    throw new Error(`MINIAPP_TARGET_ID_INVALID: ${target.screen}`);
  }
  const encoded = `${target.screen}_${target.id}`;
  if (encoded.length > MINIAPP_TARGET_MAX_LENGTH) {
    throw new Error(`MINIAPP_TARGET_TOO_LONG: ${target.screen}`);
  }
  return encoded;
}

/**
 * يفكُّ نصّاً إلى هدفٍ **لهذا الجمهورِ** — أو `null`.
 *
 * `null` ليست خطأً يُعرَض: هي «لا هدفَ»، فيهبطُ التطبيقُ على شاشةِ الجمهورِ الأولى. ورابطُ
 * سائقٍ يُفتَحُ في سطحِ راكبٍ `null` أيضاً — لا يُحوَّلُ ولا يُخمَّن.
 */
export function decodeMiniAppTarget(
  raw: string | null | undefined,
  audience: MiniAppAudience,
): MiniAppTarget | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MINIAPP_TARGET_MAX_LENGTH) {
    return null;
  }
  const separator = raw.indexOf("_");
  const screen = separator === -1 ? raw : raw.slice(0, separator);
  if (!SCREEN_PATTERN.test(screen)) return null;
  if (separator === -1) {
    return isPlain(audience, screen) ? ({ audience, screen } as MiniAppTarget) : null;
  }
  const id = raw.slice(separator + 1);
  if (!ID_PATTERN.test(id) || !isIdScreen(audience, screen)) return null;
  return { audience, screen, id } as MiniAppTarget;
}

/**
 * يبني رابطَ زرِّ `web_app`: أصلُ التطبيقِ + `?open=<target>`.
 *
 * الأصلُ يجبُ أن يكونَ `https`: تيليجرامُ يرفضُ غيرَه في `web_app`، ورفضُه يُسقِطُ الرسالةَ
 * كلَّها لا الزرَّ وحدَه — فيُرفَضُ هنا قبلَ أن يصيرَ إشعاراً ضائعاً.
 */
export function miniAppUrl(base: string, target: MiniAppTarget | null): string {
  const url = new URL(base);
  if (url.protocol !== "https:") throw new Error("MINIAPP_URL_NOT_HTTPS");
  if (target !== null) url.searchParams.set(MINIAPP_TARGET_PARAM, encodeMiniAppTarget(target));
  return url.toString();
}

/**
 * `ADR 0286` — رابطُ فتحِ التطبيقِ من **خارجَ المحادثاتِ الخاصةِ**: تيليجرامُ يقصرُ زرَّ
 * `web_app` على المحادثاتِ الخاصةِ ([Bot API](https://core.telegram.org/bots/api#inlinekeyboardbutton))،
 * فبطاقةُ القروبِ — إشعارٌ لا مسارَ عملٍ — تحملُ زرَّ رابطٍ يفتحُ التطبيقَ عبرَ معاملِ
 * `startapp` نفسِهِ الذي يُبَثُّ داخلَ `initData` الموقَّعِ (`start_param`) فتقرؤه الشاشةُ
 * من التبادلِ الموثَّقِ لا من ضميمةٍ خام. والترميزُ هو ترميزُ `open` بلا تحويلٍ.
 */
export function startappDeepLink(botUsername: string, target: MiniAppTarget | null): string {
  if (!/^@?[A-Za-z0-9_]{4,32}$/.test(botUsername)) {
    throw new Error(`MINIAPP_BOT_USERNAME_INVALID: ${botUsername.slice(0, 8)}`);
  }
  const username = botUsername.startsWith("@") ? botUsername.slice(1) : botUsername;
  const encoded = target === null ? "" : encodeMiniAppTarget(target);
  return encoded === ""
    ? `https://t.me/${username}`
    : `https://t.me/${username}?startapp=${encoded}`;
}

/** يقرأ الهدفَ من سلسلةِ استعلامِ صفحةِ التطبيقِ (`location.search`). */
export function targetFromSearch(search: string, audience: MiniAppAudience): MiniAppTarget | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return decodeMiniAppTarget(params.get(MINIAPP_TARGET_PARAM), audience);
}

/** كلُّ الشاشاتِ المعلنةِ لجمهورٍ — لاختبارِ الذهابِ والإيابِ ولحارسِ السطحِ. */
export function declaredScreens(audience: MiniAppAudience): {
  readonly plain: readonly string[];
  readonly withId: readonly string[];
} {
  return { plain: PLAIN_SCREENS[audience], withId: ID_SCREENS[audience] };
}
