/**
 * الغرض: سِجلُّ سياسةِ تحديدِ المعدَّلِ **المغلقُ** — لكلِّ مسارٍ في البوّابةِ صنفُ
 *   كشفِه، وحدُّه إن كانَ محدوداً، أو إعفاؤُه بسببٍ مكتوبٍ ومالكٍ. وهوَ **مصدرُ
 *   الحقيقةِ الواحدُ**: منه يقرأُ موضعُ التركيبِ أرقامَ الحدودِ، وبه يُطابِقُ
 *   الحاجزُ المساراتِ المُكتشَفةَ من الشيفرةِ.
 * الحالة: منفّذ فعلياً — `SEC-07` (ADR 0139).
 * ينتمي إلى: apps/gateway/src/rate-limit
 * يُستخدَمُ من: apps/gateway/src/index.ts (أرقامُ الحدودِ) ·
 *   scripts/check-rate-limit-coverage.ts (المطابقةُ) ·
 *   tests/unit/check-rate-limit-coverage.test.ts · tests/unit/rate-limit-enforced.test.ts
 * يحرسُه: `scripts/check-rate-limit-coverage.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ سِجلٌّ في التطبيقِ لا قائمةٌ في وثيقةٍ ولا في `scripts/`
 *
 * لأنَّ حدَّاً مكتوباً في وثيقةٍ ورقماً مكتوباً في `index.ts` **موضعا حقيقةٍ**:
 * يُغيَّرُ أحدُهما ويُنسى الآخرُ، فيُقرأُ العهدُ غيرَ ما يُنفَّذُ. فالأرقامُ ههنا
 * **تُستوردُ في موضعِ التركيبِ استيراداً**، والحاجزُ يقرأُ الملفَّ عينَه. ومَن
 * غيَّرَ حدَّاً غيَّرَه في موضعٍ واحدٍ ورآهُ الحاجزُ والمُشغِّلُ معاً.
 *
 * ## ولِمَ يُصنَّفُ **كلُّ** مسارٍ لا المكشوفُ وحدَه
 *
 * لأنَّ «المكشوفُ» ليسَ صفةً تُقرأُ من المسارِ نفسِه: مَن حكمَ على مسارٍ أنَّه
 * مُصادَقٌ فأسقطَه من السِجلِّ **لم يُسجِّلْ حكمَه فلا يُراجَعُ**، ولو زالَ الشرطُ
 * من الحارسِ لبقيَ المسارُ خارجَ السِجلِّ صامتاً. فكلُّ مسارٍ مُصنَّفٌ، والصنفُ
 * **مُعلَنٌ نصّاً** يُقرأُ ويُخالَفُ.
 *
 * ## أصنافُ الكشفِ ولِمَ ثلاثةٌ منها يجبُ أن تكونَ محدودةً
 *
 * - **قبلَ المصادقةِ**: المُنادي لا يحملُ جلسةً بعدُ — فلا مفتاحَ إلّا عنوانُه.
 *   وكلُّ نداءٍ يستهلكُ تحقُّقاً تشفيريّاً أو كتابةَ قاعدةٍ **قبلَ** أن يُعرَفَ مَن
 *   هو. هذا هوَ بعينِه ما يجبُ أن يُحَدَّ.
 * - **ويبهوكٌ موقَّعٌ**: السرُّ حاجزٌ قائمٌ، **والسرُّ لا يَحُدُّ**: مَن لا يعرفُه
 *   يُرَدُّ بعدَ حسابِ توقيعٍ لكلِّ نداءٍ، ومَن يعرفُه يُغرِقُ بلا حدٍّ.
 * - **رمزُ مشاركةٍ عامٌّ**: الرمزُ في وُصلةٍ تُرسَلُ في محادثةٍ — فهوَ عامٌّ
 *   بطبيعتِه، ومَن ناله يستطيعُ أن يستطلعَ الموقعَ بلا انقطاعٍ.
 *
 * وثلاثةُ أصنافٍ **لا يُوجَبُ** فيها حدٌّ في هذا الضابطِ، وسببُ كلٍّ مكتوبٌ ههنا
 * مرّةً لا في تسعينَ مدخلاً:
 *
 * - **مُصادَقٌ بجلسةٍ** و**مُصادَقٌ بجلسةِ مسؤولٍ**: المفتاحُ الطبيعيُّ جلسةٌ
 *   موقَّعةٌ منّا، والإصدارُ نفسُه محدودٌ (`قبلَ المصادقةِ`)، فحدُّ البابِ الأوّلِ
 *   يَحُدُّ ما بعدَه. **وما لا يُدَّعى** (`ح-5`): هذا **لا يمنعُ** صاحبَ جلسةٍ
 *   واحدةٍ من إغراقِ مسارٍ مُصادَقٍ، وتلكَ فجوةٌ مُسمّاةٌ لا مسكوتٌ عنها — ومَن
 *   أرادَ إغلاقَها يُحَدُّ بمفتاحِ الجلسةِ كما في `POST /v1/driver/location`.
 * - **فحصُ تشغيلٍ**: `/health` و`/ready` يُناديهما مِسبارُ المُنسِّقِ كلَّ ثوانٍ،
 *   **وحدٌّ عليهما يُسقِطُ المثيلَ من الخدمةِ بلا علّةٍ** — أي يُحوِّلُ الحمايةَ إلى
 *   سببِ انقطاعٍ. و`/metrics` يقرؤُه جامعُ المقاييسِ بالدوريّةِ نفسِها.
 *
 * ## وما لا يفعلُه هذا السِجلُّ عن قصدٍ
 *
 * - **لا يُنفِّذُ حدَّاً**: التنفيذُ في `fixed-window.ts` والتركيبُ في `index.ts`.
 *   وسِجلٌّ يُقرأُ إعلاناً لا إنفاذاً — ولذلكَ يُقاسُ الإنفاذُ **بخادمٍ حقيقيٍّ**
 *   في `tests/unit/rate-limit-enforced.test.ts` لا بوجودِ هذا الملفِّ.
 * - **لا يُدَّعى أنَّه حمايةٌ من الحجبِ الموزَّعِ** (`DDoS`): عدَّادٌ داخلَ الخدمةِ
 *   يَحُدُّ مُنادياً واحداً، وحمايةُ الحافةِ عملٌ آخرُ غيرُ منفَّذٍ ولا مُدَّعى.
 * - **لا يقرأُ ضبطاً ولا بيئةً**: أرقامُ الحدودِ **حدودٌ تقنيّةٌ لا تجاريّةٌ**، فلا
 *   موضعَ لها في `platform_settings` (كما في `index.ts` قبلَ هذا الضابطِ).
 */

