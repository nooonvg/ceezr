# ملاحظاتُ الاستبعاد — الدفعة 21

- b21-c1-A1-750: INVALID_ENV (self-declared) — tsc/biome ran locally on the seat during this wave (~23:53Z), violating the no-heavy-work-during-wave rule. Excluded; replaced by an extra A wave.
- b21-c1-A1-750, b21-c1-B1-750, b21-c1-B2-750, b21-c1-A2-750: INVALID_ENV — قالبُ القاعدةِ ceezr_cap_tpl لم يُهاجَر إلى الرأسَين المقيسَين (ينقصُه 20261020090000 [D4، مدمجٌ في main عبرَ #601] و20261020120000 [المرشّح 1]). B: الدوالُّ الجديدةُ غائبةٌ ⇒ JOB_STORE_NOT_AVAILABLE و5xx 6.6% و0 دوراتٍ مكتملة. A: كودُ main على قاعدةٍ بلا D4. كلُّها مُستبعَدة. أُصلِحَ القالبُ (migrate.ts --from 20261019120000) في 2026-10-20T00:18Z وتُعادُ ABBA.
- b21-trace-main-250: INVALID_ENV (post_pg_probe 384) ويُستعمَلُ للعدِّ وحدَه؛ وقالبُه كذلكَ بلا D4 (لا أثرَ على عدِّ استعلاماتِ HTTP).
- b21-c1r-B2-750 و b21-c1-A2-750: INVALID_ENV — تعليقُ البيئةِ كلِّها (عيّناتُ المضيفِ بتردّد 1Hz توقّفت 591.6s عندَ 00:34:22Z و469.7s عندَ 00:08:23Z) أثناءَ انتظارٍ خامل؛ فاحصُ الصلاحيةِ لا يكشفُ الفجوات. مُستبعَدتان. الانتظارُ بعدَها داخلَ أمرٍ جارٍ فقط.
- b21-c1r-A2-750: INVALID_ENV (PREFLIGHT pg_probe 384.4 > 381) — لا حقن.
