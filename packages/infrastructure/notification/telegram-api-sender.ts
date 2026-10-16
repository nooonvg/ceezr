/**
 * الغرض: المُرسِل الحقيقي عبر واجهة تلغرام، ومحوّلاته إلى منافذ الإرسال المختلفة.
 *   نُقِل من حاوية البوابة في المرحلة 2.6 الخطوة 02 لأن العامل الخلفي يحتاج المُرسِل
 *   نفسه لينشر بطاقات القروب ويصعّد الطلبات، ولا يجوز لـ app أن يستورد من app آخر.
 * الحالة: منفّذ فعلياً — نُقِل بلا تغيير في السلوك ولا في التوقيعات.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: عند إضافة منصّة غير تلغرام يُضاف مُرسِل مجاور ينفّذ نفس المنافذ.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import { OutboundCongestionError } from "./rate-aware-telegram-sender.ts";
import { createTelegramApi } from "./telegram-client.ts";
import type { OutboundSender } from "./telegram-driver-notifier.ts";
import { toTelegramMarkup } from "./telegram-markup.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";
import type { SupportSender } from "./telegram-support-notifier.ts";

/**
 * تصنيفُ الرسالةِ (`CAP-002`). **ليسَ وصفاً بل قرارًا عندَ الضيقِ**: حصّةُ البوتِ
 * محدودةٌ، وإذا ازدحمَ الصادرُ وجبَ أن يُعرَفَ ما يُنتَظَرُ له ويُعادُ مرارًا
 * ممّا يُسقَطُ بعدَ محاولتَينِ. **والافتراضُ `informational`** — فمن جعلَ الأصلَ
 * حرجاً صارَ كلُّ شيءٍ حرجاً، ولم يبقَ للتصنيفِ معنًى.
 */
export type SendPriority = "critical" | "informational";

/**
 * خياراتُ نداءٍ واحدٍ. **اختياريٌّ قصداً**: المنفذُ يُنفَّذُ في اختباراتٍ
 * كثيرةٍ بمزدوجاتٍ لا تأخذُ إلاّ ما تحتاجُ، ودالّةٌ بوسائطَ أقلَّ تبقى مُنَفَّذةً
 * للمنفذِ في TypeScript — فلا يُكسَرُ موضعٌ واحدٌ بإضافةِ هذا الحقلِ.
 */
export interface SendOptions {
  readonly priority?: SendPriority;
  /**
   * `D8` — سياسةُ الضغطِ العكسيِّ لهذا النداءِ وحدَهُ: `"abort"` (مسارُ صندوقِ الصادرِ
   * الذي يملكُ عقدَ `requeue`: يُرمى `OutboundCongestionError` فورَ تجاوزِ ميزانيّةٍ
   * قصيرةٍ فيتفرّغُ المسارُ ويعودُ الصفُّ إلى الطابورِ) أو `"wait"` الافتراضيّةُ
   * (النداءُ المباشرُ: الضغطُ فشلٌ عابرٌ يُعادُ عليهِ حتى استنفادِ المحاولاتِ).
   */
  readonly congestion?: "wait" | "abort";
}