/** أصنافُ الكشفِ — معجمٌ **مغلقٌ**: صنفٌ من غيرِها خرقٌ يُسقِطُ البناءَ. */
export const EXPOSURE_CLASSES = [
  "قبلَ المصادقةِ",
  "ويبهوكٌ موقَّعٌ",
  "رمزُ مشاركةٍ عامٌّ",
  "مُصادَقٌ بجلسةٍ",
  "مُصادَقٌ بجلسةِ مسؤولٍ",
  "فحصُ تشغيلٍ",
] as const;
export type ExposureClass = (typeof EXPOSURE_CLASSES)[number];

/** الأصنافُ التي **يجبُ** فيها حدٌّ أو إعفاءٌ مكتوبٌ — لا ثالثَ. */
export const LIMIT_REQUIRED_EXPOSURES: readonly ExposureClass[] = [
  "قبلَ المصادقةِ",
  "ويبهوكٌ موقَّعٌ",
  "رمزُ مشاركةٍ عامٌّ",
];

/**
 * أبعادُ مفتاحِ الحدِّ — معجمٌ مغلقٌ. والبعدُ ليسَ تفصيلاً: حدٌّ بمفتاحٍ يملكُه
 * المهاجمُ (عنوانٌ يُبدَّلُ) أضعفُ من حدٍّ بمفتاحٍ نُصدِرُه نحنُ، **وذاكَ يُقالُ
 * صريحاً** في كلِّ مدخلٍ لا يُخفى في رقمٍ.
 */
export const KEY_DIMENSIONS = [
  "عنوانُ العميلِ",
  "جلسةٌ موقَّعةٌ منّا",
  "مستخدمُ تيليجرامَ",
  "رمزُ المشاركةِ",
] as const;
export type KeyDimension = (typeof KEY_DIMENSIONS)[number];

/**
 * البادئاتُ العامّةُ المعروفةُ. **وقاعدةٌ لا تجميلٌ**: مسارٌ لا يبدأُ بواحدةٍ منها
 * إمّا مُركَّبٌ على الجِذرِ خطأً وإمّا سطحٌ لم يُقرَّرْ له مكانٌ — وأوّلُ ما كشفَه
 * هذا الحاجزُ كانَ `GET /` و`PATCH /` و`POST /assets` وهيَ مساراتُ مركبةِ السائقِ
 * رُكِّبَت على الجِذرِ سهواً بينما شاشتُها تُنادي `/v1/driver/vehicle` فتُجابُ
 * `404` (`ADR 0139`).
 */
export const PUBLIC_PATH_PREFIXES = [
  // `LOAD-01 Recovery` — سطحُ الخدمةِ الداخليِّ (سرٌّ مشتركٌ بينَ العاملِ
  // والبوابةِ، لا عميلَ): بادئةٌ معلَنةٌ كي لا يُرفَدَ مسارُها كمسارٍ رُكِّبَ
  // سهوًا على الجذرِ — والتصنيفُ في السِجلِّ هوَ الحاجزَ لا البادئةَ وحدها.
  "/internal/",
  "/v1/",
  "/webhook/",
  "/admin",
  "/track/",
  "/api/",
  "/health",
  "/ready",
  "/metrics",
] as const;

/** حدٌّ واحدٌ مُعلَنٌ: رقمُه ونافذتُه وبُعدُ مفتاحِه وموضعُ تركيبِه. */
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly keyDimension: KeyDimension;
  /**
   * موضعُ التركيبِ: `<ملفٌّ>:<نصٌّ يوجدُ فيه>`. والحاجزُ **يقرأُ الملفَّ ويطلبُ
   * النصَّ** — فإعلانُ حدٍّ بلا تركيبٍ يُسقِطُ البناءَ، إذ سِجلٌّ يُعلِنُ حدَّاً لا
   * مُنفِّذَ له أسوأُ من سِجلٍّ يقولُ «لا حدَّ»: الأوّلُ يُقرأُ حمايةً.
   */
  readonly wiredIn: string;
  /** لِمَ هذا الرقمُ بعينِه — لا «حدٌّ معقولٌ». */
  readonly rationale: string;
}

/** إعفاءٌ: سببٌ مكتوبٌ ومالكٌ. ولا إعفاءَ بلا مُنفِّذٍ بديلٍ مُسمّىً. */
export interface RateLimitExemption {
  readonly reason: string;
  readonly owner: string;
}

