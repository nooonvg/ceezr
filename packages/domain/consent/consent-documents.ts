/**
 * الغرض: سجلُّ **الوثائقِ التي يُوافَقُ عليها** — الشروطُ وسياسةُ الخصوصيّةِ —
 *   بصنفِها وإصدارِها الجاريِ ومفتاحِ نصِّها، وهو مصدرُ الحقيقةِ الوحيدُ لهذا
 *   السؤالِ في المستودَعِ (القسم 9.12 · البند `F2-01`).
 * الحالة: منفّذ فعلياً — البند `F2-01` (سجلٌّ نقيٌّ بلا إدخالٍ ولا قاعدةِ بيانات).
 * ينتمي إلى: packages/domain/consent
 * يُتوقع أن يستخدمه لاحقاً: `packages/domain/consent/consent-decision.ts`،
 *   و`packages/application/consent/record-consent.ts`، وشاشةُ الترحيبِ في
 *   `apps/miniapp`، والحاجزُ `scripts/check-consent-documents.ts`.
 * ملاحظات مستقبلية: حينَ تُصبِحُ نسخةُ الوثيقةِ نفسُها مخزَّنةً (لا مفتاحَ نصٍّ
 *   فقط) فموضعُ التغييرِ حقلٌ إضافيٌّ ههنا لا جدولٌ ثانٍ، حتّى لا يصيرَ للإصدارِ
 *   مصدرانِ.
 *
 * ## لماذا الإصدارُ في الشيفرةِ لا في `platform_settings`
 *
 * القاعدةُ 0.3 تُخرِجُ **القِيَمَ التجاريّةَ** من الشيفرةِ: سعرٌ، عمولةٌ، مهلةٌ،
 * حدُّ معدَّلٍ — كلُّ ما يُغيِّرُه مالكُ مدينةٍ بلا إطلاقٍ. وإصدارُ وثيقةٍ قانونيّةٍ
 * ليس من ذاكَ: تغييرُه **يُبطِلُ موافقاتٍ مسجَّلةً** ويوجِبُ إعادةَ سؤالِ كلِّ
 * مستخدمٍ، فهو حدثُ إطلاقٍ يُراجَعُ ويُدقَّقُ لا قيمةٌ تُبدَّلُ في لوحةٍ. ولو كانَ
 * في جدولٍ قابلٍ للتحريرِ لأمكنَ إبطالُ موافقاتِ الناسِ كلِّهم بتحريرِ صفٍّ بلا
 * أثرٍ في المستودَعِ — وذاكَ ما يمنعُه وضعُه ههنا.
 *
 * ## وما لا يفعله هذا الملفُّ عن قصدٍ
 *
 *   ــ لا يحملُ **نصَّ** الوثيقةِ: النصُّ في القواميسِ باللغاتِ الثلاثِ (9.11)،
 *      وههنا مفتاحُه. فوثيقةٌ بلا مفتاحٍ في القواميسِ يردُّها الحاجزُ.
 *   ــ لا يقرِّرُ شيئاً: لا «أوجبَ» ولا «قُبِلَ». القرارُ في `consent-decision`.
 *   ــ لا يعرفُ مستخدماً ولا مدينةً ولا وقتاً.
 */

/** صنفُ الوثيقةِ. الاتّحادُ مُغلَقٌ عن قصدٍ: صنفٌ لا يُذكَرُ ههنا لا يُوافَقُ عليه. */
export type ConsentDocumentKind = "terms_of_service" | "privacy_policy";

export interface ConsentDocument {
  readonly kind: ConsentDocumentKind;
  /**
   * إصدارٌ بتاريخٍ `YYYY-MM-DD`: يُقرأُ بالعينِ، ويُرتَّبُ نصّيّاً، ولا يُوهِمُ
   * بدلالةِ «أصغرُ/أكبرُ» التي يوهِمُ بها رقمٌ متزايدٌ.
   */
  readonly version: string;
  /** مفتاحُ العنوانِ في `packages/shared/i18n` — لا نصَّ ههنا. */
  readonly titleKey: string;
  /** مفتاحُ وصفِ ما يُوافَقُ عليه — لا النصُّ القانونيُّ الكاملُ. */
  readonly summaryKey: string;
  /**
   * مفتاحُ نصِّ الوثيقةِ الكاملِ — قابلٌ للفتحِ قبلَ القبولِ وبعدَهُ بإصدارِهِ.
   * النمطُ: `consent.{kind}.{version}.text` — فكلُّ إصدارٍ مفتاحُه ثابتٌ لا يتغيّرُ
   * بتحديثِ النصِّ الجاري، والقواميسُ تحفظُ نسخةً لكلِّ إصدارٍ (ح-8).
   */
  readonly textKey: string;
  /**
   * `true` تعني: لا يُقرأُ التهيئةُ مكتملةً بغيرِها. وكلتا وثيقتَي `F2-01`
   * واجبتانِ — فالخدمةُ لا تُقدَّمُ بلا شروطٍ ولا بلا سياسةِ خصوصيّةٍ.
   */
  readonly requiredForOnboarding: boolean;
}

export const DECLARED_CONSENT_DOCUMENTS: readonly ConsentDocument[] = Object.freeze([
  Object.freeze({
    kind: "terms_of_service" as const,
    version: "2026-09-12",
    titleKey: "consent.terms_of_service.title",
    summaryKey: "consent.terms_of_service.summary",
    textKey: "consent.terms_of_service.2026-09-12.text",
    requiredForOnboarding: true,
  }),
  Object.freeze({
    kind: "privacy_policy" as const,
    // `2026-10-13` (ADR 0279، اعتمادُ المالك): البندُ 3 يذكرُ معالجَ الترجمةِ الخارجيّ. والإصدارُ
    // السابقُ `2026-09-12` يبقى نصُّه في القواميسِ لمن وافقَ عليه، وموافقتُه تصيرُ `superseded`.
    version: "2026-10-13",
    titleKey: "consent.privacy_policy.title",
    summaryKey: "consent.privacy_policy.summary",
    textKey: "consent.privacy_policy.2026-10-13.text",
    requiredForOnboarding: true,
  }),
]);

/** كلُّ الأصنافِ المُعلَنةِ مرتَّبةً — يقرأُها الحاجزُ ويقابِلُها بقيدِ الهجرةِ. */
export const DECLARED_CONSENT_KINDS: readonly ConsentDocumentKind[] = Object.freeze(
  DECLARED_CONSENT_DOCUMENTS.map((d) => d.kind)
    .slice()
    .sort(),
) as readonly ConsentDocumentKind[];

export function findDeclaredDocument(kind: string): ConsentDocument | undefined {
  return DECLARED_CONSENT_DOCUMENTS.find((d) => d.kind === kind);
}

export function requiredDocuments(): readonly ConsentDocument[] {
  return DECLARED_CONSENT_DOCUMENTS.filter((d) => d.requiredForOnboarding);
}
