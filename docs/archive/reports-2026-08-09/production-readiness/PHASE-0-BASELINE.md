# المرحلة 0 — خطّ الأساس الكامل (Baseline)

> **الغرض:** جرد كامل ومُثبَت بالأدلة للمستودع كما هو، قبل أي إصلاح.
> **القاعدة الحاكمة:** لا تُصنَّف قدرة كـ `IMPLEMENTED` إلا إذا كانت موصولة فعلياً بالمسار التشغيلي.
> **التاريخ:** 2026-08-11 · **المرجع:** `main` · **المشروع:** `noor-seez/ceezr` (اسم الحزمة: `waslah`)
>
> **⚠️ هذه الوثيقةُ لقطةٌ تاريخيّة لتاريخ 2026-08-11، لا وصفاً للحالة الراهنة.**
> أرقامُها (866 نجاحاً · 223 تخطّياً · 14 خطأَ lint · 26 ترحيلاً) تعود إلى تلك اللحظة
> وإلى بيئةٍ **بلا قاعدةِ بياناتٍ حقيقيّة**، وقد تجاوزتها الحالةُ الفعليّة. المرجعُ
> الحاكمُ للحالة الراهنة هو **`docs/SYSTEM_STATE.md`**. تُحفَظ هذه الوثيقةُ كما هي
> لأنّها الأساسُ الذي تُقاس عليه المراحلُ اللاحقة، ولا يجوز الاستشهادُ بأرقامها
> كأرقامٍ حاليّة.

---

## 0.1 خطّ الأساس التنفيذي (Executed Gates)

| البوابة | الأمر | النتيجة | الدليل |
|---|---|---|---|
| Install | `bun install --frozen-lockfile` | ✅ نجح — 20 حزمة | Bun 1.3.14 |
| Typecheck | `bun run typecheck` (`tsc --noEmit`) | ✅ **نجح — صفر أخطاء** | خرج بلا مخرجات |
| Lint | `bun run lint` (`biome check .`) | ❌ **فشل — 14 error، 1 warning، 9 infos** | 588 ملفاً مفحوصاً |
| Test | `bun test` | ⚠️ **866 pass · 223 skip · 0 fail** | 1089 اختباراً عبر 76 ملفاً، 2990 expect |
| Build | لا يوجد أمر `build` في `package.json` | ⚠️ غير موجود | التشغيل مباشر عبر `bun run apps/gateway/src/index.ts` |

**الحقيقة الحاسمة في خط الأساس:** الـ 223 اختباراً المتخطّاة ليست اختبارات ثانوية —
هي **كل** اختبارات التكامل و E2E. كلها محروسة بـ:

```ts
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
```

> **دقّةُ الاقتباس (حُلَّ في دمج 2026-08-19):** الثابتُ المحليّ في ملفّات الاختبار
> اسمُه `DATABASE_URL` لكنّه **يقرأ `TEST_DATABASE_URL`** من البيئة. فالسطرُ أعلاه
> منقولٌ حرفيّاً عن الكود، والمتغيّرُ الذي يجب أن يُعيَّن هو `TEST_DATABASE_URL`.

أي أن **جميع المسارات التجارية الحقيقية غير مُثبَتة في هذه البيئة**: الرحلة الكاملة،
التوصيل الكامل، التسجيل، الحجب، التقييمات، الإلغاء، التصعيد، القفل الموزّع،
جلسات Redis، الاختبارات العدائية، وصمود الثلاثين رحلة. الـ 866 اختباراً الناجحة
هي اختبارات وحدة على منطق نقي ومزدوجات في الذاكرة.

> ⛔ **لا يجوز الاستناد إلى `866 pass` كدليل جاهزية.** طبقاً لقاعدة المستخدم:
> «لا تعتبر unit tests دليلاً على أن feature تعمل end-to-end».

---

## 0.2 الجرد البنيوي

### الأرقام
- **698** ملفاً · **580** TypeScript · **26** SQL migration · **65** Markdown
- **~58,363** سطراً (ts + tsx + sql)
- Monorepo عبر Bun workspaces: `apps/*` + `packages/*`

### التطبيقات (`apps/`)
| التطبيق | الوصف | الحالة |
|---|---|---|
| `gateway` | خادم Hono: ويبهوك تلغرام، لوحة إدارة، صحّة، ويبهوك دفع | مُركَّب فعلياً |
| `workers` | 7 مهامّ دورية بقفل موزَّع | مُركَّب فعلياً |
| `admin-dashboard` | HTML مُصيَّر من الخادم (ADR 0007) | مُركَّب فعلياً |

