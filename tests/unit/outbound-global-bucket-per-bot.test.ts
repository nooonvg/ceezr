/**
 * الغرض: CAP-RUN-20261015 / عيب D6 — الدلوُ العالميُّ للصادرِ كانَ بمفتاحٍ ثابتٍ ("global:bot") يتشاركُه بوتُ السائقِ
 *   وبوتُ الزبونِ، فسقفُ المنصّةِ كلِّها 25 رسالة/ث بينما حدُّ Bot API لكلِّ رمزِ بوتٍ على حِدَة. مقيس في الجولة
 *   المحليّة (التزامن 150): السائق 12.6 + الزبون 6.3 رسالة/ث ≈ سقفُ الدلوِ المشتركِ ناقصَ الحجز، و164 ألفَ حدثِ
 *   backpressure بتفصيل "global"، وطابورُ وارد الزبون 1836 وظيفة.
 *   الإصلاح: `bucketKey` لكلِّ بوت (بصمةُ الرمزِ لا الرمزُ نفسُه) — رمزان ⇒ دلوان؛ الرمزُ نفسُه مرّتين ⇒ دلوٌ واحد.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { createMemoryOutboundRateBucket } from "../../packages/infrastructure/notification/outbound-rate-bucket.ts";
import {
  createMemoryDeadLetterSink,
  outboundBucketKeyOfToken,
  withOutboundResilience,
} from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";

const fake = (sent: string[], tag: string): TelegramSender =>
  ({
    sendMessage: async (chatId: string) => {
      sent.push(`${tag}:${chatId}`);
      return "1";
    },
  }) as unknown as TelegramSender;

/** نافذةٌ واحدةٌ مجمّدةُ الزمن: 40 رسالة لكلّ بوت إلى 40 محادثةً مختلفة؛ ما لا يجدُ فتحةً يُتخلّى عنه فورًا. */
async function burst(keys: [string | undefined, string | undefined]) {
  const bucket = createMemoryOutboundRateBucket(undefined, () => 1_000_000);
  const sent: string[] = [];
  const mk = (tag: string, key: string | undefined) =>
    withOutboundResilience(fake(sent, tag), {
      bucket,
      deadLetter: createMemoryDeadLetterSink(),
      maxBucketWaitMs: 0,
      informationalMaxAttempts: 1,
      criticalMaxAttempts: 1,
      sleep: async () => {},
      ...(key === undefined ? {} : { bucketKey: key }),
    });
  const d = mk("driver", keys[0]);
  const r = mk("rider", keys[1]);
  await Promise.allSettled(
    Array.from({ length: 40 }, (_, i) => [
      d.sendMessage(`d${i}`, "x", null),
      r.sendMessage(`r${i}`, "x", null),
    ]).flat(),
  );
  return {
    driver: sent.filter((s) => s.startsWith("driver")).length,
    rider: sent.filter((s) => s.startsWith("rider")).length,
  };
}

describe("D6: دلوٌ عالميٌّ لكلِّ بوت", () => {
  // غيرُ الحرجِ يأخذُ 20 من 25 (حجزُ F6-07 مقصود) — فالسقفُ لكلِّ نافذةٍ 20 للمعلوماتي
  const CAP = 20;
  test("إعادةُ إنتاج: بلا مفتاحٍ يتشاركُ البوتان دلوًا واحدًا (سقفٌ واحدٌ للاثنين معًا)", async () => {
    const r = await burst([undefined, undefined]);
    expect(r.driver + r.rider).toBe(CAP);
  });
  test("بمفتاحٍ لكلِّ رمز: السقفُ لكلِّ بوتٍ على حِدَة", async () => {
    const r = await burst([
      outboundBucketKeyOfToken("111:AAA"),
      outboundBucketKeyOfToken("222:BBB"),
    ]);
    expect(r).toEqual({ driver: CAP, rider: CAP });
  });
  test("الرمزُ نفسُه مرّتين ⇒ دلوٌ واحد (لا مضاعفةَ للحدّ)", async () => {
    const r = await burst([
      outboundBucketKeyOfToken("111:AAA"),
      outboundBucketKeyOfToken("111:AAA"),
    ]);
    expect(r.driver + r.rider).toBe(CAP);
  });
  test("المفتاحُ لا يحوي الرمز", () => {
    const k = outboundBucketKeyOfToken("123456:SECRET-TOKEN");
    expect(k).not.toContain("SECRET");
    expect(k).not.toContain("123456");
    expect(k).toMatch(/^bot-[0-9a-f]{16}$/);
  });
});
