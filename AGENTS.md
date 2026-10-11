# نقطةُ الدخول — لكلِّ مبرمجٍ أو وكيلٍ يستلمُ المستودع

اقرأْ هذا الملفَّ أوّلًا، ثمَّ تحقّقْ من الحالةِ بنفسِك (§4) قبلَ أيِّ إجراء. هذا الملفُّ **دليلٌ إلى المصادر**: لا يحلُّ محلَّها، ولا يُسجَّلُ فيه تقدُّمُ عمل.

## 1. المشروعُ باختصار

**«وَصْلة (WASLA)»**: منصّةُ مشاويرَ وتوصيلٍ عبرَ تيليجرام. السطحُ الأساسيُّ Mini App، والبوتاتُ طبقةٌ رقيقة (ADR 0213). ومدنُ الإطلاقِ في `README.md`. وهي **قبلَ الإطلاقِ التجاريّ**، ومنفصلةٌ عن `wasla-core` و`wasla-market` بتعليمةِ المالك `O-7` (`README.md`).

| المكوّن | المسار | ملاحظة |
|---|---|---|
| البوّابة (HTTP + webhooks + Socket.IO + `/admin`) | `apps/gateway` | خدمةُ Render `waslah-gateway` (Docker، Frankfurt). **والعاملُ الخلفيُّ يعملُ داخلَ عمليّتِها** (`PROCESS_TOPOLOGY=single-process` في `render.yaml`) |
| الـMini App | `apps/miniapp` | Vite + Preact (`preact/compat`، ADR 0258). موقعٌ ساكنٌ `waslah-miniapp` |
| العاملُ ولوحتا الإدارة | `apps/workers` · `apps/admin` · `apps/admin-dashboard` | |
| المنطق | `packages/{domain,application,infrastructure,shared,maps,tracking,agent-core}` | |
| القاعدة | `supabase/migrations` | Supabase، `ap-southeast-2` |
| الاختبارات | `tests/{unit,integration,e2e,real-redis,…}` + ملفّاتُ `*.test.ts` بجوارِ الكود | |
| المؤجَّل عمدًا | `deferred/` | ليسَ كودًا مهجورًا: `deferred/core-integration/README.md` |

## 2. مصادرُ الحقيقة — مرجعٌ واحدٌ لكلِّ سؤال

| السؤال | المرجعُ المعتمَد | ملاحظة |
|---|---|---|
| هل الإنتاجُ جاهز؟ وما المحجوبُ ولماذا؟ | `docs/governance/PRODUCTION_READINESS_GATE.md` | **الحالاتُ تتغيّرُ هنا وحدَه، وبدليلٍ يستوفي شرطَ البند** |
| أسئلةٌ تنتظرُ قرارَ المالك | `docs/governance/OWNER-QUESTIONS-20261009.md` | |
| ما الحالةُ الراهنةُ لكلِّ بندٍ هندسيّ، وسجلُّ ما نُفِّذ | `docs/SYSTEM_STATE.md` | سجلٌّ تراكميّ: الأحدثُ قربَ الأعلى |
| خارطةُ البنودِ ومعاييرُ قبولِها | `docs/ROADMAP-MASTER.md` (الحاكمة) · `docs/ROADMAP-PRODUCT-DEBT.md` (زيادةٌ لها) | |
| سجلُّ التنفيذِ المرتبطُ بالتغييرات | `ROADMAP.md` | يفرضُه `check-roadmap.mjs` على كلِّ تغييرٍ في الكود |
| لماذا اتُّخذَ قرارٌ معماريّ | `docs/adr/NNNN-*.md` | الترقيمُ يفرضُه `check-adr-numbering.ts` |
| قراراتُ المالكِ التجاريّةُ والتشغيليّة | `docs/decisions/DEC-*.md` | |
| أدلّةُ التحقّق | `docs/evidence/**` (الإنتاج: `docs/evidence/production/`) | يُحفَظُ ولا يُحذَف |
| مُلزِماتُ العمل | `docs/MASTER_DIRECTIVE.md` · `docs/UI_UX_CANONICAL_DIRECTIVE.md` | |
| واجهاتُ API | `docs/api.md`، والكودُ هو الحكَم: `apps/gateway/src/routes/` | |
| التشغيلُ والحوادثُ والتراجع | `docs/runbook.md` · `docs/rollback.md` · `docs/render-deployment-vars.md` | |
| بيئةُ التطويرِ المحلّيّة | `docs/runtime-prerequisites.md` | |
| حزمةُ كلِّ تغيير (الملفّاتُ والوثائقُ المتأثّرة) | `docs/work-packets/*.json` | يفرضُها `check-state-sync.ts` |
| ما هو تاريخيٌّ فقط | `docs/archive/` | **ليسَ مرجعًا للحالةِ الراهنة** |

## 3. القيودُ النافذة

- **`PRD-010` — تجميدُ الميزاتِ الجديدة:** نافذ. واستثناؤه الوحيدُ المعتمَدُ إحلالُ مكتبةِ العرض (Preact، ADR 0258). وإصلاحُ الأعطالِ ليسَ ميزة.
- **الدمجُ والنشرُ بموافقةٍ صريحةٍ من المالك:**
  - `main` غيرُ محميٍّ تقنيًّا، والقيدُ إجرائيٌّ لا تقنيّ.
  - و`autoDeploy: false` للخدمتَين، فالنشرُ يدويٌّ دائمًا.
