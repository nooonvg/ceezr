/**
 * الغرض: سجلٌّ واحدٌ لكلِّ مقصدٍ شبكيٍّ خارجَ هذه العمليّةِ — البندُ `W-6`.
 *
 * ولِمَ سجلٌّ لا وثيقةٌ: البندُ يقولُ «لا اقترانَ تجاريَّ مباشرَ مع MARKET، وكلُّ
 * مرورٍ بينَ الأنظمةِ عبرَ CORE». وهذا **صحيحٌ اليومَ بالمصادفةِ لا بالإنفاذِ**:
 * لا شيءَ في المستودعِ يمنعُ إضافةَ `fetch` إلى نهايةٍ في MARKET غداً، ولا سطرٌ
 * يُخفِقُ إن أُضيفَت. فالمكتوبُ ههنا **قائمةٌ مغلقةٌ**: كلُّ مضيفٍ في شيفرةِ
 * الإنتاجِ يجبُ أن يكونَ مُعلَناً ههنا، وكلُّ مُعلَنٍ يجبُ أن يكونَ في الشيفرةِ.
 *
 * وحدٌّ مُعلَنٌ لا مسكوتٌ عنه: **نطاقُ MARKET غيرُ معروفٍ لهذا المستودعِ**، فلا
 * تُقاسُ «مطابقةُ اسمِ نطاقٍ». والإنفاذُ لا يعتمدُ على معرفتِه: القائمةُ مغلقةٌ،
 * فمقصدٌ جديدٌ غيرُ مُعلَنٍ يُسقِطُ البناءَ، وإعلانُه يقتضي حقلَ `system`،
 * و`system: "MARKET"` مرفوضٌ نصّاً. فلا يُمَرُّ إلى MARKET لا بإعلانٍ ولا بغيرِه.
 *
 * **الموضعُ (زيادةٌ ثانيةٌ، 2026-09-12):** كانَ هذا الملفُّ في
 * `scripts/lib/wasla-egress-registry.ts` حينَ كانَ قارئُه الوحيدُ حاجزَ البناءِ.
 * ثمَّ صارَت له بوّابةٌ **وقتَ التشغيلِ** في
 * `packages/infrastructure/egress/egress-gate.ts`، وشيفرةُ الإنتاجِ لا تستوردُ من
 * `scripts/`، فنُقِلَ إلى `packages/shared` **كي يبقى مصدرُ الحقيقةِ واحداً**: لو
 * نُسِخَت القائمةُ للتشغيلِ لصارَ مصدرانِ يفترقانِ بصمتٍ، وذاكَ أسوأُ من غيابِ
 * البوّابةِ لأنَّه يُقرأُ إنفاذاً وليسَ كذلكَ. والحاجزُ يستثني هذا الملفَّ من مسحِ
 * المضيفاتِ (الفحصُ ١١) لأنَّه **إعلانٌ لا موضعُ نداءٍ**، ولولا الاستثناءُ لصارَ
 * الفحصُ ٥ («لا مُدخلَ ميّتاً») يجدُ كلَّ مضيفٍ في السجلِّ نفسِه فيُفرَّغُ من معناه.
 *
 * ولا يُكرَّرُ ههنا شيءٌ من `wasla-boundary-registry.ts`: ذاكَ سجلُّ **جداولَ**،
 * وهذا سجلُّ **مقاصدَ شبكيّةٍ**، ولا حقلَ مشتركاً بينَهما.
 */

