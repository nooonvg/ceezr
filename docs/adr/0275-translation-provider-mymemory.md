# ADR 0275: MyMemory مزوّدًا للترجمة في الإنتاج (قرار المالك)

**الحالة:** مقبول.
**التاريخ:** 2026-10-12
**المرجع:** [ADR 0274](0274-chat-location-and-translation.md) · [`STATUS.md`](../roadmap/execution/STATUS.md) بند `WR-04`
**Work Packet:** `docs/work-packets/wr-04-translation-provider-mymemory.json`

## السياق

- الترجمة في محادثة Mini App (ADR 0274) وفي مرحّل تيليجرام جاهزة في الشيفرة، لكن `render.yaml` كان يضبط `TRANSLATION_PROVIDER: none`، وقرار المزوّد مفتوح منذ ADR 0010.
- عُرضت على المالك أربعة خيارات: إبقاء الترجمة معطّلة، أو DeepL بمفتاح، أو Google بمفتاح، أو MyMemory المجاني. **اختار المالك MyMemory في 2026-10-12.**

## القرار

1. `TRANSLATION_PROVIDER=mymemory` في `render.yaml` وفي خدمة البوابة على Render.
2. لا مفتاح. و`TRANSLATION_CONTACT_EMAIL` اختياري (يرفع الحصة اليومية في شروط المزوّد)، وتركه لقرار المالك لأنه بريد شخصي.
3. المقصد معلَن مسبقًا في سجل الصادر (`mymemory-translation`، `api.mymemory.translated.net`).

## العواقب

- **الخصوصية:** نص رسائل المحادثة النصية بين الطرفين يُرسَل إلى خدمة عامة خارجية لترجمته. ولا تُرسَل الإحداثيات ولا الأسماء ولا المعرّفات.
- **الحصة:** الخطة المجانية محدودة يوميًا. عند انتهائها يعيد المزوّد `quotaFinished`، فتُعرض الرسالة الأصلية ويُسجَّل الفشل دون نص (ADR 0274 §3). والمحادثة لا تتوقف.
- **الجودة:** مقبولة في القياس (`scripts/verify-translation.ts`: ar↔en وar↔ur أربع حالات ناجحة)، مع أخطاء في العامية. ولهذا تبقى الترجمة موسومة «مترجمة آليًا» والأصل بنقرة.
- **العودة:** `TRANSLATION_PROVIDER=none` في Render وإعادة نشر البوابة. لا هجرة.
- الانتقال لاحقًا إلى مزوّد بمفتاح لا يغيّر الشيفرة: المتغيران `TRANSLATION_PROVIDER` و`TRANSLATION_API_KEY` فقط.
