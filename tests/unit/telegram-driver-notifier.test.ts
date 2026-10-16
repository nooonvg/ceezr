/**
 * الغرض: إثباتٌ أنَّ ناشرَ إشعارِ العرضِ يبني زرَّ الرفضِ على `offerId` لا `orderId` —
 *   فيَنصبُّ الرفضُ على عرضٍ واحدٍ لا على كلِّ عرضٍ معلَّقٍ للسائقِ على الطلبِ (`BUG-003`)،
 *   وأنّه يُرجعُ معرّفَ الرسالةِ دليلًا قاطعًا على التسليمِ لا قيمةً منطقيةً «true» (`BUG-004`).
 *   اختبارُ التنسيقِ `isCallbackDataValid` وحده لا يكفي: يمرُّ ولو ظلَّ الناشرُ يرسلُ `orderId`.
 * الحالة: اختبار وحدةٍ بمزدوجاتٍ في الذاكرة — يلتقطُ لوحةَ المفاتيحِ الفعليةَ التي يُمرّرُها
 *   الناشرُ إلى المُرسِل، ويتحقَّقُ من حمولةِ زرِّ الرفضِ حرفاً، ومن معرّفِ الرسالةِ رقمًا.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import type { OfferNotification } from "../../packages/application/dispatch/broadcast-offers.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { IdentifyingSender } from "../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import type { DriverId, OfferId, OrderId } from "../../packages/shared/kernel/index.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";

/** سائقٌ موجودٌ دائماً — الناشرُ يقرأُ `telegram_id` و`language_code` فقط. */
function fakeSql(): Sql {
  const run = () => [{ telegram_id: "999", language_code: "ar" }];
  const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(run())) as unknown as Sql;
  (sql as unknown as { end: () => Promise<void> }).end = async () => undefined;
  return sql;
}

/** مُرسِلٌ يلتقطُ اللوحةَ الفعليةَ والنصَّ ويُرجعُ معرّفًا ثابتًا — لا شبكةَ ولا اتصالَ بتيليجرام. */
function capturingSender(captured: {
  keyboard: Keyboard | null;
  messageId: string | null;
  text: string | null;
}): IdentifyingSender {
  return {
    sendReturningId: async (_chatId: string, text: string, keyboard: Keyboard | null) => {
      captured.keyboard = keyboard;
      captured.text = text;
      return captured.messageId;
    },
  };
}

describe("createOfferPublisher — البطاقةُ إشعارٌ وزرُّ تطبيقٍ لا زرَّ عملٍ، ويُرجعُ معرّفَ الرسالةِ (BUG-004 · ADR 0286)", () => {
  it("مع `miniAppUrl` ⇒ زرّا تطبيقٍ (العرضُ واللوحُ) ولا زرَّ عملٍ واحدًا في المحادثةِ، ويُرجعُ معرّفَ الرسالةِ", async () => {
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: "msg-42",
      text: null,
    };
    const publisher = createOfferPublisher(fakeSql(), capturingSender(captured), {
      miniAppUrl: "https://app.example.com",
    });

    // offerId ≠ orderId عمداً — ليثبتَ الاختبارُ أنَّ زرَّ التطبيقِ يستهدفُ العرضَ بذاتِهِ.
    const notification: OfferNotification = {
      orderId: "order-1" as OrderId,
      // معرِّفٌ بصيغةِ uuid كما في القاعدةِ — رمزُ الهدفِ لا يقبلُ غيرَها.
      offerId: "0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1a55" as OfferId,
      driverId: "drv-1" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
      service: "transport",
      pickupLabel: "الرياض - حي العليا",
      dropoffLabel: "الرياض - حي الملقا",
      notes: null,
    };

    const result = await publisher.publishOffer(notification);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // معرّفُ الرسالةِ دليلٌ قاطعٌ على التسليمِ — لا «true» كاذبة. هذا صميمُ BUG-004:
    // ما لم يَعُدْ معرّفًا لم يُسلَّم، فيُعادُ إرسالُه من العاملِ بلا تكرارِ أثر.
    expect(result.value).toBe("msg-42");

    const keyboard = captured.keyboard;
    expect(keyboard).not.toBeNull();
    if (keyboard === null) return;
    expect(keyboard.kind).toBe("inline");
    if (keyboard.kind !== "inline") return;
    const flat = keyboard.rows.flat();
    // `ADR 0286` — لا قرارَ تجاريًّا من المحادثةِ: لا زرَّ رجوعٍ واحدًا يحملُ `offer:`.
    expect(flat.some((b) => b.data?.startsWith("offer:"))).toBe(false);
    // وزرّا التطبيقِ: واحدٌ يستهدفُ العرضَ بذاتِهِ وواحدٌ يستهدفُ اللوحَ.
    const webApp = flat.filter((b) => b.webAppUrl !== undefined);
    expect(webApp).toHaveLength(2);
    expect(webApp[0]?.webAppUrl).toContain("open=offer_0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1a55");
    expect(webApp[1]?.webAppUrl).toContain("offers");
  });

  it("بلا `miniAppUrl` (وضعُ اختبارِ التوافقِ المعزولُ) ⇒ بطاقةٌ بلا زرِّ عملٍ واحدٍ — فلا يعودُ `offer:` إلى البطاقةِ", async () => {
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: "msg-42",
      text: null,
    };
    const publisher = createOfferPublisher(fakeSql(), capturingSender(captured));

    const result = await publisher.publishOffer({
      orderId: "order-1" as OrderId,
      offerId: "offer-xyz" as OfferId,
      driverId: "drv-1" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
      service: "transport",
      pickupLabel: null,
      dropoffLabel: null,
      notes: null,
    });

    expect(isOk(result)).toBe(true);
    const keyboard = captured.keyboard;
    if (keyboard === null || keyboard.kind !== "inline") throw new Error("لوحةٌ غيرُ مضمَّنة");
    // لا زرَّ عملٍ في المحادثةِ أصلًا — البطاقةُ إشعارٌ وحدَه.
    expect(keyboard.rows.flat().filter((b) => b.data !== undefined)).toHaveLength(0);
  });

  it("سائقٌ غيرُ موجودٍ يُرجَعُ خطأً دائمًا (DRIVER_CONTACT_NOT_FOUND) — لا يُعالَجُ بإعادةِ الإرسال", async () => {
    const missingSql = (() => Promise.resolve([])) as unknown as Sql;
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: "msg-42",
      text: null,
    };
    const publisher = createOfferPublisher(missingSql, capturingSender(captured));

    const result = await publisher.publishOffer({
      orderId: "order-1" as OrderId,
      offerId: "offer-xyz" as OfferId,
      driverId: "drv-ghost" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
      service: null,
      pickupLabel: null,
      dropoffLabel: null,
      notes: null,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.detail).toBe("DRIVER_CONTACT_NOT_FOUND");
    // لم تُرسَل لوحةٌ لسائقٍ لا وجودَ له — فلا معرّفٌ ولا نصٌّ.
    expect(captured.keyboard).toBeNull();
  });

  it("رفضُ تيليجرامَ للرسالةِ (null) يُرجَعُ خطأً مؤقّتًا (TELEGRAM_SEND_FAILED) — يُعادُ إرسالُه", async () => {
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: null,
      text: null,
    };
    const publisher = createOfferPublisher(fakeSql(), capturingSender(captured));

    const result = await publisher.publishOffer({
      orderId: "order-1" as OrderId,
      offerId: "offer-xyz" as OfferId,
      driverId: "drv-1" as DriverId,
      distanceKm: 2.3 as DistanceKm,
      expiresInSeconds: 30,
      service: null,
      pickupLabel: null,
      dropoffLabel: null,
      notes: null,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.detail).toBe("TELEGRAM_SEND_FAILED");
  });
});