/** الطريقةُ التي يُعرَفُ بها المضيفُ في الشيفرةِ — تُحدِّدُ كيفَ يُقاسُ وجودُه. */
export type PeerSource =
  /** مضيفٌ مكتوبٌ حرفاً في الشيفرةِ، فيُقاسُ بمسحِ الملفّاتِ. */
  | { readonly kind: "literal"; readonly hosts: readonly string[] }
  /** مضيفٌ يأتي من متغيّرِ بيئةٍ، فيُقاسُ بوجودِ المفتاحِ في `.env.example`. */
  | { readonly kind: "env"; readonly envKeys: readonly string[] }
  /**
   * مضيفٌ افتراضيٌّ داخلَ مكتبةٍ، فيُقاسُ بوجودِ الحزمةِ في `package.json`.
   *
   * وحدٌّ مُعلَنٌ: **اسمُ المضيفِ نفسُه غيرُ مقيسٍ** — يُقرأُ من توثيقِ المكتبةِ
   * ويُراجَعُ بالقراءةِ. ولا يُقاسُ من `node_modules` لأنَّ المسارَ في هذا
   * المستودعِ وصلةٌ رمزيّةٌ مُتعقَّبةٌ لا يُعتمَدُ على حضورِها وقتَ الفحصِ.
   */
  | { readonly kind: "library-default"; readonly packageName: string; readonly host: string };

/**
 * تصنيفُ المقصدِ. قائمةٌ مغلقةٌ عن قصدٍ: صنفٌ جديدٌ يقتضي قراراً معماريّاً لا
 * سطراً في سجلٍّ.
 */
export type PeerClass =
  /** CORE — الطريقُ الوحيدُ المشروعُ للمرورِ بينَ الأنظمةِ (البندُ `W-6`). */
  | "CORE"
  /** قناةُ المستخدمِ النهائيِّ (تلغرام). ليسَت نظاماً شقيقاً. */
  | "CHANNEL"
  /** بنيةٌ تحتيّةٌ يشغّلُها المُشغِّلُ: قاعدةٌ، ذاكرةٌ، نسخٌ احتياطيٌّ، قياسٌ. */
  | "INFRASTRUCTURE"
  /** خدمةٌ مساعدةٌ اختياريّةٌ مُعطَّلةٌ افتراضيّاً: ترجمةٌ، توجيهٌ، بلاطاتٌ. */
  | "OPTIONAL_AUXILIARY"
  /** تكاملٌ تجاريٌّ مباشرٌ لمّا يُسلَّم إلى CORE — دَينٌ مُعلَنٌ لا مسكوتٌ عنه. */
  | "COMMERCIAL_PENDING_HANDOVER"
  /** أصلٌ يُحمَّلُ في متصفّحِ المستخدمِ لا من الخادمِ. */
  | "BROWSER_ASSET"
  /** رابطٌ يُعرَضُ للمستخدمِ لينقرَه — لا نداءَ شبكةٍ من هذه العمليّةِ. */
  | "USER_LINK";

/** النظامُ الشقيقُ في وَصْلَةِ WASLA الذي يملكُ المقصدَ. */
export type PeerSystem =
  /** CORE — مسموحٌ. */
  | "CORE"
  /**
   * MARKET — **مرفوضٌ نصّاً**. لا يوجدُ ولا يجوزُ أن يوجدَ مُدخلٌ بهذه القيمةِ،
   * وهيَ مُعلَنةٌ في النوعِ كي يكونَ الرفضُ **مقيساً** لا مفترضاً: الفحصُ يزرعُها
   * ويطلبُ من الحاجزِ أن يرفضَها.
   */
  | "MARKET"
  /** لا نظامَ شقيقاً — قناةٌ أو بنيةٌ تحتيّةٌ أو خدمةٌ عامّةٌ. */
  | "NONE";

/**
 * هل يمرُّ هذا المقصدُ من بوّابةِ الصادرِ وقتَ التشغيلِ؟
 *
 * والسؤالُ ليسَ زينةً: حاجزُ البناءِ يقرأُ الشيفرةَ ولا يقفُ بينَ العمليّةِ
 * والشبكةِ، فنداءٌ يُركَّبُ وقتَ التشغيلِ أو عميلٌ يُوجَّهُ إلى مضيفٍ غيرِ الذي
 * يُعلِنُه يمرُّ من البناءِ ويخرجُ من الجهازِ. فمن كانَ ناقلُه `fetch` **يُلزَمُ**
 * بالبوّابةِ (الفحصُ ١٣)، ومن لم يكن فيُعلِنُ سببَه مكتوباً لا مسكوتاً عنه.
 */
