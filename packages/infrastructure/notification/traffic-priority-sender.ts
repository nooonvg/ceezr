/**
 * الغرض: **وسمُ** الصادرِ بأولويّةِ نوعِ الإشعارِ (القسمُ ١٥ / `F6-07`) عندَ نقطةِ
 *   بناءِ المُعالِجِ، لا عندَ كلِّ نداءِ إرسالٍ. فالمُعالِجاتُ في
 *   `apps/workers/src/container.ts` مُسجَّلةٌ **بالنوعِ** أصلاً
 *   (`notificationHandlers[kind]`)، والنوعُ هوَ بعينِه مصدرُ الرتبةِ في
 *   `packages/shared/config/traffic-priority.ts` — فوسمُ المُرسِلِ مرّةً واحدةً
 *   عندَ التسجيلِ يُغني عن تمريرِ الأولويّةِ في كلِّ استدعاءٍ داخلَ كلِّ مُعالِجٍ،
 *   وهوَ الفرقُ بينَ مصدرِ حقيقةٍ واحدٍ وبينَ أحدَ عشرَ موضعَ تخمينٍ.
 * الحالة: منفّذٌ فعلياً — `F6-07`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts
 * ما لا يفعله: لا يُعيدُ محاولةً، ولا يقرأُ حدّاً، ولا يعرفُ Redis. الإنفاذُ في
 *   `rate-aware-telegram-sender.ts` و`outbound-rate-bucket.ts`؛ وههنا **إعلانٌ**
 *   فقط. ولا يُبطِلُ وسماً سابقاً: نداءٌ مرَّرَ أولويّتَه صريحةً تبقى له.
 */

import type { NotificationKind } from "../../shared/config/notification-kinds.ts";
import { priorityClassOfKind, sendPriorityOfClass } from "../../shared/config/traffic-priority.ts";
import { interactiveOf, type SendOptions, type TelegramSender } from "./telegram-api-sender.ts";

/**
 * يلفُّ مُرسِلاً فيَسِمُ كلَّ نداءٍ منه بأولويّةِ `kind` المُشتقّةِ من السجلِّ.
 *
 * **الوسمُ لا يُدهِسُ**: `options.priority` الصريحةُ أقوى، فموضعٌ يعرفُ عن نداءِه
 * أكثرَ ممّا يعرفُ السجلُّ عن نوعِه (رسالةُ سلامةٍ داخلَ مسارٍ عاديٍّ مثلاً) يبقى
 * قادراً على قولِه. والاستدعاءُ من خارجِ الطابورِ بلا وسمٍ يبقى كما كانَ.
 */
export function withTrafficPriority(inner: TelegramSender, kind: NotificationKind): TelegramSender {
  const priority = sendPriorityOfClass(priorityClassOfKind(kind));
  const stamp = (options: SendOptions | undefined): SendOptions => ({
    ...options,
    priority: options?.priority ?? priority,
    // `D8` — وسمُ مسارِ صندوقِ الصادرِ: هذا الغلافُ لا يستخدمُهُ إلا معالجاتُ
    // الإشعاراتِ في العاملِ (المستهلِكُ الذي يملكُ عقدَ `requeue`)، فكلُّ نداءٍ
    // منهُ يحيلُ الضغطَ العكسيَّ إلى الطابورِ لا أن ينتظِرَ أو يقتُلَ الصفَّ.
    congestion: options?.congestion ?? "abort",
  });
  return {
    sendMessage: (chatId, text, markup, options) =>
      inner.sendMessage(chatId, text, markup, stamp(options)),
    sendPhoto: (chatId, fileId, caption, markup, options) =>
      inner.sendPhoto(chatId, fileId, caption, markup, stamp(options)),
    sendLocation: (chatId, latitude, longitude, options) =>
      inner.sendLocation(chatId, latitude, longitude, stamp(options)),
    ...interactiveOf(inner),
  };
}