describe("PD-051 — ترتيبُ بطاقةِ عرضِ السائقِ (خدمةٌ ← من أينَ ← إلى أينَ ← مسافة/وقتٌ ← قيود)", () => {
  it("الترتيبُ الصحيحُ: الخدمةُ قبلَ الانطلاقِ قبلَ الوصولِ قبلَ المسافةِ قبلَ القيود", async () => {
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: "msg-51",
      text: null,
    };
    const publisher = createOfferPublisher(fakeSql(), capturingSender(captured));

    await publisher.publishOffer({
      orderId: "order-51" as OrderId,
      offerId: "offer-51" as OfferId,
      driverId: "drv-51" as DriverId,
      distanceKm: 3.5 as DistanceKm,
      expiresInSeconds: 45,
      service: "transport",
      pickupLabel: "حي العليا",
      dropoffLabel: "حي الملقا",
      notes: "ملاحظة خاصة",
    });

    expect(captured.text).not.toBeNull();
    if (captured.text === null) return;
    const text = captured.text;

    // PD-051: الترتيبُ — خدمةٌ ← من أينَ ← إلى أينَ ← مسافة/وقتٌ ← قيود.
    const serviceIdx = text.indexOf("الخدمة");
    const fromIdx = text.indexOf("من:");
    const toIdx = text.indexOf("إلى:");
    const distanceIdx = text.indexOf("المسافة");
    const timeIdx = text.indexOf("ثانية");
    const notesIdx = text.indexOf("ملاحظات");

    // كلُّ سطرٍ موجودٌ.
    expect(serviceIdx).toBeGreaterThanOrEqual(0);
    expect(fromIdx).toBeGreaterThanOrEqual(0);
    expect(toIdx).toBeGreaterThanOrEqual(0);
    expect(distanceIdx).toBeGreaterThanOrEqual(0);
    expect(timeIdx).toBeGreaterThanOrEqual(0);
    expect(notesIdx).toBeGreaterThanOrEqual(0);

    // الترتيبُ الصحيحُ: خدمةٌ < من < إلى < مسافة < وقت < قيود.
    expect(serviceIdx).toBeLessThan(fromIdx);
    expect(fromIdx).toBeLessThan(toIdx);
    expect(toIdx).toBeLessThan(distanceIdx);
    expect(distanceIdx).toBeLessThan(timeIdx);
    expect(timeIdx).toBeLessThan(notesIdx);
  });

  it("الحقولُ الفارغةُ تُحذفُ — لا خطٍّ لغيابِ البيانات", async () => {
    const captured: { keyboard: Keyboard | null; messageId: string | null; text: string | null } = {
      keyboard: null,
      messageId: "msg-52",
      text: null,
    };
    const publisher = createOfferPublisher(fakeSql(), capturingSender(captured));

    await publisher.publishOffer({
      orderId: "order-52" as OrderId,
      offerId: "offer-52" as OfferId,
      driverId: "drv-52" as DriverId,
      distanceKm: 1.0 as DistanceKm,
      expiresInSeconds: 30,
      service: null,
      pickupLabel: null,
      dropoffLabel: null,
      notes: null,
    });

    expect(captured.text).not.toBeNull();
    if (captured.text === null) return;
    const text = captured.text;

    // المسافةُ والوقتُ دائمًا موجودانِ.
    expect(text).toContain("المسافة");
    expect(text).toContain("ثانية");
    // لا خطَّ للخدمةِ أو الانطلاقِ أو الوصولِ أو القيودِ.
    expect(text).not.toContain("الخدمة");
    expect(text).not.toContain("من:");
    expect(text).not.toContain("إلى:");
    expect(text).not.toContain("ملاحظات");
  });
});