export type RuntimeGate =
  /** ناقلُه `fetch` فيمرُّ من `createGuardedFetch(id)` في موضعِ النداءِ. */
  | { readonly kind: "gated" }
  /** لا ناقلَ `fetch` له، والسببُ مكتوبٌ ويُراجَعُ بالقراءةِ. */
  | { readonly kind: "not-applicable"; readonly reason: string };

export interface EgressPeer {
  /** معرّفٌ ثابتٌ يُحالُ إليه في الوثائقِ والاختباراتِ. */
  readonly id: string;
  /** ما هوَ المقصدُ بعبارةٍ واحدةٍ. */
  readonly purpose: string;
  readonly peerClass: PeerClass;
  readonly system: PeerSystem;
  readonly source: PeerSource;
  /** الملفُّ الذي يُنشئُ النداءَ — مسارٌ واحدٌ يُراجَعُ بالقراءةِ. */
  readonly callSite: string;
  /**
   * للتكاملِ التجاريِّ وحدَه: البندُ الذي يُزيلُه والاعتماديّةُ التي تحجبُه.
   * وكلاهما يجبُ أن يكونَ **مُعلَناً في `ROADMAP.md`** لا اسماً مُختلَقاً.
   */
  readonly handover?: { readonly removedByItem: string; readonly blockedBy: string };
  /** مرورُه من بوّابةِ التشغيلِ أو سببُ عدمِه — الفحصُ ١٣ يقيسُه. */
  readonly runtimeGate: RuntimeGate;
  /**
   * هل أُزيلَ المقصدُ فعلاً؟ **لا يُرفَعُ إلى `true` إلّا إذا غابَ المضيفُ عن
   * الشيفرةِ**، والحاجزُ يقيسُ ذلكَ. فلا يُقرأُ عزمٌ إنجازاً.
   */
  readonly removed: boolean;
}

/**
 * أصنافٌ لا يجوزُ أن تحملَ نظاماً شقيقاً: قناةٌ وبنيةٌ تحتيّةٌ وخدمةٌ اختياريّةٌ
 * وأصلُ متصفّحٍ ورابطُ مستخدمٍ — لو حملَت `CORE` لصارَ المرورُ بينَ الأنظمةِ
 * يتسرَّبُ من بابٍ غيرِ بابِ CORE وهوَ مُصنَّفٌ بغيرِ اسمِه.
 */
export const CLASSES_WITHOUT_SIBLING_SYSTEM: readonly PeerClass[] = [
  "CHANNEL",
  "INFRASTRUCTURE",
  "OPTIONAL_AUXILIARY",
  "BROWSER_ASSET",
  "USER_LINK",
] as const;

/**
 * السجلُّ. مُدخلٌ لكلِّ مقصدٍ شبكيٍّ تُنتِجُه شيفرةُ الإنتاجِ في هذا المستودعِ.
 */
