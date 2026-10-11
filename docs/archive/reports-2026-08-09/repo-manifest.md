# بيان التحقق من المستودع (Manifest)

> **تصحيح (2026-10-02):** هذا البيان كُتب في 2026-08-06 ويوثّق حالة المستودع آنذاك
> (مستودع `reev-zeev/bnnz` بـ392 ملفاً). المستودع الحالي `uxxxug/ceezr` يحوي 2878 ملفاً
> مدفوعاً على فرع `main` برأس `440202e`. هذا الملف يبقى سجلًا تاريخيًا. الجرد الحالي
> في `docs/evidence/reconciliation-2026-10-02/inventory.csv`.

المستودع: https://github.com/reev-zeev/bnnz — الفرع `main` — آخر التزام: `8e72450`
تاريخ التحقق: 2026-08-06 13:22 UTC

المحلي والبعيد **متطابقان تماماً**: 392 ملفاً مدفوعاً، و**صفر ملف فارغ (0 بايت)**.

## أولاً: الملفات المنفَّذة فعلياً (تحمل منطقاً حقيقياً)

| الحجم (بايت) | الملف |
|---|---|
| 608 | `packages/application/dispatch/index.ts` |
| 5279 | `packages/application/dispatch/match-order.ts` |
| 2721 | `packages/application/ports/index.ts` |
| 1360 | `packages/domain/capability/entity.ts` |
| 642 | `packages/domain/capability/index.ts` |
| 6272 | `packages/domain/dispatch/entity.ts` |
| 639 | `packages/domain/dispatch/index.ts` |
| 2719 | `packages/domain/dispatch/value-objects.ts` |
| 1124 | `packages/domain/geo/entity.ts` |
| 947 | `packages/domain/geo/errors.ts` |
| 2275 | `packages/domain/geo/index.ts` |
| 1559 | `packages/domain/geo/value-objects.ts` |
| 9300 | `packages/domain/policy/entity.ts` |
| 532 | `packages/domain/policy/index.ts` |
| 2298 | `packages/domain/subscription/entity.ts` |
| 627 | `packages/domain/subscription/index.ts` |
| 3552 | `packages/domain/transport/entity.ts` |
| 640 | `packages/domain/transport/index.ts` |
| 2088 | `packages/shared/config/index.ts` |
| 1691 | `packages/shared/i18n/index.ts` |
| 1704 | `packages/shared/kernel/index.ts` |
| 1760 | `packages/shared/result/index.ts` |
| 3047 | `scripts/check-migrations.ts` |
| 4014 | `tests/support/in-memory-ports.ts` |
| 9258 | `tests/unit/dispatch-matching.test.ts` |
| 3281 | `tests/unit/geo.test.ts` |
| 11491 | `tests/unit/match-order.test.ts` |
| 4039 | `tests/unit/offer-timeout.test.ts` |
| 4980 | `tests/unit/order-state-machine.test.ts` |
| 6869 | `tests/unit/policy-settings.test.ts` |
| 1047 | `tests/unit/shared-i18n.test.ts` |
| 1219 | `tests/unit/shared-result.test.ts` |
| 4024 | `tests/unit/subscription-capability.test.ts` |

## ثانياً: ملفات SQL والوثائق

