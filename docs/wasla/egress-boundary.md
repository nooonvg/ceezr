# حدُّ الصادرِ في MOVE — كلُّ مقصدٍ شبكيٍّ مُعلَنٌ ومحروسٌ

الحاكمُ `ADR 0084` · البندُ `W-6` · الحاجزُ `scripts/check-egress-boundary.ts`.

البندُ `W-6` يقولُ: لا اقترانَ تجاريَّ مباشرَ مع MARKET، وكلُّ مرورٍ بينَ الأنظمةِ
عبرَ CORE. وذلكَ كانَ **صحيحاً بالمصادفةِ لا بالإنفاذِ**: لا سطرَ في المستودعِ
يُخفِقُ لو أُضيفَ نداءٌ مباشرٌ إلى MARKET غداً. فصارَت القائمةُ **مغلقةً**:
مقصدٌ غيرُ مُعلَنٍ يُسقِطُ البناءَ، وإعلانُه يقتضي نظاماً، و`MARKET` مرفوضٌ نصّاً.

<!-- BEGIN GENERATED: egress-boundary -->
> هذه الكتلةُ **مُولَّدةٌ** من `packages/shared/wasla/egress-registry.ts`. لا تُحرَّرْ بيدٍ:
> حاجزُ `check-egress-boundary` يُسقِطُ البناءَ إن فارقَت السجلَّ.

### CORE — البابُ الوحيدُ بينَ الأنظمةِ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `core-events-ingress` | إيداعُ أحداثِ `move.job.*` في بابِ CORE الشبكيِّ (`POST /v1/events`) | بيئةٌ: `CORE_EVENTS_BASE_URL` · `CORE_EVENTS_BEARER_TOKEN` | `packages/infrastructure/wasla/core-event-shipper.ts` | نعم — `createGuardedFetch` | لا |

### قناةُ المستخدمِ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `telegram-bot-api` | سطحُ MOVE التشغيليُّ كلُّه على تلغرام — إرسالٌ وتسجيلُ أوامرَ وموقعٌ حيٌّ | افتراضُ حزمةِ `grammy`: `api.telegram.org` | `packages/infrastructure/notification/telegram-client.ts` | نعم — `createGuardedFetch` | لا |
| `telegram-deep-links` | روابطُ t.me العميقةُ داخلَ نصِّ رسائلِ البوتِ (رابطُ التسجيلِ في بوّابةِ القروبِ · `PD-001`) — حرفٌ في رسالةٍ يضغطُهُ المستخدمُ، لا نداءَ شبكةٍ من الشيفرةِ | حرفاً: `t.me` | `packages/infrastructure/notification/telegram-join-gate.ts` | لا تنطبقُ: مضيفُ الروابطِ لا يُنادى من الشيفرةِ: النصُّ يسيرُ في رسالةِ تلغرامَ التي هي أصلًا قناةً مُعلَنةً مُبوَّبةً، وفتحُ الرابطِ فعلُ المستخدمِ في تطبيقِهِ لا فعْلُ الخدمةِ | لا |

### تكاملٌ تجاريٌّ مباشرٌ — دَينٌ مُعلَنٌ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `moyasar-payments` | بوّابةُ دفعٍ مباشرةٌ لاشتراكِ السائقِ — تكاملٌ تجاريٌّ لمّا يُسلَّم إلى CORE (يُزيلُه `W-7`، يحجبُه `DEP-CORE-002`) | حرفاً: `api.moyasar.com` | `packages/infrastructure/financial/moyasar-provider.ts` | نعم — `createGuardedFetch` | لا |
| `tap-payments` | بوّابةُ دفعٍ مباشرةٌ بديلةٌ — تكاملٌ تجاريٌّ لمّا يُسلَّم إلى CORE (يُزيلُه `W-7`، يحجبُه `DEP-CORE-002`) | حرفاً: `api.tap.company` | `packages/infrastructure/financial/tap-provider.ts` | نعم — `createGuardedFetch` | لا |