export const WASLA_EGRESS_REGISTRY: readonly EgressPeer[] = [
  // ── CORE: الطريقُ الوحيدُ المشروعُ بينَ الأنظمةِ ──────────────────────────
  {
    id: "core-events-ingress",
    purpose: "إيداعُ أحداثِ `move.job.*` في بابِ CORE الشبكيِّ (`POST /v1/events`)",
    peerClass: "CORE",
    system: "CORE",
    source: { kind: "env", envKeys: ["CORE_EVENTS_BASE_URL", "CORE_EVENTS_BEARER_TOKEN"] },
    callSite: "packages/infrastructure/wasla/core-event-shipper.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },

  // ── القناةُ ───────────────────────────────────────────────────────────────
  {
    id: "telegram-bot-api",
    purpose: "سطحُ MOVE التشغيليُّ كلُّه على تلغرام — إرسالٌ وتسجيلُ أوامرَ وموقعٌ حيٌّ",
    peerClass: "CHANNEL",
    system: "NONE",
    source: { kind: "library-default", packageName: "grammy", host: "api.telegram.org" },
    callSite: "packages/infrastructure/notification/telegram-client.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "telegram-deep-links",
    purpose:
      "روابطُ t.me العميقةُ داخلَ نصِّ رسائلِ البوتِ (رابطُ التسجيلِ في بوّابةِ القروبِ · `PD-001`) — حرفٌ في رسالةٍ يضغطُهُ المستخدمُ، لا نداءَ شبكةٍ من الشيفرةِ",
    peerClass: "CHANNEL",
    system: "NONE",
    source: { kind: "literal", hosts: ["t.me"] },
    callSite: "packages/infrastructure/notification/telegram-join-gate.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason:
        "مضيفُ الروابطِ لا يُنادى من الشيفرةِ: النصُّ يسيرُ في رسالةِ تلغرامَ التي هي أصلًا قناةً مُعلَنةً مُبوَّبةً، وفتحُ الرابطِ فعلُ المستخدمِ في تطبيقِهِ لا فعْلُ الخدمةِ",
    },
    removed: false,
  },

  // ── تكاملٌ تجاريٌّ مباشرٌ: دَينٌ مُعلَنٌ ينتظرُ `W-7` ─────────────────────
  {
    id: "moyasar-payments",
    purpose: "بوّابةُ دفعٍ مباشرةٌ لاشتراكِ السائقِ — تكاملٌ تجاريٌّ لمّا يُسلَّم إلى CORE",
    peerClass: "COMMERCIAL_PENDING_HANDOVER",
    system: "NONE",
    source: { kind: "literal", hosts: ["api.moyasar.com"] },
    callSite: "packages/infrastructure/financial/moyasar-provider.ts",
    handover: { removedByItem: "W-7", blockedBy: "DEP-CORE-002" },
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "tap-payments",
    purpose: "بوّابةُ دفعٍ مباشرةٌ بديلةٌ — تكاملٌ تجاريٌّ لمّا يُسلَّم إلى CORE",
    peerClass: "COMMERCIAL_PENDING_HANDOVER",
    system: "NONE",
    source: { kind: "literal", hosts: ["api.tap.company"] },
    callSite: "packages/infrastructure/financial/tap-provider.ts",
    handover: { removedByItem: "W-7", blockedBy: "DEP-CORE-002" },
    runtimeGate: { kind: "gated" },
    removed: false,
  },

  // ── بنيةٌ تحتيّةٌ يشغّلُها المُشغِّلُ ──────────────────────────────────────
  {
    id: "socket-io-server",
    purpose:
      "مكتبةُ Socket.IO لقناةِ الرحلةِ الآنيةِ (F4-04، ADR 0042) — خادمٌ يستقبلُ اتصالاتٍ لا يصلُ إلى مضيفٍ خارجيٍّ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "library-default", packageName: "socket.io", host: "socket.io" },
    callSite: "apps/gateway/src/realtime/ride-channel.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason: "خادمٌ يستقبلُ اتصالاتِ WebSocket من المتصفّحِ على المنفذِ نفسِه لا يصلُ إلى مضيفٍ خارجيٍّ.",
    },
    removed: false,
  },
  {
    id: "supabase-postgres",
    purpose: "قاعدةُ البياناتِ — مخزنُ الحقيقةِ الوحيدُ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "env", envKeys: ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
    callSite: "packages/infrastructure/db/client.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason:
        "ناقلُه بروتوكولُ PostgreSQL على مقبسٍ لا `fetch`، فلا موضعَ للبوّابةِ فيه؛ ومضيفُه من البيئةِ يفحصُه `assertEgressEnvironment`.",
    },
    removed: false,
  },
  {
    id: "supabase-object-storage",
    purpose: "مخزنُ الأجسامِ — روابطُ رفعٍ موقَّعةٌ لوثائقِ السائقِ (F3-01)",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: {
      kind: "env",
      envKeys: ["OBJECT_STORAGE_URL", "OBJECT_STORAGE_SECRET_KEY", "DRIVER_DOCUMENTS_BUCKET"],
    },
    callSite: "packages/infrastructure/storage/signed-upload.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "gateway-internal-offers-signal",
    purpose:
      "مسارُ إشارةِ لوحِ العروضِ الداخليُّ بينَ شوطِ التسليمِ والبوابةِ (متصلٌ؟ بُثَّتْ لهُ) — بابُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "env", envKeys: ["GATEWAY_INTERNAL_URL", "INTERNAL_SIGNAL_SECRET"] },
    callSite: "packages/infrastructure/dispatch/offer-board-delivery.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "gateway-internal-rider-trip-signal",
    purpose:
      "ADR 0287 — إشارةُ حدثِ رحلةِ الراكبِ الداخليةُ بينَ شوطِ التسليمِ والبوابةِ (متصلٌ؟ بُثَّتْ لهُ) — بابُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "env", envKeys: ["GATEWAY_INTERNAL_URL", "INTERNAL_SIGNAL_SECRET"] },
    callSite: "packages/infrastructure/notification/rider-trip-app-delivery.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "upstash-redis-rest",
    purpose: "مخزنُ الجلساتِ ومنعُ التكرارِ عبرَ المثيلاتِ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "env", envKeys: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] },
    callSite: "packages/infrastructure/redis/upstash.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "google-drive-backup",
    purpose: "رفعُ النسخِ الاحتياطيّةِ وسحبُها — تحقُّقُ الاستعادةِ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "literal", hosts: ["www.googleapis.com", "oauth2.googleapis.com"] },
    callSite: "packages/infrastructure/backup/google-drive-adapter.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "metrics-collector",
    purpose: "تصديرُ القياسِ إلى مُجمِّعٍ خارجيٍّ — مُعطَّلٌ بلا نهايةٍ مضبوطةٍ",
    peerClass: "INFRASTRUCTURE",
    system: "NONE",
    source: { kind: "env", envKeys: ["METRICS_EXPORT_ENDPOINT"] },
    callSite: "packages/infrastructure/observability/metrics-exporter.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },

  // ── خدماتٌ اختياريّةٌ مُعطَّلةٌ افتراضيّاً ────────────────────────────────
  {
    id: "deepl-translation",
    purpose: "ترجمةٌ آليّةٌ — `TRANSLATION_PROVIDER=deepl`، ومُعطَّلٌ بـ`none` افتراضيّاً",
    peerClass: "OPTIONAL_AUXILIARY",
    system: "NONE",
    source: { kind: "literal", hosts: ["api.deepl.com", "api-free.deepl.com"] },
    callSite: "packages/infrastructure/i18n-translation/translation-providers.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "google-translation",
    purpose: "ترجمةٌ آليّةٌ عبرَ Google — نهايتُها الرسميّةُ ونهايةُ الويبِ المجّانيّةُ",
    peerClass: "OPTIONAL_AUXILIARY",
    system: "NONE",
    source: {
      kind: "literal",
      hosts: ["translation.googleapis.com", "translate.googleapis.com"],
    },
    callSite: "packages/infrastructure/i18n-translation/translation-providers.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "mymemory-translation",
    purpose: "ترجمةٌ آليّةٌ مجّانيّةٌ بلا مفتاحٍ — مزوّدُ تجربةٍ لا إنتاجٍ",
    peerClass: "OPTIONAL_AUXILIARY",
    system: "NONE",
    source: { kind: "literal", hosts: ["api.mymemory.translated.net"] },
    callSite: "packages/infrastructure/i18n-translation/translation-providers.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "osrm-routing",
    purpose: "حسابُ المسارِ والمسافةِ — `ROUTING_PROVIDER=osrm`، ومُعطَّلٌ افتراضيّاً",
    peerClass: "OPTIONAL_AUXILIARY",
    system: "NONE",
    source: { kind: "env", envKeys: ["OSRM_BASE_URL"] },
    callSite: "packages/maps/providers/osrm/osrm-provider.ts",
    runtimeGate: { kind: "gated" },
    removed: false,
  },
  {
    id: "map-tiles",
    purpose: "بلاطاتُ الخريطةِ ونمطُها للوحةِ الإدارةِ — مُعطَّلٌ بلا رابطٍ مضبوطٍ",
    peerClass: "OPTIONAL_AUXILIARY",
    system: "NONE",
    source: { kind: "env", envKeys: ["MAP_STYLE_URL", "MAP_TILES_PUBLIC_KEY"] },
    callSite: "packages/maps/providers/maplibre/maplibre-style.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason:
        "بلاطاتٌ ونمطٌ يُحمَّلانِ في متصفّحِ المُشرِفِ، فالنداءُ من جهازِه لا من هذه العمليّةِ؛ والبوّابةُ تحرسُ صادرَ العمليّةِ وحدَه.",
    },
    removed: false,
  },

  // ── أصلُ متصفّحٍ ورابطُ مستخدمٍ: لا نداءَ من الخادمِ ──────────────────────
  {
    id: "unpkg-maplibre",
    purpose: "مكتبةُ MapLibre تُحمَّلُ في متصفّحِ المُشرِفِ من شبكةِ توصيلٍ، ببصمةِ سلامةٍ",
    peerClass: "BROWSER_ASSET",
    system: "NONE",
    source: { kind: "literal", hosts: ["unpkg.com"] },
    callSite: "packages/maps/providers/maplibre/maplibre-style.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason: "أصلٌ يُحمِّلُه المتصفّحُ ببصمةِ سلامةٍ، ولا نداءَ من الخادمِ ألبتّةَ.",
    },
    removed: false,
  },
  {
    id: "google-maps-link",
    purpose: "رابطٌ يُعرَضُ للمُشرِفِ لينقرَه فيرى موقعَ سائقٍ — لا نداءَ شبكةٍ من هنا",
    peerClass: "USER_LINK",
    system: "NONE",
    source: { kind: "literal", hosts: ["maps.google.com"] },
    callSite: "apps/admin-dashboard/src/pages/driver-detail.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason: "رابطٌ يُعرَضُ لينقرَه المُشرِفُ، ولا نداءَ شبكةٍ من هذه العمليّةِ.",
    },
    removed: false,
  },
  {
    id: "google-maps-link-driver-job",
    purpose: "رابطُ ملاحةٍ تبنيه البوّابةُ في حمولةِ المَهمّةِ ليفتحَه السائقُ (`F3-03`) — لا نداءَ شبكةٍ",
    peerClass: "USER_LINK",
    system: "NONE",
    source: { kind: "literal", hosts: ["maps.google.com"] },
    // `LOC-TRUST-01`: الباني انتقلَ إلى المجالِ ليقرأه مُرسِلُ بطاقةِ السائقِ أيضاً.
    callSite: "packages/domain/places/place-open-url.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason:
        "نصٌّ يُنشَرُ في الحمولةِ ليُمَرَّرَ إلى `openExternalLink` في المصغَّرِ، ولا نداءَ شبكةٍ من البوّابةِ ألبتَّةَ.",
    },
    removed: false,
  },
  {
    id: "place-link-recognition",
    purpose:
      "`LOC-TRUST-01` — مضيفاتُ خرائطَ يُتعرَّفُ بها رابطُ موقعٍ لصقَه الراكبُ (قائمةُ سماحٍ) — مقارنةُ نصٍّ لا نداءَ شبكةٍ",
    peerClass: "USER_LINK",
    system: "NONE",
    source: {
      kind: "literal",
      hosts: [
        "maps.apple.com",
        "waze.com",
        "www.waze.com",
        "ul.waze.com",
        "openstreetmap.org",
        "www.openstreetmap.org",
        "osm.org",
      ],
    },
    callSite: "packages/domain/places/place-input.ts",
    runtimeGate: {
      kind: "not-applicable",
      reason: "الرابطُ يُحفَظُ نصّاً ويفتحُه السائقُ من جهازِه؛ ولا يُجلَبُ ولا يُتبَعُ تحويلُه من الخادمِ ألبتَّةَ.",
    },
    removed: false,
  },
] as const;