### الحزم (`packages/`)
- **`domain/`** — 24 مجالاً (dispatch, financial, identity, transport, delivery, kyc, safety, …)
- **`application/`** — 27 مجالاً + `ports/`
- **`infrastructure/`** — 26 مجالاً + `db/` + `backup/`
- **`agent-core/`** — 13 وحدة (brain, memory, learning, policies, guardrails, evaluation, …)
- **`maps/`** — `core/` (تجريدات) + `providers/osrm/`
- **`tracking/`** — 4 ملفات
- **`shared/`** — config, i18n, kernel, result

### المسارات (Routes) في البوابة
| الملف | مُركَّب في `server.ts`؟ |
|---|---|
| `health.ts` | ✅ نعم |
| `telegram-webhook.ts` | ✅ نعم |
| `payment-webhook.ts` | ✅ نعم (مشروط بوجود أسرار الدفع) |
| `admin-api.ts` | ✅ نعم (يُركَّب في `index.ts`) |
| `admin-ui.ts` | ✅ نعم (يُركَّب في `index.ts`) |
| **`tracking.ts`** | ❌ **لا — غير مُركَّب إطلاقاً** |

### المهامّ الدورية (`apps/workers/src/jobs/`)
`backup-database` · `cleanup-stale-sessions` · `expire-offers` · `expire-subscriptions` ·
`recompute-ratings` · `rotate-unsubscribed-negotiation` · `sweep-unmatched-orders`

### الهجرات (26)
من `20260806120000_phase_2_1_core_schema` حتى `20260811170000_city_change_rpc`.
تُفعّل `postgis`، وتُنشئ `drivers.last_location geography(Point,4326)` مع فهرس GiST
(`drivers_location_gix`)، و`orders.pickup/dropoff geography`.

### دوالّ القاعدة / RPCs (~50)
`claim_ride` · `start_ride` · `complete_ride` · `cancel_order_by_rider` · `escalate_order` ·
`activate_subscription` · `start_trial` · `expire_due_subscriptions` · `expire_stale_offers` ·
`create_payment` · `confirm_payment` · `record_webhook_event` · `submit_rating` ·
`recompute_rating_averages` · `open_support_ticket` · `claim_support_ticket` ·
`issue_admin_login_code` · `consume_admin_login_code` · `open_admin_session` ·
`register_unsubscribed_claim` · `advance_unsubscribed_negotiation` · `settle_unsubscribed_negotiation` ·
`admin_set_driver_verification` · `admin_set_user_blocked` · `update_driver_city` … إلخ.

### التكاملات الخارجية
Telegram (grammY, بوتان) · Supabase/PostgreSQL + PostGIS · Upstash Redis (REST) ·
Google Drive (نسخ احتياطي) · مزوّد دفع (tap/moyasar/hyperpay — **بلا تنفيذ فعلي**) ·
OSRM (**غير مستخدَم في أي مسار إنتاج**) · مزوّدو ترجمة (deepl/google/mymemory).

---

## 0.3 الاكتشاف المركزي: **نظامان متوازيان للموقع**

هذا أهمّ ما في خط الأساس، وهو يحكم المراحل 2 و4 و6 و8 و13 و14.

### المسار (أ) — المسار التشغيلي الحيّ ✅ يعمل
```
السائق يشارك موقعه عبر تلغرام
  → packages/infrastructure/identity/directories.ts:133
  → UPDATE drivers SET last_location = ST_SetSRID(ST_MakePoint(…),4326), last_location_at = now()
  → packages/infrastructure/dispatch/dispatch-adapters.ts:119  (ST_Y / ST_X للقراءة)
  → مرشّحو الإسناد → عرض → claim_ride
```
**مصدر الحقيقة الفعلي اليوم = `drivers.last_location` في PostGIS.** مثبت بالكود، ومغطّى
باختبار تكامل مخصّص (`tests/integration/driver-location-visibility.test.ts`) وبلوحة الإدارة
(`apps/gateway/src/admin/queries.ts:565`).

### المسار (ب) — طبقة التتبّع ❌ غير موصولة إطلاقاً
```
apps/gateway/src/routes/tracking.ts   (203 سطر)
  → packages/tracking/tracking-service.ts (TrackingService)
      → LocationStore   ← واجهة بلا أي تنفيذ في الإنتاج
      → TrackingEventPublisher ← واجهة بلا أي تنفيذ في الإنتاج
      → TrackingTokenStore ← واجهة بلا أي تنفيذ في الإنتاج
```