| الحجم (بايت) | الملف |
|---|---|
| 2388 | `.github/workflows/ci.yml` |
| 1935 | `README.md` |
| 22263 | `docs/MASTER_DIRECTIVE.md` |
| 650 | `docs/adr/0001-record-architecture-decisions.md` |
| 745 | `docs/adr/0002-modular-monolith-and-result-pattern.md` |
| 711 | `docs/adr/0003-city-id-on-every-table.md` |
| 2432 | `docs/adr/0004-ports-live-in-application.md` |
| 1167 | `docs/api.md` |
| 14068 | `docs/archive/reports-2026-08-09/phase-2.1-requirements.md` |
| 5903 | `docs/archive/reports-2026-08-09/phase-2.1-step-01-report.md` |
| 8238 | `docs/archive/reports-2026-08-09/phase-2.1-step-02-report.md` |
| 6905 | `docs/archive/reports-2026-08-09/phase-2.1-step-03-report.md` |
| 3735 | `docs/archive/reports-2026-08-09/roadmap.md` |
| 1365 | `docs/runbook.md` |
| 15859 | `supabase/migrations/20260806120000_phase_2_1_core_schema.sql` |
| 9883 | `supabase/migrations/20260806120100_phase_2_1_atomic_rpcs.sql` |
| 3456 | `supabase/migrations/20260806120200_phase_2_1_seed_cities_and_settings.sql` |
| 1562 | `supabase/migrations/README.md` |

## ثالثاً: الملفات التي تبدو "خالية" وهي كذلك بأمرك

عدد ملفات "هيكل فقط": **329** ملفاً.

كل ملف منها يحتوي تعليقاً وصفياً ثم `export {};` فقط، لأن القاعدة 0.8 من أمرك تنص:
"لا يجوز للوكيل أن يجتهد ويكتب منطقاً فعلياً في ملف مصنَّف هيكل فقط".
أصغر حجم فيها نحو 400 بايت، فهي ليست فارغة بل **وصفية بانتظار أمر تفعيل**.

## رابعاً: "ملفات تشغيل المدن الخمس" — أين هي فعلاً؟

المدن **ليست ملفات كود**، بل صفوف في قاعدة البيانات، وهذا مقصود: القاعدة 0.4 من أمرك تجعل `city_id`
عموداً في كل جدول، والقاعدة 0.3 تجعل كل سعر وسياسة صفّاً في `platform_settings` لا ثابتاً في الكود.
فلو كانت المدن ملفات لكان كل توسّع يحتاج نشر كود.

مكانها في المستودع:

- `supabase/migrations/20260806120200_phase_2_1_seed_cities_and_settings.sql` — يبذر **5 مدن**
  (`JED` جدة، `MKK` مكة، `RUH` الرياض، `TIF` الطائف، `MED` المدينة المنورة) و**65 صفّ إعدادات** (13 مفتاحاً × 5 مدن).
- `supabase/migrations/20260806120000_phase_2_1_core_schema.sql` — جدولا `cities` و`platform_settings`
  والقيد `cities_active_requires_groups`.

مدن الإطلاق الخمس مبذورة بـ `is_active = false` **بتصميم متعمَّد**: القيد `cities_active_requires_groups`
يمنع تفعيل أي مدينة قبل تسجيل معرّفات مجموعات تلغرام الثلاثة الخاصة بها. لا يبدأ الإطلاق حتى تُسلّم
15 معرّف مجموعة (3 لكل مدينة) وتُفعّل المدن الخمس معاً. هذا ليس نقصاً في الملفات، بل حاجزٌ مقصود يمنع تشغيل مدينة نصف مهيّأة.

## خامساً: كيف تتحقّق بنفسك في دقيقة

```bash
git clone https://github.com/reev-zeev/bnnz.git && cd bnnz
git log --oneline                       # يجب أن ترى 4 التزامات، آخرها الخطوة 3
git ls-files | wc -l                    # 393
find . -type f -empty                   # يجب ألا يطبع شيئاً
bun install && bun run typecheck && bun test   # 130 اختباراً ناجحاً / 0 فاشل
bun run scripts/check-migrations.ts      # ✅ 12 جدولاً كلها بـ city_id و RLS
grep -c "'JED'" supabase/migrations/*seed*.sql
```

> ملاحظة على واجهة GitHub: تصفّح المجلدات يدوياً مُضلّل هنا، لأن 329 ملفاً وصفياً تظهر شبه فارغة
> عند الفتح. الأمران `git ls-files | wc -l` و`find . -type f -empty` هما الحكم الفاصل.
