/**
 * S5 (ADR 0288) — إرسالُ ردودِ الحوارِ مفصولًا عن حسابِها.
 *
 * كانَ كلٌّ من بوتَي السائقِ والراكبِ يحسبُ الردودَ (والأثرُ التجاريُّ قد ثبتَ) ثم
 * يرسلُها في الحلقةِ نفسِها ويعيدُ `false` عندَ أوّلِ رفضٍ — فيُعادُ التحديثُ كلُّه.
 * هنا الإرسالُ وحدَه: يبدأُ من مؤشرٍ (`from`) ويتوقّفُ عندَ أوّلِ رفضٍ معيدًا عددَ
 * المقبولِ وسببَ الرفضِ ومهلتَه — فيُكملُ المُرسِلُ الخلفيُّ من حيثُ توقّفَ، ولا
 * يُعادُ ردٌّ قبلَه تيليجرامُ. والمسارُ القديمُ (`handleUpdate`) يستعملُه كما هو.
 */
import type { BotReply } from "../../../../../packages/application/bots/types.ts";
import { OutboundCongestionError } from "../../../../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";
import { toTelegramMarkup } from "./keyboards.ts";

export interface PreparedUpdate {
  readonly handled: boolean;
  readonly replies: readonly BotReply[];
}

export interface ReplyDeliveryResult {
  /** عددُ الردودِ المقبولةِ منَ البدايةِ (لا مِن `from`) — مؤشرٌ لا يتراجعُ. */
  readonly sent: number;
  readonly error: { readonly message: string; readonly retryAfterSec: number | null } | null;
}

function retryAfterOf(error: unknown): number | null {
  if (error instanceof OutboundCongestionError)
    return Math.max(1, Math.ceil(error.retryAfterMs / 1000));
  const parameters = (error as { parameters?: { retry_after?: unknown } } | null)?.parameters;
  const value = parameters?.retry_after;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export async function deliverReplies(
  sender: TelegramSender,
  replies: readonly BotReply[],
  from: number,
  log: (message: string, meta: Record<string, unknown>) => void,
  /** هل يرسلُ هذا البوتُ دبابيسَ الموقعِ؟ (السائقُ نعم، الراكبُ لا — كما كانَ). */
  mapPins: boolean,
): Promise<ReplyDeliveryResult> {
  for (let index = Math.max(0, from); index < replies.length; index++) {
    const reply = replies[index] as BotReply;
    const markup = toTelegramMarkup(reply.keyboard);
    try {
      const edited =
        reply.editMessageId !== undefined &&
        reply.photoFileId === undefined &&
        sender.editMessageText !== undefined &&
        (await sender
          .editMessageText(reply.chatId, reply.editMessageId, reply.text, markup)
          .then(() => true)
          .catch((error: unknown) => {
            // رسالةٌ لا تُعدَّلُ (قديمةٌ أو مطابقةٌ) ليست إخفاقاً: تُرسَلُ جديدةً.
            log("bot.telegram_edit_failed", { detail: String(error) });
            return false;
          }));
      if (!edited) {
        if (reply.photoFileId === undefined) {
          await sender.sendMessage(reply.chatId, reply.text, markup);
        } else {
          await sender.sendPhoto(reply.chatId, reply.photoFileId, reply.text, markup);
        }
      }
    } catch (error) {
      log("bot.telegram_send_failed", { detail: String(error), index });
      return {
        sent: index,
        error: { message: String(error).slice(0, 300), retryAfterSec: retryAfterOf(error) },
      };
    }
    // الدبّوسُ بعدَ النصِّ، وفشلُه لا يُبطلُ رسالةً وصلتْ (ولا يُعيدُها).
    if (reply.mapPin !== undefined && mapPins) {
      await sender
        .sendLocation(reply.chatId, reply.mapPin.latitude, reply.mapPin.longitude)
        .catch((error: unknown) =>
          log("bot.driver.location_pin_send_failed", { detail: String(error) }),
        );
    }
  }
  return { sent: replies.length, error: null };
}