**الأدلة القاطعة:**
1. `grep -rn "createTrackingRoutes"` → يظهر **فقط** في `tests/unit/tracking-route.test.ts` و في تعريفه ذاته. **غير مذكور في `server.ts` ولا `container.ts` ولا `index.ts`.**
2. `LocationStore` / `TrackingTokenStore` / `TrackingEventPublisher` — لا يوجد أي `implements`/factory لها خارج `tests/`.
3. `TrackingService.handleGpsUpdate` يكتب إلى `store.setCurrent(...)` — **ولا يكتب إلى `drivers.last_location` إطلاقاً**. لو وُصل كما هو، لأنتج **مصدر حقيقة ثانياً** يخالف قاعدة المستخدم رقم 5 مباشرة.
4. لا يوجد أي WebSocket / SSE / Pub-Sub في المستودع: `grep` على `upgradeWebSocket`, `EventSource`, `text/event-stream` → **صفر نتائج**. كلمة "realtime" لا تظهر إلا في أسماء ومهامّ لا علاقة لها بالنقل اللحظي.
5. `MapRenderer` واجهة في `packages/maps/core/map-provider.ts` — **لا يوجد أي تنفيذ لها**. `grep -i maplibre` على كل `*.ts` → **صفر نتائج** (المصطلح موجود في `.env.example` و`render.yaml` فقط).

### الحكم
> طبقة التتبّع/الخرائط الحالية هي **SCAFFOLDING/UNWIRED بالكامل**، ووصلها كما هو
> يخلق مصدر حقيقة ثانياً. القرار المعماري الصحيح (يُوثَّق في ADR بالمرحلة 4):
> **`drivers.last_location` في PostGIS هو المصدر الوحيد للحقيقة**، و`TrackingService`
> يجب أن يكتب إليه، وRedis — إن استُخدم — يكون cache/realtime aid لا مصدراً مستقلاً.

---

## 0.4 تصنيف القدرات