### بنيةٌ تحتيّةٌ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `socket-io-server` | مكتبةُ Socket.IO لقناةِ الرحلةِ الآنيةِ (F4-04، ADR 0042) — خادمٌ يستقبلُ اتصالاتٍ لا يصلُ إلى مضيفٍ خارجيٍّ | افتراضُ حزمةِ `socket.io`: `socket.io` | `apps/gateway/src/realtime/ride-channel.ts` | لا تنطبقُ: خادمٌ يستقبلُ اتصالاتِ WebSocket من المتصفّحِ على المنفذِ نفسِه لا يصلُ إلى مضيفٍ خارجيٍّ. | لا |
| `supabase-postgres` | قاعدةُ البياناتِ — مخزنُ الحقيقةِ الوحيدُ | بيئةٌ: `DATABASE_URL` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | `packages/infrastructure/db/client.ts` | لا تنطبقُ: ناقلُه بروتوكولُ PostgreSQL على مقبسٍ لا `fetch`، فلا موضعَ للبوّابةِ فيه؛ ومضيفُه من البيئةِ يفحصُه `assertEgressEnvironment`. | لا |
| `supabase-object-storage` | مخزنُ الأجسامِ — روابطُ رفعٍ موقَّعةٌ لوثائقِ السائقِ (F3-01) | بيئةٌ: `OBJECT_STORAGE_URL` · `OBJECT_STORAGE_SECRET_KEY` · `DRIVER_DOCUMENTS_BUCKET` | `packages/infrastructure/storage/signed-upload.ts` | نعم — `createGuardedFetch` | لا |
| `gateway-internal-offers-signal` | مسارُ إشارةِ لوحِ العروضِ الداخليُّ بينَ شوطِ التسليمِ والبوابةِ (متصلٌ؟ بُثَّتْ لهُ) — بابُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ | بيئةٌ: `GATEWAY_INTERNAL_URL` · `INTERNAL_SIGNAL_SECRET` | `packages/infrastructure/dispatch/offer-board-delivery.ts` | نعم — `createGuardedFetch` | لا |
| `gateway-internal-rider-trip-signal` | ADR 0287 — إشارةُ حدثِ رحلةِ الراكبِ الداخليةُ بينَ شوطِ التسليمِ والبوابةِ (متصلٌ؟ بُثَّتْ لهُ) — بابُ خدمةٍ لخدمةٍ بسرٍّ مشتركٍ | بيئةٌ: `GATEWAY_INTERNAL_URL` · `INTERNAL_SIGNAL_SECRET` | `packages/infrastructure/notification/rider-trip-app-delivery.ts` | نعم — `createGuardedFetch` | لا |
| `upstash-redis-rest` | مخزنُ الجلساتِ ومنعُ التكرارِ عبرَ المثيلاتِ | بيئةٌ: `UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` | `packages/infrastructure/redis/upstash.ts` | نعم — `createGuardedFetch` | لا |
| `google-drive-backup` | رفعُ النسخِ الاحتياطيّةِ وسحبُها — تحقُّقُ الاستعادةِ | حرفاً: `www.googleapis.com` · `oauth2.googleapis.com` | `packages/infrastructure/backup/google-drive-adapter.ts` | نعم — `createGuardedFetch` | لا |
| `metrics-collector` | تصديرُ القياسِ إلى مُجمِّعٍ خارجيٍّ — مُعطَّلٌ بلا نهايةٍ مضبوطةٍ | بيئةٌ: `METRICS_EXPORT_ENDPOINT` | `packages/infrastructure/observability/metrics-exporter.ts` | نعم — `createGuardedFetch` | لا |