export interface RoutePolicy {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly file: string;
  readonly exposure: ExposureClass;
  readonly limits: readonly RateLimitPolicy[];
  readonly exemption: RateLimitExemption | null;
}

const REPO_EXECUTOR = "منفّذ المستودع";

/**
 * سِجلُّ سياسةِ المساراتِ. **مُطابَقٌ بالشيفرةِ في الحدَّينِ**: مسارٌ مُكتشَفٌ بلا
 * مدخلٍ يُسقِطُ البناءَ، ومدخلٌ لا مسارَ له يُسقِطُ البناءَ.
 */
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    method: "GET",
    path: "/admin/api/overview",
    file: "apps/gateway/src/routes/admin-api.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/api/live-orders",
    file: "apps/gateway/src/routes/admin-api.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/api/heatmap",
    file: "apps/gateway/src/routes/admin-api.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/api/search",
    file: "apps/gateway/src/routes/admin-api.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/api/cities",
    file: "apps/gateway/src/routes/admin-api.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/api/live/drivers",
    file: "apps/gateway/src/routes/admin-live.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/login",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [],
    exemption: {
      reason:
        "صفحةُ نموذجٍ ساكنةٌ: لا كتابةَ قاعدةٍ ولا حسابَ توقيعٍ ولا سرَّ يُجرَّبُ — ونداؤُها ألفَ مرّةٍ يُنتِجُ ألفَ صفحةٍ من الذاكرةِ. **والمُنفِّذُ البديلُ للفعلِ الذي تليه** قائمٌ: طلبُ الرمزِ وتحقُّقُه محدودانِ في القاعدةِ، فالحدُّ على الصفحةِ يحمي بايتاتٍ لا يحمي حسابًا. **وما لا يُدَّعى** (`ح-5`): لا حدَّ حافةٍ على هذه الصفحةِ، والحمايةُ من إغراقِ البايتاتِ عملُ حافةٍ لا عملُ عدَّادٍ.",
      owner: REPO_EXECUTOR,
    },
  },

  {
    method: "POST",
    path: "/admin/login/code",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [],
    exemption: {
      reason:
        "محدودٌ **في القاعدةِ لا في الذاكرةِ**: `consume/issue` يُنفِّذُ `ADMIN_CODE_MAX_PER_WINDOW = 5` في `ADMIN_CODE_WINDOW_SECONDS = 3600` لكلِّ هويّةٍ (`apps/gateway/src/admin/auth.ts`) — وذاكَ **أقوى من حدِّ عدَّادٍ**: يصمدُ لكلِّ المثيلاتِ ولإعادةِ التشغيلِ ولانقطاعِ Redis، ومفتاحُه هويّةٌ لا عنوانٌ يُبدَّلُ. **وما لا يُدَّعى**: مَن هَمَرَ بمعرّفاتٍ عشوائيّةٍ يُنتِجُ استفساراً لكلِّ نداءٍ (لا رمزاً ولا رسالةً)، وحدُّ الحافةِ على ذلكَ غيرُ منفَّذٍ ولا مُدَّعى.",
      owner: REPO_EXECUTOR,
    },
  },

  {
    method: "POST",
    path: "/admin/login/verify",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [],
    exemption: {
      reason:
        "محدودٌ **في القاعدةِ**: `consume_admin_login_code` يُنفِّذُ حدَّ محاولاتٍ لكلِّ رمزٍ فيُبطِلُه عندَ استنفادِها، فتخمينُ رقمٍ من ستّةِ أرقامٍ لا يُستنفَدُ بإعادةِ المحاولةِ — والحدُّ **مقترنٌ بالسِرِّ المُخمَّنِ** لا بالعنوانِ، فتبديلُ العنوانِ لا يُعيدُ المحاولاتِ. **وما لا يُدَّعى**: طلبُ رموزٍ جديدةٍ بلا حدٍّ محدودٌ بالمدخلِ الذي قبلَه لا بهذا.",
      owner: REPO_EXECUTOR,
    },
  },

  {
    method: "POST",
    path: "/admin/login/break-glass",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [
      {
        limit: 10,
        windowSeconds: 3600,
        keyDimension: "عنوانُ العميلِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/admin/login/break-glass", "عنوانُ العميلِ")',
        rationale:
          "بلا كعكةٍ ولا هويةٍ، والاسمُ المجهولُ لا صفَّ لهُ في القاعدةِ فلا يلمسُهُ إقفالُها — فبلا حدٍّ على العنوانِ يبقى همْرُ الأسماءِ العشوائيّةِ بلا حصرٍ، وكلُّ نداءٍ يستهلكُ scryptًا قبلَ أن يُعرَفَ أحدٌ. عشرةٌ في الساعةِ فوقَ ما يحتاجُهُ مسؤولٌ صادقٌ يُخِطّئُ الرمزَ مرّتَينِ وثلاثًا في نافذةِ إقفالِ القاعدةِ (ربعُ ساعةٍ)، وتحتَ ما يُتاحُ لهادمٍ يَعدُّ الأسماءَ. **طبقتانِ لا طبقةٌ واحدةٌ**: هذا العدّادُ في الذاكرةِ يحدُّ العنوانَ، وإقفالُ القاعدةِ (خمسُ فشلاتٍ ثمَّ ربعُ ساعةٍ في صفِّ الاعتمادِ) يحدُّ السرَّ ويصمدُ لإعادةِ التشغيلِ — فتبديلُ العنوانِ يُعيدُ الهمْرَ ولا يُعيدُ المحاولاتِ على اعتمادٍ واحدٍ (`SEC-21` · ADR 0176).",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/break-glass",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/break-glass",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/break-glass/disable",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },
  {
    method: "POST",
    path: "/admin/logout",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/live-orders",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/live-map",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/drivers",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/drivers/:id",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/drivers/:id/documents/:docType",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/attendance",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/ratings",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/disputes",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/heatmap",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/settings",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/payments",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/broadcast",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/broadcast",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/broadcast/:batchId/cancel",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/messages",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/messages/:id/send",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/drivers/:id/verification",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/drivers/:id/documents/:docType/review",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/users/:id/revoke-sessions",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/ratings/:id/flag",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/disputes/:id/close",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/live-orders/:id/revoke-tracking",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/users/:id/blocked",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/users/:id/recovery",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/recovery/:requestId/review",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/admin/recovery",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/settings/:cityId/group-ids",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/admin/settings/:cityId/:key",
    file: "apps/gateway/src/routes/admin-ui.ts",
    exposure: "مُصادَقٌ بجلسةِ مسؤولٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/consents",
    file: "apps/gateway/src/routes/consents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/consents",
    file: "apps/gateway/src/routes/consents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/webhook/core-events",
    file: "apps/gateway/src/routes/core-event-intake.ts",
    exposure: "ويبهوكٌ موقَّعٌ",
    limits: [
      {
        limit: 600,
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/webhook/core-events", "عنوانُ العميلِ")',
        rationale:
          "بابُ أحداثِ `CORE` يستقبلُ دفعاتٍ لا نداءاتٍ متفرّقةً، وجدولُ إعادتِه يقرأُ `429` تأجيلاً مشروعاً (لا موتاً كسائرِ `4xx`) — فالحدُّ ههنا **لا يُفقِدُ حدثاً** بل يُؤجِّلُه. وستُّمئةٍ في الدقيقةِ عشرةٌ في الثانيةِ: فوقَ أيِّ دفعةٍ قِيسَت، وتحتَ ما يُشبِعُ بِركةَ الاتّصالاتِ.",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/destinations/search",
    file: "apps/gateway/src/routes/destinations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/destinations/resolve",
    file: "apps/gateway/src/routes/destinations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/activity",
    file: "apps/gateway/src/routes/driver-activity.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/activity/entries",
    file: "apps/gateway/src/routes/driver-activity.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/documents/upload-url",
    file: "apps/gateway/src/routes/driver-documents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/documents",
    file: "apps/gateway/src/routes/driver-documents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/documents/submit",
    file: "apps/gateway/src/routes/driver-documents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/documents",
    file: "apps/gateway/src/routes/driver-documents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },
  {
    method: "GET",
    path: "/v1/driver/documents/:docType/read-url",
    file: "apps/gateway/src/routes/driver-documents.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/orders/:orderId/chat",
    file: "apps/gateway/src/routes/order-chat.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/orders/:orderId/chat/messages",
    file: "apps/gateway/src/routes/order-chat.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/orders/:orderId/chat/read",
    file: "apps/gateway/src/routes/order-chat.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/job",
    file: "apps/gateway/src/routes/driver-job.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/job/:orderId/arrived",
    file: "apps/gateway/src/routes/driver-job.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/job/:orderId/start",
    file: "apps/gateway/src/routes/driver-job.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/job/:orderId/complete",
    file: "apps/gateway/src/routes/driver-job.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/job/:orderId/cannot-complete",
    file: "apps/gateway/src/routes/driver-job.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/location",
    file: "apps/gateway/src/routes/driver-location.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [
      {
        limit: 30,
        windowSeconds: 10,
        keyDimension: "جلسةٌ موقَّعةٌ منّا",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/v1/driver/location", "جلسةٌ موقَّعةٌ منّا")',
        rationale:
          "قائمٌ قبلَ هذا الضابطِ ونُقِلَ رقمُه ههنا بلا تغييرٍ: نبضةُ موقعٍ من جلسةٍ **موقَّعةٍ منّا** لا من عنوانٍ يُنتحَلُ، والحدُّ بعدَ إثباتِ الجلسةِ وقبلَ قراءةِ الجسمِ. وهوَ **مثالُ إغلاقِ فجوةِ المُصادَقِ**: مسارٌ مُصادَقٌ يُحَدُّ بمفتاحِ جلستِه متى كانَ ساخناً.",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/offers",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/offers/:offerId",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/offers/:offerId/accept",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    // `LOAD-01 Recovery` — إيصالاتُ اللوحِ: إقرارُ العميلِ بوصولِ العروضِ بعدَ
    // تطبيقِ اللقطةِ. جلستُهُ تُحَدُّ نداءاتِهِ لا سِجلُّهِ: التطبيقُ يُحدِّثُ
    // اللوحَ على الإشارةِ بخانقٍ داخليٍّ (ثانيتانِ)، والدفعاتُ بلا معرّفاتٍ
    // صالحةٍ تُهمَلُ في المخزنِ (50 كحدٍّ أقصى للنداءِ). كأختِهِ قراءةِ اللوحِ.
    method: "POST",
    path: "/v1/driver/offers/receipts",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },
  {
    // `LOAD-01 Recovery` — مسارُ إشارةِ لوحِ العروضِ الداخليُّ: نداءُ شوطِ
    // التسليمِ (العاملُ) لا عميلٍ — سرٌّ مشتركٌ في ترويسةٍ يَرِدُّ 401 بلا سرٍّ
    // و503 حينَ يُعطَّلُ. **إعفاءٌ مكتوبٌ**: الحاجزُ الحقيقيُّ هنا هوَ السرُّ
    // المشتركُ لا حصرُ المعدَّلِ — فالمتصلُّ خدمةٌ واحدةٌ تُدمِجُ إشاراتِها
    // (إشارةٌ واحدةٌ لكلِّ سائقٍ كلَّ ثانيتينِ في الطالبِ نفسِهِ)، وحدُّ معدَّلٍ
    // على العنوانِ لا يحمي مسارًا لا يعرفُ العميلَ أصلًا.
    method: "POST",
    path: "/internal/realtime/offers-signal",
    file: "apps/gateway/src/routes/internal-offers-signal.ts",
    exposure: "ويبهوكٌ موقَّعٌ",
    limits: [],
    exemption: {
      reason:
        "مسارُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ لا يعرفُهُ عميلٌ؛ الحاجزُ هوَ السرُّ (401 بلا سرٍّ) والتقارُنُ في الطالبِ (دمجُ إشارةٍ كلَّ ثانيتينِ لكلِّ سائقٍ) — وحدُّ المعدَّلِ هنا يحجبُ خدمةً صادقةً عندَ عاصفةِ عروضٍ ولا يمنعُ شريرًا يعرفُ السرَّ أصلًا.",
      owner: REPO_EXECUTOR,
    },
  },

  {
    // ADR 0287 — إشارةُ حدثِ رحلةِ الراكبِ الداخليةُ: الحكمُ نفسُه لأختِها
    // (سرٌّ مشتركٌ، 401 بلا سرٍّ و503 حينَ يُعطَّلُ) — نداءُ العاملِ لا عميلٍ.
    method: "POST",
    path: "/internal/realtime/rider-trip-signal",
    file: "apps/gateway/src/routes/internal-offers-signal.ts",
    exposure: "ويبهوكٌ موقَّعٌ",
    limits: [],
    exemption: {
      reason:
        "مسارُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ لا يعرفُهُ عميلٌ؛ الحاجزُ هوَ السرُّ (401 بلا سرٍّ) والسقفُ في الطالبِ (ثلاثُ إشاراتٍ على الأكثرِ لكلِّ حدثٍ ثمَّ تيليجرامُ) — وحدُّ المعدَّلِ هنا يحجبُ خدمةً صادقةً عندَ ذروةِ الرحلاتِ ولا يمنعُ شريرًا يعرفُ السرَّ أصلًا.",
      owner: REPO_EXECUTOR,
    },
  },

  {
    method: "POST",
    path: "/v1/driver/offers/:offerId/reject",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/availability",
    file: "apps/gateway/src/routes/driver-offers.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/subscription/payments/:transactionId",
    file: "apps/gateway/src/routes/driver-subscription-invoice.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/subscription/payments/:transactionId/invoice",
    file: "apps/gateway/src/routes/driver-subscription-invoice.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/subscription/payments/:transactionId/invoice",
    file: "apps/gateway/src/routes/driver-subscription-invoice.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/subscription",
    file: "apps/gateway/src/routes/driver-subscription.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/subscription/history",
    file: "apps/gateway/src/routes/driver-subscription.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/subscription/renew",
    file: "apps/gateway/src/routes/driver-subscription.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/vehicle",
    file: "apps/gateway/src/routes/driver-vehicle.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "PATCH",
    path: "/v1/driver/vehicle",
    file: "apps/gateway/src/routes/driver-vehicle.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/vehicle/assets",
    file: "apps/gateway/src/routes/driver-vehicle.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/vehicle/assets",
    file: "apps/gateway/src/routes/driver-vehicle.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/negotiations",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/negotiations/:id/claim",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/negotiations/:id/leave",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/negotiations",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/negotiations/:id/card",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/negotiations/:id/select",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/negotiations/:id/settle",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/negotiations/:id/advance",
    file: "apps/gateway/src/routes/negotiations.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/health",
    file: "apps/gateway/src/routes/health.ts",
    exposure: "فحصُ تشغيلٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/ready",
    file: "apps/gateway/src/routes/health.ts",
    exposure: "فحصُ تشغيلٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/data-export",
    file: "apps/gateway/src/routes/me-data-rights.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/me/erasure",
    file: "apps/gateway/src/routes/me-data-rights.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/places",
    file: "apps/gateway/src/routes/me-places.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/me/places",
    file: "apps/gateway/src/routes/me-places.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "DELETE",
    path: "/v1/me/places/:id",
    file: "apps/gateway/src/routes/me-places.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "PATCH",
    path: "/v1/me/places/:id",
    file: "apps/gateway/src/routes/me-places.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/emergency-contact",
    file: "apps/gateway/src/routes/me-emergency-contact.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/operating-city",
    file: "apps/gateway/src/routes/me-operating-city.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/me/operating-city",
    file: "apps/gateway/src/routes/me-operating-city.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "PUT",
    path: "/v1/me/emergency-contact",
    file: "apps/gateway/src/routes/me-emergency-contact.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/notification-preferences",
    file: "apps/gateway/src/routes/me-notification-prefs.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "PUT",
    path: "/v1/me/notification-preferences",
    file: "apps/gateway/src/routes/me-notification-prefs.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me/recent-destinations",
    file: "apps/gateway/src/routes/me-places.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/me",
    file: "apps/gateway/src/routes/me.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "PUT",
    path: "/v1/me/language",
    file: "apps/gateway/src/routes/me.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/onboarding",
    file: "apps/gateway/src/routes/onboarding.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/onboarding/rider",
    file: "apps/gateway/src/routes/onboarding.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/onboarding/driver",
    file: "apps/gateway/src/routes/onboarding.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/metrics",
    file: "apps/gateway/src/routes/metrics.ts",
    exposure: "فحصُ تشغيلٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/notifications",
    file: "apps/gateway/src/routes/notifications.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/notifications/:id/read",
    file: "apps/gateway/src/routes/notifications.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/webhook/payment",
    file: "apps/gateway/src/routes/payment-webhook.ts",
    exposure: "ويبهوكٌ موقَّعٌ",
    limits: [
      {
        limit: 120,
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn: 'apps/gateway/src/index.ts:limiterFor("POST", "/webhook/payment", "عنوانُ العميلِ")',
        rationale:
          "المزوّدُ يُعيدُ إرسالَ الإشعارِ عندَ الشكِّ، فحدٌّ ضيّقٌ يُفقِدُ تأكيدَ دفعٍ — والخسارةُ مالٌ لا طلبٌ. ومئةٌ وعشرونَ في الدقيقةِ فوقَ أعلى دفعةٍ يُصدِرُها المزوّدُ عندَ التعافي، ودونَ ما يُغرِقُ به مَن سرَّبَ إليه أحدٌ عنوانَ المنفذِ بلا سرٍّ (والسرُّ يُرَدُّ به قبلَ أيِّ كتابةٍ).",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/api/track/:token/position",
    file: "apps/gateway/src/routes/public-tracking.ts",
    exposure: "رمزُ مشاركةٍ عامٌّ",
    limits: [
      {
        limit: 120,
        windowSeconds: 60,
        keyDimension: "رمزُ المشاركةِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("GET", "/api/track/:token/position", "رمزُ المشاركةِ")',
        rationale:
          "الاستطلاعُ الطبيعيُّ نداءٌ كلَّ ثلاثِ ثوانٍ (عشرونَ في الدقيقةِ)، فمئةٌ وعشرونَ ستّةُ أضعافِه: تحملُ عدّةَ متابعينَ للوُصلةِ الواحدةِ ولا تحملُ حاصداً يبني مسارَ رحلةٍ بدقّةِ الثانيةِ. والمفتاحُ الرمزُ لا العنوانُ لِعلّةِ الصفحةِ عينِها.",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/track/:token",
    file: "apps/gateway/src/routes/public-tracking.ts",
    exposure: "رمزُ مشاركةٍ عامٌّ",
    limits: [
      {
        limit: 60,
        windowSeconds: 60,
        keyDimension: "رمزُ المشاركةِ",
        wiredIn: 'apps/gateway/src/index.ts:limiterFor("GET", "/track/:token", "رمزُ المشاركةِ")',
        rationale:
          "صفحةُ التتبّعِ تُفتَحُ مرّةً ويُستطلَعُ الموضعُ من منفذِها المنفصلِ، فستّونَ في الدقيقةِ تحملُ إعادةَ تحميلٍ متكرِّرةً من راكبٍ قَلِقٍ. والمفتاحُ **الرمزُ لا العنوانُ**: وُصلةٌ واحدةٌ تُرسَلُ إلى أهلِ الراكبِ فيفتحونَها من عناوينَ شتّى، والمحميُّ هوَ الرحلةُ لا الشبكةُ.",
      },
    ],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/quote/ride",
    file: "apps/gateway/src/routes/quote.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/rides",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/deliveries",
    file: "apps/gateway/src/routes/deliveries.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id/search",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id/summary",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/rides/:id/rating",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id/detail",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id/candidate",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/rides/:id/candidate",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    // ADR 0287 — أحداثُ رحلةِ الراكبِ (قراءةٌ لا تُسجّلُ إيصالًا) — كأختِها `candidate`.
    method: "GET",
    path: "/v1/rides/:id/trip-events",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    // ADR 0287 — إقرارُ العميلِ بعدَ تطبيقِ الأحداثِ: ثمانيةُ معرّفاتٍ على الأكثرِ،
    // وما لا يملكُه صاحبُ الجلسةِ يُهمَلُ في المخزنِ، والتكرارُ لا يُنشئُ إيصالًا ثانيًا.
    method: "POST",
    path: "/v1/rides/:id/trip-events/ack",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/rides/:id/cancel",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/rides/:id/share",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/rides/:id/share",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "DELETE",
    path: "/v1/rides/:id/share",
    file: "apps/gateway/src/routes/rides.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/safety/sos",
    file: "apps/gateway/src/routes/safety.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/safety/sos",
    file: "apps/gateway/src/routes/safety.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/safety/sos",
    file: "apps/gateway/src/routes/safety.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/safety/sos",
    file: "apps/gateway/src/routes/safety.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/session/refresh",
    file: "apps/gateway/src/routes/session-refresh.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [
      {
        limit: 60,
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/v1/session/refresh", "عنوانُ العميلِ")',
        rationale:
          "التجديدُ أرخصُ من الإصدارِ (تحقُّقُ توقيعٍ لا `HMAC` على `initData`) ويقعُ دَوريّاً في كلِّ جلسةٍ حيّةٍ، فحدُّه أوسعُ. وستّونَ في الدقيقةِ من عنوانٍ واحدٍ تحملُ مكتبَ شركةٍ خلفَ `NAT` ولا تحملُ حاصداً يُجرِّبُ رموزَ تجديدٍ.",
      },
    ],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/session/telegram",
    file: "apps/gateway/src/routes/session-telegram.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [
      {
        /* مفتاحُ ضبطٍ لبيئةِ اختبارِ السعةِ: المولّدُ الأحاديُّ العنوانِ يحتاجُ
         * آلافَ المبادلاتِ في الدقيقةِ (كلُّ هويةٍ جلسةً) بينما الإنسانُ يفتحُ
         * التطبيقَ مراتٍ معدودةً. الافتراضيُّ 30 هو عتبةُ الإنتاجِ؛ ورفعُه في
         * بيئةِ الاختبارِ يُعلَنُ في أدلةِ الجولةِ ولا يُغيّرُ سلوكَ الإنتاجِ.
         * قيمةٌ غيرُ صالحةٍ تُرفَضُ وتُعادُ الافتراضيةُ. */
        limit: sessionExchangePerMinute(),
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/v1/session/telegram", "عنوانُ العميلِ")',
        rationale:
          "مبادلةُ `initData` بجلسةٍ تحسبُ `HMAC` لكلِّ نداءٍ **قبلَ** أن يُعرَفَ المُنادي. وثلاثونَ في الدقيقةِ فوقَ ما يبلغُه فتحُ تطبيقٍ مصغَّرٍ من يدِ إنسانٍ (فتحٌ واحدٌ يُصدِرُ جلسةً تعيشُ دقائقَ) وتحتَ ما يُزعِجُ شبكةً تُعيدُ المحاولةَ. والمفتاحُ عنوانٌ يُنتحَلُ — وهوَ كلُّ ما يُوجَدُ قبلَ المصادقةِ، ويُقالُ صريحاً لا يُدَّعى غيرُه.",
      },
    ],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/support/tickets",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/support/tickets",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/support/tickets",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/support/tickets",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/support/tickets/:id/messages",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/support/tickets/:id/messages",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/v1/driver/support/tickets/:id/messages",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/support/tickets/:id/messages",
    file: "apps/gateway/src/routes/support-tickets.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/driver/deductions",
    file: "apps/gateway/src/routes/driver-deductions.ts",
    exposure: "مُصادَقٌ بجلسةٍ",
    limits: [],
    exemption: null,
  },

  {
    method: "POST",
    path: "/webhook/telegram/:bot",
    file: "apps/gateway/src/routes/telegram-webhook.ts",
    exposure: "ويبهوكٌ موقَّعٌ",
    limits: [
      {
        limit: 20,
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/webhook/telegram/:bot", "عنوانُ العميلِ")',
        rationale:
          "محاولاتُ السرِّ الخاطئِ: مَن يجرّبُ أكثرَ من عشرينَ سرّاً في الدقيقةِ لا يُخطئُ بل يُخمّنُ. والرقمُ قائمٌ من `BUG-006` (ADR 0055) ونُقِلَ ههنا بلا تغييرٍ — نقلُ موضعِ الحقيقةِ لا تعديلُ سياسةٍ.",
      },
      {
        limit: 30,
        windowSeconds: 10,
        keyDimension: "مستخدمُ تيليجرامَ",
        wiredIn:
          'apps/gateway/src/index.ts:limiterFor("POST", "/webhook/telegram/:bot", "مستخدمُ تيليجرامَ")',
        rationale:
          "تحديثاتُ المستخدمِ الواحدِ: ثلاثونَ في عشرِ ثوانٍ — ثلاثُ ضغطاتٍ في الثانيةِ بلا توقّفٍ، وهوَ فوقَ ما تبلغُه يدُ إنسانٍ وتحتَ ما يُزعِجُ مستخدماً سريعاً. والمفتاحُ **صاحبُ التحديثِ كما يُرسِلُه تيليجرامُ** لا عنوانٌ: عناوينُ تيليجرامَ قليلةٌ مشتركةٌ، فحدٌّ بها يُعاقِبُ الجميعَ بفعلِ واحدٍ.",
      },
    ],
    exemption: null,
  },

  {
    method: "GET",
    path: "/v1/policy",
    file: "apps/gateway/src/routes/policy.ts",
    exposure: "قبلَ المصادقةِ",
    limits: [
      {
        limit: 30,
        windowSeconds: 60,
        keyDimension: "عنوانُ العميلِ",
        wiredIn: 'apps/gateway/src/index.ts:limiterFor("GET", "/v1/policy", "عنوانُ العميلِ")',
        rationale:
          "سياسةٌ علنيّةٌ تُقرأُ من القاعدةِ: لا سرَّ ولا حسابَ توقيعٍ ولا كتابةَ حالةٍ — وثلاثونَ نداءً في الدقيقةِ فوقَ ما يقرأُه إنسانٌ في جلسةٍ واحدةٍ، وتحتَ ما يُغرقُ القاعدةَ بسؤالٍ واحدٍ متكرّرٍ. والحدُّ بعنوانِ العميلِ لا بجلسةٍ: المسارُ بلا مصادقةٍ فلا مفتاحَ غيرُه.",
      },
    ],
    exemption: null,
  },
];

/**
 * الأعدادُ المُعلَنةُ **نصّاً لا `ARRAY.length`**: لو قُرِئَت من طولِ المصفوفةِ
 * لَحرسَ السِجلُّ نفسَه فلم يحرسْ شيئاً، **ونموُّ الإعفاءاتِ خفيةً هوَ بعينِه ما
 * يُخشى**. ومَن أضافَ مساراً يُغيِّرُ الرقمَ بيدِه فيُقرأُ التغييرُ في المراجعةِ.
 *
 * والإعفاءاتُ **أربعةٌ**: صفحةُ دخولِ اللوحةِ ومسارا رمزِها وبابُ النجاةِ
 * (`SEC-21`) — وكلُّها محدودٌ فعلُها في القاعدةِ لا في عدَّادٍ.
 *
 * 106 → 108 في 2026-09-29 (`ADR 0213`): مسارا التسجيلِ من التطبيقِ المصغَّرِ — خلفَ
 * حارسِ الجلسةِ كله. 108 → 109 في 2026-09-29: مسارُ `POST /v1/deliveries` — خلفَ
 * الجلسةِ الموقَّعةِ كسائرِ `مُصادَقٌ بجلسةٍ`، والكتابةُ فيهما upsert على `telegram_id`
 * فتكرارُها لا يُنشئُ صفّاً ثانياً.
 *
 * 101 → 105 و3 → 4 في 2026-09-23 (`SEC-21`): أربعةُ مساراتِ البابِ الموازي —
 * دخولُهُ العامُّ محدودٌ في صفِّ الاعتمادِ في القاعدةِ (`admin_break_glass_finish_failure`)
 * والبقيةُ خلفَ حارسِ الجلسةِ.
 * 105 → 110 في 2026-09-30 (`F12-22`): مسارُ استغاثةِ السائقِ بلا تيليجرام.
 * 110 → 111 في 2026-09-30 (`F16-01` · `ADR 0219`): مسارُ تعليمِ التقييمِ منَ
 * اللوحةِ — خلفَ حارسِ جلسةِ الإدارةِ كما أخواتُه. 111 → 112 في 2026-09-30
 * (`F16-02` · `ADR 0220`): مسارُ الإقفالِ الإداريِّ للتذكرةِ منَ اللوحةِ —
 * خلفَ حارسِ جلسةِ الإدارةِ كما أخواتُه. 112 → 113 في 2026-09-30
 * (`F16-03` · `ADR 0221`): مسارُ قطعِ روابطِ التتبُّعِ منَ اللوحةِ — خلفَ
 * حارسِ جلسةِ الإدارةِ كما أخواتُه من مساراتِ اللوحةِ.
 * 126 → 128 في 2026-10-03 (`ADM-MSG-01`): صفحةُ معرضِ الرسائلِ ومسلكُ «أرسلها لي»
 * 128 → 130 في 2026-10-09 (R1 · ADR 0252): `GET`/`POST /v1/me/operating-city` — مُصادَقانِ بجلسةٍ كأخواتِهما.
 * 130 → 131 في 2026-10-10 (PD-042 · ADR 0256): `POST /admin/drivers/:id/documents/:docType/review` — جلسةُ مسؤولٍ وCSRF كأخيه `/verification`.
 * إلى محادثةِ المسؤولِ نفسِه — خلفَ حارسِ جلسةِ الإدارةِ كأخواتِهما.
 * 131 → 132 في 2026-10-09 (PRD-105 · ADR 0257): `POST /v1/onboarding/driver` — مُصادَقٌ بجلسةٍ كأخيه `/rider`.
 * 132 → 135 في 2026-10-12 (WR-04 · ADR 0263): مساراتُ محادثةِ الطلبِ الثلاثةُ — مُصادَقةٌ بجلسةٍ،
 *   والطرفُ يحكمُه الخادمُ.
 * 135 → 137 في 2026-10-12 (WR-09 · ADR 0266): `GET`/`POST /v1/rides/:id/candidate` — مُصادَقانِ
 *   بجلسةٍ، والطلبُ مقيَّدٌ بصاحبِه في القاعدة.
 * 147 → 150 في 2026-10-18 (ADR 0287): `GET /v1/rides/:id/trip-events` و`POST …/ack` مُصادَقانِ
 *   بجلسةٍ، و`POST /internal/realtime/rider-trip-signal` خدمةٌ لخدمةٍ بسرٍّ مشتركٍ.
 */
export const ROUTE_POLICY_COUNT = 150;
export const LIMITED_ROUTE_COUNT = 10;
/** 4 → 5 في 2026-10-18 (ADR 0287): `/internal/realtime/rider-trip-signal` بسرٍّ مشتركٍ كأختِه. */
export const EXEMPT_ROUTE_COUNT = 5;

/** حدودُ مسارٍ بعينِه — يُعيدُ مصفوفةً فارغةً لِما لا حدَّ له. */
export function limitsFor(method: string, path: string): readonly RateLimitPolicy[] {
  return (
    ROUTE_POLICIES.find((policy) => policy.method === method && policy.path === path)?.limits ?? []
  );
}

/**
 * حدٌّ بعينِه ببُعدِ مفتاحِه — **يرمي إن لم يُوجَدْ**، ولا يُعيدُ حدَّاً افتراضيّاً:
 * موضعُ تركيبٍ يطلبُ حدَّاً غيرَ مُعلَنٍ خطأٌ يُكتشَفُ عندَ الإقلاعِ، **لا حدٌّ
 * مُخترَعٌ في التشغيلِ** يُقرأُ سياسةً ولم يُقرِّرْهُ أحدٌ.
 */
function sessionExchangePerMinute(): number {
  const raw = process.env.SESSION_EXCHANGE_PER_MINUTE;
  if (raw === undefined || raw.trim() === "") return 30;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) return 30;
  return parsed;
}

export function rateLimitPolicy(
  method: string,
  path: string,
  keyDimension: KeyDimension,
): RateLimitPolicy {
  const found = limitsFor(method, path).find((policy) => policy.keyDimension === keyDimension);
  if (found === undefined) {
    throw new Error(
      `لا حدَّ مُعلَناً لِـ${method} ${path} ببُعدِ «${keyDimension}» في apps/gateway/src/rate-limit/policy.ts`,
    );
  }
  return found;
}
