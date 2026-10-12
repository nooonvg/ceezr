/**
 * الغرض: السطحُ الجذريُّ للمشرف داخلَ التطبيقِ المصغَّر — بقرارِ مالكِ المنتجِ في
 *   البند `F1-05` («شاشةُ مشرفٍ داخلَ Mini App»).
 * الحالة: منفّذ فعلياً — البند `F1-05` (سطحٌ جذريٌّ لا أدواتُ إدارة).
 * ينتمي إلى: apps/miniapp/src/surfaces/admin
 * يُتوقع أن يستخدمه لاحقاً: أدواتُ الإشرافِ إن أُقرّت في قرارٍ معماريٍّ لاحق.
 * ملاحظات مستقبلية: **نقطةٌ مفتوحةٌ معلنة** — `ADR 0007` يجعل لوحةَ الإدارةِ
 *   صفحاتَ HTML من الخادم. وقرارُ المالكِ في `F1-05` أضاف سطحَ مشرفٍ في التطبيقِ
 *   المصغَّرِ، فالسطحان قائمان معاً اليومَ. ولا يُنشأ ولا يُعدَّل `ADR` في بندِ
 *   تنفيذٍ، فالتوفيقُ بينهما قرارٌ معماريٌّ لاحقٌ مسجَّلٌ في دليلِ البند.
 *   ولذلك **لا أداةَ إشرافٍ ههنا**: لوحةُ الإدارةِ الفعليةُ تبقى على الخادم.
 */

import {
  directionFor,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import type { LanguageSurfaceProps } from "../../routing/RoleRouter.tsx";
import { EmptyState } from "../../system/EmptyState.tsx";

/**
 * كانَ النصُّ عربيًّا مكتوبًا في المكوّنِ (ومعه «ADR 0007» و«إثبات توجيه») فيراهُ المشرفُ
 * الإنجليزيُّ والأرديُّ بالعربيّةِ ومصطلحاتِ المطوّرين. صارَ بلغةِ السطحِ واتّجاهِها.
 */
export default function AdminRoot({ language }: LanguageSurfaceProps) {
  const t = miniAppTranslator(language);
  return (
    <section aria-labelledby="admin-root-title" dir={directionFor(language)}>
      <h1 id="admin-root-title" style={{ margin: 0, fontSize: "1.5rem" }}>
        {t("admin.root.brand")}
      </h1>
      {/* `F1-07` — `UX-5`: حالةُ الفراغِ تُقال صراحةً ولا تُترَك بياضاً يُقرأ عطلاً. */}
      <EmptyState title={t("admin.root.title")} body={t("admin.root.body")} />
    </section>
  );
}