### خدمةٌ اختياريّةٌ مُعطَّلةٌ افتراضيّاً

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `deepl-translation` | ترجمةٌ آليّةٌ — `TRANSLATION_PROVIDER=deepl`، ومُعطَّلٌ بـ`none` افتراضيّاً | حرفاً: `api.deepl.com` · `api-free.deepl.com` | `packages/infrastructure/i18n-translation/translation-providers.ts` | نعم — `createGuardedFetch` | لا |
| `google-translation` | ترجمةٌ آليّةٌ عبرَ Google — نهايتُها الرسميّةُ ونهايةُ الويبِ المجّانيّةُ | حرفاً: `translation.googleapis.com` · `translate.googleapis.com` | `packages/infrastructure/i18n-translation/translation-providers.ts` | نعم — `createGuardedFetch` | لا |
| `mymemory-translation` | ترجمةٌ آليّةٌ مجّانيّةٌ بلا مفتاحٍ — مزوّدُ تجربةٍ لا إنتاجٍ | حرفاً: `api.mymemory.translated.net` | `packages/infrastructure/i18n-translation/translation-providers.ts` | نعم — `createGuardedFetch` | لا |
| `osrm-routing` | حسابُ المسارِ والمسافةِ — `ROUTING_PROVIDER=osrm`، ومُعطَّلٌ افتراضيّاً | بيئةٌ: `OSRM_BASE_URL` | `packages/maps/providers/osrm/osrm-provider.ts` | نعم — `createGuardedFetch` | لا |
| `map-tiles` | بلاطاتُ الخريطةِ ونمطُها للوحةِ الإدارةِ — مُعطَّلٌ بلا رابطٍ مضبوطٍ | بيئةٌ: `MAP_STYLE_URL` · `MAP_TILES_PUBLIC_KEY` | `packages/maps/providers/maplibre/maplibre-style.ts` | لا تنطبقُ: بلاطاتٌ ونمطٌ يُحمَّلانِ في متصفّحِ المُشرِفِ، فالنداءُ من جهازِه لا من هذه العمليّةِ؛ والبوّابةُ تحرسُ صادرَ العمليّةِ وحدَه. | لا |

### أصلُ متصفّحٍ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `unpkg-maplibre` | مكتبةُ MapLibre تُحمَّلُ في متصفّحِ المُشرِفِ من شبكةِ توصيلٍ، ببصمةِ سلامةٍ | حرفاً: `unpkg.com` | `packages/maps/providers/maplibre/maplibre-style.ts` | لا تنطبقُ: أصلٌ يُحمِّلُه المتصفّحُ ببصمةِ سلامةٍ، ولا نداءَ من الخادمِ ألبتّةَ. | لا |

### رابطُ مستخدمٍ — لا نداءَ شبكةٍ

| المقصدُ | الغرضُ | المصدرُ | موضعُ النداءِ | بوّابةُ التشغيلِ | أُزيلَ؟ |
|---|---|---|---|---|---|
| `google-maps-link` | رابطٌ يُعرَضُ للمُشرِفِ لينقرَه فيرى موقعَ سائقٍ — لا نداءَ شبكةٍ من هنا | حرفاً: `maps.google.com` | `apps/admin-dashboard/src/pages/driver-detail.ts` | لا تنطبقُ: رابطٌ يُعرَضُ لينقرَه المُشرِفُ، ولا نداءَ شبكةٍ من هذه العمليّةِ. | لا |
| `google-maps-link-driver-job` | رابطُ ملاحةٍ تبنيه البوّابةُ في حمولةِ المَهمّةِ ليفتحَه السائقُ (`F3-03`) — لا نداءَ شبكةٍ | حرفاً: `maps.google.com` | `packages/domain/places/place-open-url.ts` | لا تنطبقُ: نصٌّ يُنشَرُ في الحمولةِ ليُمَرَّرَ إلى `openExternalLink` في المصغَّرِ، ولا نداءَ شبكةٍ من البوّابةِ ألبتَّةَ. | لا |
| `place-link-recognition` | `LOC-TRUST-01` — مضيفاتُ خرائطَ يُتعرَّفُ بها رابطُ موقعٍ لصقَه الراكبُ (قائمةُ سماحٍ) — مقارنةُ نصٍّ لا نداءَ شبكةٍ | حرفاً: `maps.apple.com` · `waze.com` · `www.waze.com` · `ul.waze.com` · `openstreetmap.org` · `www.openstreetmap.org` · `osm.org` | `packages/domain/places/place-input.ts` | لا تنطبقُ: الرابطُ يُحفَظُ نصّاً ويفتحُه السائقُ من جهازِه؛ ولا يُجلَبُ ولا يُتبَعُ تحويلُه من الخادمِ ألبتَّةَ. | لا |

### مضيفاتٌ معفاةٌ — نُوّابٌ لا مقاصدُ

| المضيفُ | السببُ |
|---|---|

**العدُّ**: 22 مقصداً مُعلَناً · 2 تكاملاً تجاريّاً مباشراً ينتظرُ التسليمَ · 0 مضيفاً معفًى · **صفرَ مقصدٍ في MARKET**.
<!-- END GENERATED: egress-boundary -->