/** موضعُ `fetch` يعملُ في متصفّحِ المستخدمِ لا في هذه العمليّةِ. */
export interface BrowserFetchSite {
  readonly path: string;
  readonly reason: string;
}

/**
 * المواضعُ التي يجوزُ فيها `fetch` عارياً بلا بوّابةٍ، **وكلُّها في المتصفّحِ**.
 *
 * والبوّابةُ تحرسُ صادرَ **هذه العمليّةِ**؛ ونصٌّ يُرسَلُ ليُنفَّذَ في متصفّحِ
 * المُشرِفِ أو في تطبيقِ تلغرام المصغَّرِ لا يمرُّ من ذاكرةِ الخادمِ أصلاً، فحراستُه
 * ههنا وهمٌ يُقرأُ إنفاذاً. وكلُّ موضعٍ ههنا **يجبُ أن يوجدَ وأن يحملَ `fetch` فعلاً**
 * (الفحصُ ١٢)، كي لا يبقى استثناءٌ ميّتٌ يمرُّ منه غداً نداءٌ من الخادمِ.
 */
export const BROWSER_FETCH_SITES: readonly BrowserFetchSite[] = [
  {
    path: "apps/admin-dashboard/src/layout.ts",
    reason:
      "نصٌّ مُضمَّنٌ في صفحةِ لوحةِ الإدارةِ يُنادي `/admin/api/search` من متصفّحِ " +
      "المُشرِفِ بأصلٍ واحدٍ (`same-origin`) — لا صادرَ من الخادمِ ولا مضيفَ خارجيّاً",
  },
  {
    path: "apps/miniapp/src/api/client.ts",
    reason:
      "عميلُ تطبيقِ تلغرام المصغَّرِ يعملُ في المتصفّحِ ويُنادي بوّابةَ MOVE نفسَها؛ " +
      "والمجلَّدُ مُستثنًى من `tsconfig` لأنَّه يُبنى ببناءٍ مستقلٍّ",
  },
  {
    path: "apps/miniapp/src/surfaces/driver/documents/documents-api.ts",
    reason:
      "رفعُ وثيقةِ السائقِ يجري **من متصفّحِ السائقِ إلى المخزنِ مباشرةً** بإذنٍ " +
      "موقَّعٍ في العنوانِ نفسِه؛ ولو مرَّ البايتُ من الخادمِ لَحمَلَ ملفَّ كلِّ " +
      "سائقٍ إلى ذاكرةِ البوّابةِ بلا فائدةٍ. ولا صادرَ من هذه العمليّةِ ههنا، " +
      "والتوقيعُ نفسُه في `packages/infrastructure/storage/signed-upload.ts` " +
      "مُبوَّبٌ بالمقصدِ `supabase-object-storage`",
  },
  {
    path: "apps/miniapp/src/surfaces/driver/deductions/deduction-trace-api.ts",
    reason:
      "عميلُ تطبيقِ تلغرام المصغَّرِ يعملُ في المتصفّحِ ويُنادي بوّابةَ MOVE نفسَها " +
      "بعنوانٍ نسبيٍّ — لا صادرَ من الخادمِ ولا مضيفَ خارجيّاً",
  },
  {
    path: "apps/gateway/src/public/tracking-page.ts",
    reason:
      "نصٌّ مُضمَّنٌ في صفحةِ التتبُّعِ العامّةِ يستفتي موضعَ الرحلةِ من المتصفّحِ " +
      "بعنوانٍ نسبيٍّ يُركِّبُه الخادمُ — لا نداءَ شبكةٍ من هذه العمليّةِ",
  },
] as const;