| # | القدرة | التصنيف | الدليل |
|---|---|---|---|
| 1 | ويبهوك تلغرام + بوتان (سائق/راكب) | `IMPLEMENTED` · `UNTESTED_E2E` | مُركَّب في `server.ts`؛ كل اختبارات التكامل متخطّاة |
| 2 | حوارات البوت (تسجيل، طلب، توصيل) | `IMPLEMENTED` · `UNTESTED_E2E` | `driver-dialog.ts` 1260 سطر، `rider-dialog.ts` 1019 |
| 3 | Dispatch: مطابقة/عروض/claim ذرّي | `IMPLEMENTED` · `UNTESTED_E2E` | `claim_ride` RPC + `dispatch-adapters.ts` |
| 4 | التفاوض مع غير المشتركين | `IMPLEMENTED` · `UNTESTED_E2E` | 3 RPCs + `negotiation-adapters.ts` |
| 5 | مواقع السائقين عبر PostGIS | `IMPLEMENTED` · `UNTESTED_E2E` | `last_location` + فهرس GiST |
| 6 | لوحة الإدارة (HTML من الخادم) | `IMPLEMENTED` · `UNTESTED_E2E` | `queries.ts` 1487 سطر |
| 7 | مصادقة الإدارة (رمز + جلسة) | `IMPLEMENTED` · `UNTESTED_E2E` | `issue/consume_admin_login_code`, `open_admin_session` |
| 8 | تذاكر الدعم | `IMPLEMENTED` · `UNTESTED_E2E` | RPCs + هجرة 2.4 |
| 9 | التقييمات المتبادلة | `IMPLEMENTED` · `UNTESTED_E2E` | هجرة 2.5 |
| 10 | الاشتراكات + التجربة | `IMPLEMENTED` · `UNTESTED_E2E` | `start_trial`, `activate_subscription` |
| 11 | المهامّ الدورية + القفل الموزَّع | `IMPLEMENTED` · `UNTESTED_E2E` | 7 مهامّ + ADR 0009 |
| 12 | جلسات Redis (Upstash REST) | `IMPLEMENTED` · `UNTESTED_E2E` | ADR 0011؛ الافتراضي `memory` |
| 13 | حدّ المعدّل (fixed-window) | `IMPLEMENTED` | `rate-limit/fixed-window.ts` + اختبار وحدة |
| 14 | i18n / الترجمة | `IMPLEMENTED` | 4 مزوّدين + اختبارات |
| 15 | النسخ الاحتياطي إلى Google Drive | `PARTIALLY_IMPLEMENTED` | تُنشَأ النسخة — **لا استعادة ولا تحقّق سلامة** |
| 16 | **الدفع** | `SCAFFOLDING` | `PAYMENT_PROVIDER` بلا أي تنفيذ لمزوّد فعلي؛ `.env.example` يقول صراحة «البنية قائمة بلا مزوّد» |
| 17 | **التتبّع اللحظي** | `UNWIRED` | المسار غير مُركَّب؛ 3 منافذ بلا تنفيذ |
| 18 | **Realtime** | `NOT_IMPLEMENTED` | صفر WebSocket/SSE/PubSub في المستودع |
| 19 | **الخرائط (MapRenderer)** | `SCAFFOLDING` | واجهة بلا تنفيذ؛ صفر MapLibre |
| 20 | **OSRM Routing** | `IMPLEMENTED_BUT_UNWIRED` · `BROKEN` | لا يُستدعى من أي مسار إنتاج + خلل في `table` (§0.5) |
| 21 | **DriverLocator** | `NOT_IMPLEMENTED` | لا يوجد مفهوم منفصل؛ `nearest` في OSRM يُنتج معرّفات وهمية |
| 22 | **ETA** | `NOT_IMPLEMENTED` | لا خدمة ولا واجهة |
| 23 | **Map Matching** | `NOT_IMPLEMENTED` | لا تجريد |
| 24 | **Geofencing** | `NOT_IMPLEMENTED` | لا كود |
| 25 | Agent Core | `IMPLEMENTED` · `PARTIALLY_TESTED` | 13 وحدة + 5 اختبارات وحدة + 2 تكامل متخطَّيان |
| 26 | Observability | `PARTIALLY_IMPLEMENTED` | سجلّ JSON عبر `console.log` فقط؛ لا `trace_id`/metrics/dependency health |
| 27 | Deployment (Render) | `PARTIALLY_IMPLEMENTED` | `render.yaml` + Dockerfiles؛ **`bun-version: latest` في CI**، لا staging، لا rollback موثّق |
| 28 | Load Testing | `PARTIALLY_IMPLEMENTED` | `scripts/load-test.ts` + `docs/load-test-report.md`؛ لا نتائج p50/p95/p99 لسلّم 100→10k |
| 29 | Disaster Recovery | `NOT_READY` | لا اختبار استعادة، لا RPO/RTO |
| 30 | Privacy / Data Governance | `NOT_IMPLEMENTED` | لا سياسة احتفاظ لبيانات الموقع |
| 31 | Commercial / Legal | `NOT_STARTED` | لا Commercial Launch Checklist |

---

## 0.5 العيوب المؤكّدة (مُثبَتة بقراءة الكود)

### 🔴 P0-1 — طبقة التتبّع بأكملها غير موصولة
`apps/gateway/src/routes/tracking.ts` غير مُركَّب في `server.ts`. لا `LocationStore`،
لا `TrackingTokenStore`، لا `TrackingEventPublisher` في الإنتاج.
**الأثر:** `POST /track/gps` يُرجع 404 في الإنتاج. المرحلة 2/6/7/11/12/13 كلها مبنية على طبقة غير موجودة تشغيلياً.

### 🔴 P0-2 — لا مسار لإصدار أوّل رمز تتبّع (Chicken-and-Egg)
`POST /track/session/start` نفسه محروس بـ `requireAuth`، فهو يتطلّب رمزاً صالحاً كي **يصدر** رمزاً.
لا يوجد أي مسار في المستودع يُصدر الرمز الأول من هوية السائق في تلغرام.
**الأثر:** حتى لو رُكِّب المسار، لا سبيل لاستعماله.

### 🔴 P0-3 — التتبّع لا يتحقّق من ملكية الرحلة
الرمز يحمل `tripId` ثابتاً منذ إصداره. لا تحقّق خادمي بأن `tripId` يخصّ `driverId`،
ولا بأن الرحلة **ما زالت نشطة**. لا يوجد `TrackingSession` مُخزَّن — `startSession` ينشر حدثاً فقط ولا يكتب حالة.
**الأثر:** GPS بعد إنهاء الرحلة يُقبَل ما دام الرمز صالحاً (8 ساعات). لا يمكن إثبات «رفض GPS بعد الإنهاء».

