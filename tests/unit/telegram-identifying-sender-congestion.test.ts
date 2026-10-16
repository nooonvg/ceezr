/**
 * انحدارُ مسارِ ازدحامِ الصادرِ (`D8`): خطأُ الازدحامِ يجبُ أن يعبرَ المُرسِلَ
 * المُعرِّفَ والمُرسِلَ الداعمَ كما هو — لا أن يُبتلَعَ فيُعادَ `null` فتُقتَلَ
 * الرسالةُ برفضٍ مزعومٍ. هذا عينُ ما كشفتهُ الجولةُ `J3` على مقعدِ القياسِ:
 * 387 صفوفٍ ماتت `MAX_ATTEMPTS TELEGRAM_REJECTED` والسببُ ازدحامُ دلاءٍ لا رفضٌ.
 */

import { describe, expect, it } from "bun:test";
import { OutboundCongestionError } from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  asIdentifyingSender,
  asSupportSender,
} from "../../packages/infrastructure/notification/telegram-api-sender.ts";

function stubSender(throwing: () => void): TelegramSender {
  return {
    sendMessage: async () => {
      throwing();
      return "42";
    },
    sendPhoto: async () => {
      throwing();
      return "ph";
    },
    sendLocation: async () => "loc",
  };
}

describe("انحدارُ عبورِ ازدحامِ الصادرِ عبرَ المُرسِلاتِ (D8 · J3)", () => {
  it("المُرسِلُ المُعرِّفُ يُمرِّرُ ازدحامَ الدلوِ خطأً لا رفضًا", async () => {
    const sender = asIdentifyingSender(
      stubSender(() => {
        throw new OutboundCongestionError(400);
      }),
    );
    await expect(sender.sendReturningId("111", "نصٌّ", null)).rejects.toBeInstanceOf(
      OutboundCongestionError,
    );
  });

  it("المُرسِلُ الداعمُ يُمرِّرُ ازدحامَ الدلوِ في النصِّ وفي الصورةِ", async () => {
    const sender = asSupportSender(
      stubSender(() => {
        throw new OutboundCongestionError(400);
      }),
    );
    await expect(sender.sendReturningId("111", "نصٌّ", null)).rejects.toBeInstanceOf(
      OutboundCongestionError,
    );
    await expect(sender.sendPhotoReturningId("111", "file", "تعليق", null)).rejects.toBeInstanceOf(
      OutboundCongestionError,
    );
  });

  it("سائرُ الأخطاءِ تبقى عائدًا `null` كما كانَ العقدُ", async () => {
    const sender = asIdentifyingSender(
      stubSender(() => {
        throw new Error("TELEGRAM_REJECTED");
      }),
    );
    expect(await sender.sendReturningId("111", "نصٌّ", null)).toBeNull();
  });
});