/** مضيفٌ يُقبَلُ في شيفرةِ الإنتاجِ بلا إعلانٍ، لسببٍ مكتوبٍ لا لراحةٍ. */
export interface HostExemption {
  readonly host: string;
  readonly reason: string;
}

/**
 * قائمةُ الإعفاءاتِ، و**هيَ فارغةٌ عن قياسٍ لا عن إغفالٍ**.
 *
 * وُضِعَت أوّلاً بأربعةِ نُوّابٍ (`example.com` وأخواتُها) ظنّاً بأنَّها في شيفرةِ
 * الإنتاجِ، ثمَّ قِيسَ المسحُ فتبيَّنَ أنَّ **ولا واحداً منها يظهرُ** بعدَ نزعِ
 * التعليقاتِ: كلُّها كانَت في نصوصٍ توضيحيّةٍ. فحُذِفَت كلُّها، إذ إعفاءٌ لا
 * يُستعمَلُ **ثقبٌ مفتوحٌ بلا مقابلٍ**: يبقى مكتوباً حتّى يمرَّ منه غداً مضيفٌ
 * حقيقيٌّ فيُقالُ «كانَ مُعفًى من قبلُ».
 *
 * وقيدانِ يحرسانِ الفراغَ (الفحصُ ٩): كلُّ إعفاءٍ يجبُ أن يكونَ نطاقاً **محفوظاً**
 * (RFC 2606) **و** أن يظهرَ فعلاً في المسحِ. فلا يُضافُ نائبٌ ميّتٌ ولا مضيفٌ حقيقيٌّ.
 */