### 🔴 P0-4 — لا Realtime إطلاقاً
لا WebSocket، لا SSE، لا Pub/Sub. `TrackingEventPublisher` واجهة بلا ناقل.
**الأثر:** المراحل 6/7/11/12/13 غير قابلة للتنفيذ على الوضع الحالي دون إضافة ناقل.

### 🟠 P1-5 — التحقّق من GPS ناقص وخطر
`apps/gateway/src/routes/tracking.ts:81` يستخدم `Number.isNaN(lat)` فقط:
```ts
if (Number.isNaN(lat) || Number.isNaN(lng)) { … }
```
`Number("Infinity")` يمرّ. **لا يوجد أي فحص لحدود `-90..90` و`-180..180`** في المسار ولا في `location-validator.ts`.
`speed`/`accuracy` السالبة تمرّ. `heading` بلا نطاق. الطابع الزمني المستقبلي يُعامَل كالماضي (`Math.abs`).
**لا يوجد فحص للترتيب (out-of-order) ولا للتكرار (duplicate) ولا للإعادة (replay).**

### 🟠 P1-6 — سياسة الرفض غير مفصولة
`tracking-service.ts:83` — كل انحراف = رفض كامل. وأسوأ: التصنيف يتمّ بمطابقة نصّية:
```ts
type: validation.reason?.includes("Teleport") ? "teleport_detected" : "speeding_detected"
```
دقّة GPS الضعيفة تُنشر كـ `speeding_detected`. لا فصل بين `REJECT` / `WARNING` / `ALERT`.

### 🟠 P1-7 — حالة داخل الذاكرة تكسر التوسّع
`TrackingService.previousPositions = new Map<...>()` — حالة في ذاكرة العملية.
مع أكثر من نسخة بوابة، كل نسخة ترى تاريخاً مختلفاً ⇒ فحص teleport غير موثوق ونتائج غير حتمية.

### 🟠 P1-8 — خلل حسابي مؤكّد في OSRM Table
`packages/maps/providers/osrm/osrm-provider.ts:139`:
```ts
`?sources=${srcIdx}&destinations=${destStart};${destinations.length - 1}`
```
هذا يرسل **وجهتين فقط** بالفهرسين `destStart` و`destinations.length - 1`، لا مدى الوجهات.
الصحيح: `destStart, destStart+1, …, destStart+n-1` مفصولة بـ `;`.
مع 3 مصادر و3 وجهات يصبح `destinations=3;2` — والفهرس 2 هو **مصدر** لا وجهة. مصفوفة خاطئة صامتة.

### 🟠 P1-9 — `nearest` يزيّف معرّفات سائقين
`osrm-provider.ts:121`: `driverId: \`nearest-${i}\`` — OSRM `nearest` يُرجع **نقاطاً على الطريق**، لا سائقين.
هذا بالضبط ما حذّر منه المستخدم في المرحلة 8. لا `DriverLocator` منفصل.

### 🟠 P1-10 — OSRM بلا timeout ولا retry ولا health check
`fetchJson` نداء `fetch` عارٍ. انقطاع OSRM = تعليق الطلب حتى مهلة النظام.