/** منفذ الإرسال — grammY ينفّذه في الإنتاج، ومزدوج يلتقط الرسائل في الاختبار. */
export interface TelegramSender {
  /**
   * يعيد معرّف الرسالة المُرسَلة. بطاقة قروب غير المشتركين تُحفَظ بمعرّفها لتُعدَّل
   * أو يُشار إليها لاحقاً، ولا يجوز اختلاق معرّف؛ فمن لا يعرف المعرّف يعيد null.
   */
  sendMessage(
    chatId: string,
    text: string,
    markup: unknown,
    options?: SendOptions,
  ): Promise<string | null>;
  /**
   * إرسال صورة بمعرّف ملف تلغرام والنصّ تعليقاً عليها. نمرّر المعرّف كما وصل
   * ولا نُنزّل الصورة: التنزيل يعني تخزين ملفات مستخدمين بلا حاجة ولا سياسة حذف.
   */
  sendPhoto(
    chatId: string,
    fileId: string,
    caption: string,
    markup: unknown,
    options?: SendOptions,
  ): Promise<string | null>;
  /**
   * المرحلة ١٢ — دبّوس موقعٍ ثابت: نقطة انطلاقٍ أو مقصدٍ يفتحها السائق في
   * تطبيق ملاحته بضغطة. ليست `live_period`: تلك للموقع المتحرّك ولها منفذها
   * (`LiveLocationChannel`) وهي تخصّ خريطة العميل. ونقطةُ الرحلة لا تتحرّك،
   * وبثّها حيّاً كان سيشغل رسالةً قابلةً للتعديل بلا شيء يُعدَّل فيها.
   *
   * ولماذا رسالةٌ منفصلة لا نصّ فيه إحداثيتان؟ لأن نصّ «21.5471, 39.1751» لا
   * يفتح خريطةً ولا يُوجِّه سيّارة — يُنسَخ باليد إلى تطبيق آخر، وأثناء القيادة.
   */
  sendLocation(
    chatId: string,
    latitude: number,
    longitude: number,
    options?: SendOptions,
  ): Promise<string | null>;
  /**
   * `BOT-GRP-01` — يُنهي مؤشّرَ التحميلِ على زرٍّ ضُغِطَ. بلا هذا يبقى الزرُّ «يُحمِّلُ»
   * فيضغطُه المستخدمُ مرّةً بعدَ مرّةٍ (رُئِيَ ثلاثَ ضغطاتٍ على «استلام» الاستغاثةِ).
   * اختياريٌّ: المُرسِلاتُ المزيّفةُ في الاختباراتِ لا تحتاجُه.
   */
  answerCallbackQuery?(callbackQueryId: string): Promise<void>;
  /**
   * `NEG-SELECT-01` — يُبدِّلُ نصَّ رسالةٍ قائمةٍ وأزرارَها في مكانِها: بطاقةُ السائقِ تنقلبُ
   * إلى «معلوماتِ السائقِ» وتعودُ بـ«تجاهل» بلا رسالةٍ جديدةٍ في المحادثةِ. اختياريٌّ
   * كأخيه: من لا يُعدِّلُ يُرسِلُ رسالةً جديدةً بدلَه (المحوِّلُ يتكفّلُ بذلك).
   */
  editMessageText?(chatId: string, messageId: string, text: string, markup: unknown): Promise<void>;
}

/**
 * `NEG-SELECT-01` — الأغلفةُ (القياسُ، الصمودُ، زرُّ التطبيقِ، الأولويّةُ) كانت تُعيدُ
 * كائناً بثلاثِ دوالِّ إرسالٍ وحدَها، **فتُسقِطُ `answerCallbackQuery`** في الإنتاجِ: مؤشّرُ
 * التحميلِ الذي أُصلِحَ في `BOT-GRP-01` لم يكن يتوقّفُ أبداً خلفَ أيِّ غلافٍ. هذه الدالّةُ
 * تحملُ الدالّتَينِ التفاعليّتَينِ من الداخلِ إلى الغلافِ كما هما — أو تُسقِطُهما إن غابتا.
 */
export function interactiveOf(
  inner: TelegramSender,
  wrapMarkup: (chatId: string, markup: unknown) => unknown = (_chatId, markup) => markup,
): Pick<TelegramSender, "answerCallbackQuery" | "editMessageText"> {
  return {
    ...(inner.answerCallbackQuery === undefined
      ? {}
      : {
          answerCallbackQuery: (callbackQueryId: string) =>
            (inner.answerCallbackQuery as (id: string) => Promise<void>)(callbackQueryId),
        }),
    ...(inner.editMessageText === undefined
      ? {}
      : {
          editMessageText: (chatId: string, messageId: string, text: string, markup: unknown) =>
            (
              inner.editMessageText as (
                c: string,
                m: string,
                t: string,
                k: unknown,
              ) => Promise<void>
            )(chatId, messageId, text, wrapMarkup(chatId, markup)),
        }),
  };
}