export const HOST_EXEMPTIONS: readonly HostExemption[] = [] as const;

/** كلُّ مضيفٍ مُعلَنٍ حرفاً في السجلِّ، بلا تكرارٍ. */
export function declaredLiteralHosts(
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): readonly string[] {
  const out = new Set<string>();
  for (const peer of registry) {
    if (peer.source.kind === "literal") for (const h of peer.source.hosts) out.add(h);
    if (peer.source.kind === "library-default") out.add(peer.source.host);
  }
  return [...out].sort();
}

/** المضيفاتُ المعفاةُ، أسماءً وحدَها. */
export function exemptHostNames(
  exemptions: readonly HostExemption[] = HOST_EXEMPTIONS,
): readonly string[] {
  return exemptions.map((e) => e.host).sort();
}

/** مُدخلٌ بمعرّفِه، أو `undefined`. */
export function peerById(
  id: string,
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): EgressPeer | undefined {
  return registry.find((p) => p.id === id);
}

/** كلُّ مُدخلٍ من صنفٍ بعينِه. */
export function peersByClass(
  peerClass: PeerClass,
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): readonly EgressPeer[] {
  return registry.filter((p) => p.peerClass === peerClass);
}

/** عدُّ المُدخلاتِ لكلِّ صنفٍ — يُستعملُ في الوثيقةِ المُولَّدةِ وفي الرسالةِ. */
export function countByClass(
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): ReadonlyMap<PeerClass, number> {
  const out = new Map<PeerClass, number>();
  for (const p of registry) out.set(p.peerClass, (out.get(p.peerClass) ?? 0) + 1);
  return out;
}

/** المقاصدُ المُلزَمةُ بالبوّابةِ وقتَ التشغيلِ. */
export function gatedPeers(
  registry: readonly EgressPeer[] = WASLA_EGRESS_REGISTRY,
): readonly EgressPeer[] {
  return registry.filter((p) => p.runtimeGate.kind === "gated");
}