- **لا تغييرَ لبياناتِ الإنتاجِ بغرضِ الاختبار:** ولا عرضَ لأسرار، ولا وضعَ لـ`initData` أو رموزِ جلسةٍ حقيقيّةٍ في المستودعِ أو السجلّات.
- **حالاتُ البنود:**
  - لا يُرفَعُ بندٌ إلى `Verified` إلّا بدليلٍ يستوفي شرطَه.
  - نجاحُ CI أو النشرِ ليسَ تحقّقًا من عميلِ تيليجرامَ حقيقيّ.
  - ولا يُختلَقُ نتيجةُ جهازٍ لم يُختبَر.

## 4. كيفَ تبدأ — تحقّقْ ولا تفترض

```bash
# حالةُ GitHub: رأسُ main، والطلباتُ المفتوحة، والفروع
git fetch --prune origin && git log --oneline -1 origin/main
gh pr list --repo uxxxug/ceezr --state open
git branch -r

# الإنتاج (قراءةٌ عامّة لا تغيّرُ شيئًا)
curl -s https://waslah-gateway.onrender.com/ready     # المتوقَّع: "status":"ready"
# ما الـcommitُ المنشور؟ من Render (deploys للخدمتين)، لا من الوثائق.

# الفحوصُ المحلّيّةُ نفسُها التي يشغّلُها CI
bun install
bun run ci          # lint + typecheck + build + الحواجز + الاختبارات
```

ثمَّ اقرأْ ما يمسُّ مهمّتَك فقط من §2. وإن وجدْتَ تعارضًا بينَ وثيقةٍ والكود، **فالكودُ والدليلُ الحيُّ يحكمان**، وصحِّحِ الوثيقةَ في التغييرِ نفسِه.

### لقطةٌ موثَّقة — 2026-10-11 (أعِدْ حسابَها بالأوامرِ أعلاه، فقد تتقادم)

| | القيمة | كيفَ تُحقِّقُها |
|---|---|---|
| `main` | `b8027993` (#483) | `git log -1 origin/main` |
| الإنتاج — gateway | `9519056f` (#466). ولا فرقَ في `apps/gateway` و`packages` و`supabase` و`render.yaml` بينَه وبينَ `main` | Render deploys + `git diff --stat 9519056f origin/main -- apps/gateway packages supabase render.yaml` |
| الإنتاج — miniapp | `22a3898d` (#479، Preact). وما بعدَه في `apps/miniapp` اختباراتٌ فقط حتّى `main` | Render deploys |
| staging | `waslah-miniapp-staging` **موقوف** (suspended). ولا بيئةَ staging عاملة (`PRD-201` Blocked) | Render |
| `/ready` | `ready`، و`degradedChecks: []` | `curl` |
| بنودُ الجاهزيّة | Verified: 001 · 002 · 003 · 102 · 103 · 104 · 106. ADR-Closed: 004–007 · 105. Ready: 010. **Blocked**: 008 · 009 · 101 · 201–205 | البوّابةُ (§2) |
| طلبٌ مفتوح | #484: إصلاحُ تسلسلِ الإقلاع (ADR 0259). **غيرُ مدموجٍ وغيرُ منشور** | `gh pr list` |

## 5. عندَ كلِّ تغيير — ما يُحدَّثُ وأين

1. **تغييرٌ في `apps/` أو `packages/` أو `scripts/` أو `supabase/`:**
   - حزمةٌ في `docs/work-packets/`.
   - وصفٌّ في `docs/SYSTEM_STATE.md`.
   - وملاحظةٌ في `ROADMAP.md`.
   - والحواجزُ ترفضُ الدمجَ بدونها.
2. **قرارٌ معماريّ:** ADR جديدٌ بالرقمِ التالي. لا تُعدَّلُ ADRاتٌ نافذةٌ لتطابقَ ما بُني، بل يُكتَبُ ADR يحلُّ محلَّها.
3. **دليلُ تحقّق:** في `docs/evidence/<المجال>/`. ويفصلُ بينَ أربعِ مراتب:
   - محلّيّ.
   - متصفّحٌ آليّ.
   - تيليجرامُ حقيقيّ.
   - إنتاج.
   - ويذكرُ ما لم يُقَس.
4. **تغيّرُ حالةِ بندِ جاهزيّة:** في البوّابةِ وحدَها، مع رابطِ الدليل.
5. **تقريرُ وكيلٍ أو ملخّصُ جلسة لا يُضافُ وثيقةً في `docs/`.** ما فيه من قرارٍ يذهبُ إلى ADR، وما فيه من دليلٍ يذهبُ إلى `docs/evidence/`، وما فيه من حالةٍ يذهبُ إلى `SYSTEM_STATE`. ويفرضُ ذلك `scripts/check-docs-hygiene.ts`:
   - لا ملفَّ جديدًا في جذرِ `docs/` خارجَ القائمةِ المعتمدة.
   - لا رابطَ داخليًّا مكسورًا.
   - ولكلِّ مرجعٍ في §2 وجود.
6. **الفروع:** يُحذَفُ الفرعُ بعدَ دمجِ طلبِه، وما يُترَكُ دونَ دمجٍ يُحفَظُ وسمًا `archive/<الفرع>` قبلَ حذفِه.