export function grammyTelegramSender(token: string): TelegramSender {
  const api = createTelegramApi(token);
  return {
    sendMessage: async (chatId, text, markup) => {
      const sent = await api.sendMessage(
        chatId,
        text,
        markup === undefined ? {} : { reply_markup: markup as never },
      );
      return String(sent.message_id);
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      const sent = await api.sendPhoto(chatId, fileId, {
        caption,
        ...(markup === undefined ? {} : { reply_markup: markup as never }),
      });
      return String(sent.message_id);
    },
    sendLocation: async (chatId, latitude, longitude) => {
      const sent = await api.sendLocation(chatId, latitude, longitude);
      return String(sent.message_id);
    },
    answerCallbackQuery: async (callbackQueryId) => {
      await api.answerCallbackQuery(callbackQueryId);
    },
    editMessageText: async (chatId, messageId, text, markup) => {
      await api.editMessageText(
        chatId,
        Number(messageId),
        text,
        markup === undefined ? {} : { reply_markup: markup as never },
      );
    },
  };
}

export function asOutboundSender(sender: TelegramSender): OutboundSender {
  return {
    send: async (chatId, text, keyboard: Keyboard | null) => {
      try {
        await sender.sendMessage(chatId, text, toTelegramMarkup(keyboard));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** مُرسِل يُبقي معرّف الرسالة — تحتاجه بطاقات القروبات لا الرسائل الفردية. */
export function asIdentifyingSender(sender: TelegramSender): IdentifyingSender {
  return {
    sendReturningId: async (chatId, text, keyboard: Keyboard | null) => {
      try {
        return await sender.sendMessage(chatId, text, toTelegramMarkup(keyboard));
      } catch (thrown) {
        // `D8` — ازدحامُ الدلاءِ ليسَ رفضًا: إشارةُ إعادةٍ إلى الطابورِ يجبُ أن تصلَ
        // إلى معالجِ التسليمِ خطأً كي يُعيدَ الصفَّ، لا أن تُعلَمَ رفضًا فيُقتَلَ
        // باستنفادِ المحاولاتِ.
        if (thrown instanceof OutboundCongestionError) throw thrown;
        return null;
      }
    },
  };
}

/**
 * مُرسِل بطاقات الدعم: نصّاً أو صورةً. الصورة تُعاد بمعرّفها لأن إيصال التحويل
 * يجب أن يظهر صورةً أمام الفريق لا رابطاً لا يفتحه أحد.
 */
export function asSupportSender(sender: TelegramSender): SupportSender {
  return {
    sendReturningId: async (chatId, text, keyboard) => {
      try {
        return await sender.sendMessage(chatId, text, keyboard);
      } catch (thrown) {
        // `D8` — ازدحامُ الدلاءِ ليسَ رفضًا: إشارةُ إعادةٍ إلى الطابورِ يجبُ أن تصلَ
        // إلى معالجِ التسليمِ خطأً كي يُعيدَ الصفَّ، لا أن تُعلَمَ رفضًا فيُقتَلَ
        // باستنفادِ المحاولاتِ.
        if (thrown instanceof OutboundCongestionError) throw thrown;
        return null;
      }
    },
    sendPhotoReturningId: async (chatId, fileId, caption, keyboard) => {
      try {
        return await sender.sendPhoto(chatId, fileId, caption, keyboard);
      } catch (thrown) {
        // `D8` — ازدحامُ الدلاءِ ليسَ رفضًا: إشارةُ إعادةٍ إلى الطابورِ يجبُ أن تصلَ
        // إلى معالجِ التسليمِ خطأً كي يُعيدَ الصفَّ، لا أن تُعلَمَ رفضًا فيُقتَلَ
        // باستنفادِ المحاولاتِ.
        if (thrown instanceof OutboundCongestionError) throw thrown;
        return null;
      }
    },
  };
}