### 🟡 P2-11 — تعارض أسماء متغيّرات البيئة بين `.env.example` و`render.yaml`
| `.env.example` | `render.yaml` |
|---|---|
| `TRACKING_GPS_IDLE_INTERVAL_SECONDS` | `TRACKING_IDLE_INTERVAL_SECONDS` |
| `TRACKING_MAX_REASONABLE_SPEED_KMH` | `TRACKING_MAX_SPEED_KMH` |
| `MAP_TILES_URL` / `MAP_PROVIDER` | `MAP_STYLE_URL` / `MAP_TILE_PROVIDER` |
وأخطر من ذلك: **لا واحد منها يُقرأ في `packages/shared/config/index.ts`**، الذي يعرف 15 مفتاحاً فقط:
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `DRIVER_BOT_TOKEN`, `RIDER_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`BOOTSTRAP_ADMIN_TELEGRAM_ID`, `TRANSLATION_PROVIDER`, `TRANSLATION_API_KEY`, `PORT`, `SESSION_STORE` …
**كل متغيّرات التتبّع والخرائط والدفع في `render.yaml` هي حبر على ورق.**

### 🟡 P2-12 — `bun-version: latest` في CI
`.github/workflows/ci.yml`: `bun-version: latest`. البناء غير قابل لإعادة الإنتاج — بالضبط ما منعه المستخدم في المرحلة 25.

### 🟡 P2-13 — Lint فاشل (14 خطأ)
بوابة `bun run lint` حمراء في `main`، ومع ذلك CI يشغّلها. إمّا CI لم يُشغَّل على آخر دفعة، أو `main` مكسور.

### 🟡 P2-14 — لا أمر `build` ولا بيئة Staging
`package.json` بلا `build`. `render.yaml` يعرّف الإنتاج فقط. لا rollback موثّق.

---

## 0.6 القاصر الحاكم (Blocker) — بيئة قاعدة بيانات

**223 اختباراً (كل التكامل و E2E) متوقّفة على `TEST_DATABASE_URL`.** بلا قاعدة PostgreSQL
حقيقية بامتداد PostGIS، لا يمكن — بأي وسيلة — إثبات:

- المرحلة 7 (E2E للتتبّع) · المرحلة 14 (Dispatch) · المرحلة 18 (تدقيق القاعدة والتزامن)
- المرحلة 19 (الدفع) · المرحلة 20 (العمّال والتوازي) · المرحلة 22 (الاختبار)
- المرحلة 24 (الحمل) · المرحلة 26 (النسخ والاستعادة)

وكلها بوابات إلزامية في المرحلة 33. **بدون قاعدة، الحدّ الأقصى القابل للإثبات هو
«الكود صحيح ومترابط»، لا «النظام يعمل».**

---

## 0.7 قراءة الجاهزية عند خط الأساس (قبل أي إصلاح)

| المجال | % | السبب |
|---|---|---|
| Architecture | 80% | فصل نظيف ومحروس بـ CI (domain لا يستورد infrastructure)، 14 ADR |
| Implementation (المسار التجاري الأساسي) | 70% | مكتوب ومترابط، غير مُثبَت تشغيلياً |
| Security | 45% | حراسات جيّدة في القاعدة؛ التتبّع غير آمن لأنه غير موجود تشغيلياً |
| Database integrity | 70% | RPCs ذرّية + PostGIS؛ بلا تشغيل حقيقي هنا |
| Concurrency | 55% | قفل موزَّع موجود؛ اختباراته متخطّاة |
| Tracking | **10%** | UNWIRED |
| Maps | **5%** | تجريد بلا تنفيذ |
| Realtime | **0%** | لا ناقل |
| Routing | **35%** | مزوّد قائم لكنه معطوب وغير موصول |
| Dispatch | 70% | يعمل على `last_location`، غير مُثبَت |
| Payments | **20%** | بلا مزوّد فعلي |
| Workers | 65% | 7 مهامّ + قفل؛ بلا اختبار توازٍ حقيقي |
| Agent Core | 60% | معزول ومحكوم بسياسات؛ تكامله متخطَّى |
| Testing | 45% | 866 وحدة ✅ · 223 تكامل/E2E ⛔ |
| Observability | 30% | سجلّ JSON فقط |
| Deployment | 40% | Render + Docker؛ غير قابل لإعادة الإنتاج، بلا staging |
| Backup/Recovery | **20%** | نسخ بلا استعادة مُختبَرة |
| Documentation | 65% | 65 ملفاً + 14 ADR؛ بلا مخطّطات نظام |
| Commercial | **0%** | لا شيء |
| **Overall (خط الأساس)** | **~41%** | — |

> هذه النسب **قبل** أي إصلاح، ولا تُرفع إلا بدليل تنفيذي.

---

## 0.8 بوابة المرحلة 0

| البند | الحالة |
|---|---|
| جرد كامل للتطبيقات/الحزم/الهجرات/RPCs/المسارات/العمّال | ✅ |
| تصنيف كل قدرة | ✅ (31 قدرة) |
| تحديد مصادر الحقيقة المحتملة | ✅ (`drivers.last_location` مقابل `LocationStore`) |
| تحديد الوحدات غير الموصولة | ✅ (tracking, maps, OSRM) |
| تشغيل typecheck/lint/test وتسجيل النتائج | ✅ |
| تحديد القواصر | ✅ (لا `TEST_DATABASE_URL`) |

**البوابة: مفتوحة ✅ — يجوز الانتقال إلى المرحلة 1 (التدقيق الأمني).**

**المرحلة التالية:** PHASE 1 — Security Audit.
