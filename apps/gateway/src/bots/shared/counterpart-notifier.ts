/**
 * الغرض: تبليغ طرف الرحلة المقابل عبر بوته هو — الجسر الوحيد بين البوتين.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: container.ts، وأي مسار يخاطب طرفاً على البوت الآخر
 * ملاحظات مستقبلية: عند إضافة بوت ثالث يبقى الجسر واحداً بمُرسِل مختلف لا بمنطق مختلف.
 */

import type { CounterpartNotifier } from "../../../../../packages/application/bots/rating-dialog.ts";
import type { Keyboard } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import { toTelegramMarkup } from "./keyboards.ts";

/**
 * الفشل لا يُرفَعُ إلى المُستدعي عمداً: الرحلة اكتملت في القاعدة قبل هذه المكالمة، وحظرُ
 * العميل للبوت أو انقطاع الشبكة لا يجوز أن يُظهر للسائق أن الإنهاء فشل وهو قد نجح.
 *
 * **لكنَّه لا يُبتلَعُ صامتاً بعدَ اليوم (`WR-15` · §15):** إعادةُ المحاولةِ في غلافِ الصمودِ
 * تحتَ المُرسِل (`withOutboundResilience`)، فما وصلَ ههنا فشلٌ نهائيٌّ يُسجَّلُ حدثاً
 * `counterpart.notify_failed` بالبوتِ ونوعِ الخطأِ وحدَهما — لا معرّفَ تيليجرام ولا نصَّ رسالة.
 * والنجاحُ يُسجَّلُ `counterpart.notify_sent`: قبولُ Telegram API لا قراءةُ المستخدم.
 */
export function counterpartNotifier(
  sender: TelegramSender,
  log: (event: string, meta: Record<string, unknown>) => void = () => {},
  bot: "rider" | "driver" = "rider",
): CounterpartNotifier {
  return {
    notify: async (telegramId: string, text: string, keyboard: Keyboard | null) => {
      try {
        await sender.sendMessage(telegramId, text, toTelegramMarkup(keyboard));
        // §15: «قبِلَه Telegram API» حدثٌ مستقلٌّ عن «أنشأنا الإشعار» — ولا يُدَّعى أنَّه قُرِئ.
        log("counterpart.notify_sent", { bot });
      } catch (thrown) {
        log("counterpart.notify_failed", { bot, error: notifyErrorKind(thrown) });
      }
    },
  };
}

/** نوعُ الخطأِ لا نصُّه: رمزُ تيليجرام إن حضرَ (403 حظرٌ · 429 حدٌّ · 5xx)، وإلّا اسمُ الخطأ. */
export function notifyErrorKind(thrown: unknown): string {
  if (typeof thrown === "object" && thrown !== null) {
    const record = thrown as Record<string, unknown>;
    if (typeof record.error_code === "number") return `telegram_${record.error_code}`;
    if (typeof record.name === "string" && record.name.length > 0) return record.name;
  }
  return "unknown";
}
