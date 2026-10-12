/**
 * الغرض: قياسُ محوّلِ مخزنِ طلبِ الرحلةِ (`F2-05` · القاعدة 0.5): أنَّ الحكمَ
 *   يُقرأُ من جوابِ الدالّةِ **كما هوَ** ولا يُخترَعُ، وأنَّ الرمزَ المجهولَ
 *   يُعلَنُ عطباً ولا يُقرأُ نجاحاً، وأنَّ ختماً ناقصاً أو عدّاً ناقصاً عطبُ
 *   عقدٍ لا قيمةٌ افتراضيّةٌ (فـ`Date.now()` بديلاً مؤقِّتٌ يبدأُ من صفرٍ في كلِّ
 *   قراءةٍ — وهوَ الكذبُ الذي بُنيَ هذا البندُ لإبطالِه)، وأنَّ نصّاً غيرَ رقميٍّ
 *   لا يُرسَلُ إلى `bigint`، وأنَّ الوسائطَ تُمرَّرُ مُعامَلاتٍ لا نصّاً مُلحَقاً.
 * الحالة: اختبار فعلي — لا قاعدةَ ههنا؛ المحرِّكُ مُصنَّعٌ ليُقاسَ **التفسيرُ**.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: `F3` حينَ يُقرأُ جوابُ البثِّ بالعُرفِ نفسِه.
 * ملاحظات مستقبلية: صدقُ الدالّةِ نفسِها (الذرّيّةُ والسباقُ) يُقاسُ على
 *   PostgreSQL حقيقيٍّ في `tests/integration/ride-request.test.ts`، ولا يُغني
 *   أحدُهما عن الآخرِ: هذا يقيسُ القراءةَ، وذاكَ يقيسُ الحكمَ.
 *
 * وما لا يفعلُه عن قصدٍ: لا يزعمُ أنَّ الدالّةَ مُطبَّقةٌ في بيئةٍ حيّةٍ
 * (`ADR 0099`)، ولا يفحصُ نصَّ SQL حرفاً بحرفاً فيصيرَ قفلاً على صياغةٍ.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * المحرِّكُ المُصنَّعُ: المحوّلُ ينادي `sql.unsafe(text, values)` فيُسجَّلُ
 * النداءُ ويُعادُ صفٌّ واحدٌ حمولتُه `result` — وهيَ عينُ صيغةِ
 * `select fn(...) as result`.
 */
function fakeSql(result: unknown | { readonly throws: true }): { sql: Sql; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    if (typeof result === "object" && result !== null && "throws" in result) {
      throw new Error("فشلُ اتصالٍ مُصنَّع");
    }
    return [{ result }];
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

function emptySql(): Sql {
  return { unsafe: async () => [] } as unknown as Sql;
}

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const CREATED_AT = "2027-03-01T09:00:00.000Z";
const KEY = "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60";

const COMMAND_INPUT = {
  telegramUserId: "5550001",
  idempotencyKey: KEY,
  service: "transport",
  origin: { lat: 21.4858, lng: 39.1925 },
  destination: { lat: 21.5433, lng: 39.1728 },
  notes: null,
} as const;

describe("createRideRequestCommand — قراءةُ حكمِ الإنشاءِ", () => {
  it("النجاحُ يُقرأُ معرّفاً وختماً عدداً و`reused` كما وردَ", async () => {
    const { sql } = fakeSql({
      ok: true,
      reused: false,
      order_id: ORDER_ID,
      created_at: CREATED_AT,
    });
    const result = await createRideRequestCommand(sql).create(COMMAND_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      accepted: true,
      // `WR-06`: دالّةٌ لا تُعيدُ الحالةَ (أقدم) تُقرأُ «بحث»، والموعدانِ `null` صريحًا.
      ride: {
        orderId: ORDER_ID,
        createdAtMs: Date.parse(CREATED_AT),
        reused: false,
        status: "searching",
        pickupAtMs: null,
        dispatchAtMs: null,
      },
    });
  });

  it("`WR-06` — المجدولُ يُقرأُ بحالتِه وموعدَيه، وحالةٌ مجهولةٌ عطبُ عقدٍ لا نجاح", async () => {
    const pickup = "2027-03-01T15:00:00.000Z";
    const dispatch = "2027-03-01T14:40:00.000Z";
    const { sql } = fakeSql({
      ok: true,
      reused: false,
      order_id: ORDER_ID,
      created_at: CREATED_AT,
      status: "scheduled",
      pickup_at: pickup,
      dispatch_at: dispatch,
    });
    const result = await createRideRequestCommand(sql).create(COMMAND_INPUT);
    expect(result.ok && result.value.accepted ? result.value.ride : null).toEqual({
      orderId: ORDER_ID,
      createdAtMs: Date.parse(CREATED_AT),
      reused: false,
      status: "scheduled",
      pickupAtMs: Date.parse(pickup),
      dispatchAtMs: Date.parse(dispatch),
    });
    const bad = fakeSql({
      ok: true,
      reused: false,
      order_id: ORDER_ID,
      created_at: CREATED_AT,
      status: "parked",
    });
    const refused = await createRideRequestCommand(bad.sql).create(COMMAND_INPUT);
    expect(refused.ok).toBe(false);
  });

  it("`reused: true` لا يُبدَّلُ ولا يُطمَسُ: الضغطةُ الثانيةُ يجبُ أن تُعرَفَ", async () => {
    const { sql } = fakeSql({ ok: true, reused: true, order_id: ORDER_ID, created_at: CREATED_AT });
    const result = await createRideRequestCommand(sql).create(COMMAND_INPUT);
    expect(result.ok && result.value.accepted && result.value.ride.reused).toBe(true);
  });

  it("الوسائطُ تُمرَّرُ مُعامَلاتٍ بترتيبِ الدالّةِ، والمفتاحُ ثانيها", async () => {
    const { sql, calls } = fakeSql({
      ok: true,
      reused: false,
      order_id: ORDER_ID,
      created_at: CREATED_AT,
    });
    await createRideRequestCommand(sql).create({ ...COMMAND_INPUT, notes: "البوّابةُ الشماليّةُ" });
    expect(calls.length).toBe(1);
    expect(calls[0]?.text).toContain("request_ride");
    expect(calls[0]?.values).toEqual([
      "5550001",
      KEY,
      "transport",
      21.4858,
      39.1925,
      21.5433,
      39.1728,
      "البوّابةُ الشماليّةُ",
      null,
      null,
      null,
      // `ORDER-OFFER-01` — مبلغُ الراكبِ: غائبٌ ⇒ null.
      null,
      // `LOC-TRUST-01` — المكانانِ غائبانِ ⇒ null.
      null,
      null,
      // `WR-05` — مسارٌ بلا سياسةٍ (البوت) ⇒ «بلا سعر» لا مبلغٌ مُختلَق.
      "open",
    ]);
  });

  it("كلُّ رفضٍ مُعلَنٍ يُعادُ رفضاً لا عطباً", async () => {
    for (const refusal of [
      "INVALID_POINT",
      "CITY_HAS_NO_SERVICE_AREA",
      "ORIGIN_OUTSIDE_SERVICE_AREA",
      "DESTINATION_OUTSIDE_SERVICE_AREA",
      "SERVICE_NOT_AVAILABLE_IN_CITY",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_TOO_LONG",
      "NOTES_TOO_LONG",
    ] as const) {
      const { sql } = fakeSql({ ok: false, error: refusal });
      const result = await createRideRequestCommand(sql).create(COMMAND_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ accepted: false, refusal, activeRide: null });
    }
  });

  it("«رحلةٌ نشطةٌ» تُعادُ معَ طريقِ الخروجِ، ونقصُ المعرّفِ عطبُ عقدٍ", async () => {
    const full = fakeSql({
      ok: false,
      error: "ACTIVE_RIDE_EXISTS",
      order_id: ORDER_ID,
      status: "searching",
    });
    const withPath = await createRideRequestCommand(full.sql).create(COMMAND_INPUT);
    expect(withPath.ok && !withPath.value.accepted && withPath.value.activeRide).toEqual({
      orderId: ORDER_ID,
      status: "searching",
    });

    const partial = fakeSql({ ok: false, error: "ACTIVE_RIDE_EXISTS", order_id: ORDER_ID });
    const broken = await createRideRequestCommand(partial.sql).create(COMMAND_INPUT);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.reason).toBe("STORE_ERROR");
  });

  it("غيابُ الحسابِ وغيابُ تسجيلِ الراكبِ يُفصَلانِ ولا يُخلَطانِ", async () => {
    const user = await createRideRequestCommand(
      fakeSql({ ok: false, error: "USER_NOT_FOUND" }).sql,
    ).create(COMMAND_INPUT);
    expect(!user.ok && user.error.reason).toBe("USER_NOT_FOUND");
    const rider = await createRideRequestCommand(
      fakeSql({ ok: false, error: "RIDER_NOT_REGISTERED" }).sql,
    ).create(COMMAND_INPUT);
    expect(!rider.ok && rider.error.reason).toBe("RIDER_NOT_REGISTERED");
  });

  it("رمزٌ مجهولٌ من دالّةٍ أحدثَ يُعلَنُ عطباً ولا يُقرأُ نجاحاً", async () => {
    const { sql } = fakeSql({ ok: false, error: "SOME_FUTURE_CODE" });
    const result = await createRideRequestCommand(sql).create(COMMAND_INPUT);
    expect(!result.ok && result.error.reason).toBe("STORE_ERROR");
  });

  it("ختمٌ لا يُقرأُ عدداً، أو `reused` ليسَ منطقيّاً: عطبٌ لا قيمةٌ مُختلَقةٌ", async () => {
    for (const payload of [
      { ok: true, reused: false, order_id: ORDER_ID, created_at: "ليسَ ختماً" },
      { ok: true, reused: false, order_id: ORDER_ID },
      { ok: true, reused: "false", order_id: ORDER_ID, created_at: CREATED_AT },
      { ok: true, reused: false, created_at: CREATED_AT },
    ]) {
      const result = await createRideRequestCommand(fakeSql(payload).sql).create(COMMAND_INPUT);
      expect(!result.ok && result.error.reason).toBe("STORE_ERROR");
    }
  });

  it("جوابٌ غائبٌ أو صفٌّ غائبٌ أو استثناءُ اتّصالٍ: كلُّها عطبٌ مُعلَنٌ", async () => {
    const nulled = await createRideRequestCommand(fakeSql(null).sql).create(COMMAND_INPUT);
    expect(!nulled.ok && nulled.error.reason).toBe("STORE_ERROR");
    const empty = await createRideRequestCommand(emptySql()).create(COMMAND_INPUT);
    expect(!empty.ok && empty.error.reason).toBe("STORE_ERROR");
    const threw = await createRideRequestCommand(fakeSql({ throws: true }).sql).create(
      COMMAND_INPUT,
    );
    expect(!threw.ok && threw.error.reason).toBe("STORE_ERROR");
  });

  it("نصٌّ غيرُ رقميٍّ لا يُرسَلُ إلى `bigint` ألبتّةَ، وخدمةٌ مجهولةٌ لا تُمرَّرُ", async () => {
    const bad = fakeSql({ ok: true });
    const result = await createRideRequestCommand(bad.sql).create({
      ...COMMAND_INPUT,
      telegramUserId: "5550001; drop table orders",
    });
    expect(!result.ok && result.error.reason).toBe("USER_NOT_FOUND");
    expect(bad.calls.length).toBe(0);

    const unknownService = fakeSql({ ok: true });
    const service = await createRideRequestCommand(unknownService.sql).create({
      ...COMMAND_INPUT,
      service: "jet",
    });
    expect(!service.ok && service.error.reason).toBe("STORE_ERROR");
    expect(unknownService.calls.length).toBe(0);
  });
});

describe("createRideSearchReader — قراءةُ حالةِ البحثِ", () => {
  const STATE = {
    ok: true,
    order_id: ORDER_ID,
    status: "searching",
    service: "transport",
    broadcast_round: 1,
    created_at: CREATED_AT,
    notified_driver_count: 2,
    wider_circle_opened: false,
    escalated: false,
    cancellable_without_penalty: true,
  };

  it("الحالةُ تُقرأُ كاملةً وختمُها عددٌ ومعرّفُها من المسارِ", async () => {
    const { sql, calls } = fakeSql(STATE);
    const result = await createRideSearchReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      found: true,
      state: {
        orderId: ORDER_ID,
        status: "searching",
        service: "transport",
        createdAtMs: Date.parse(CREATED_AT),
        notifiedDriverCount: 2,
        widerCircleOpened: false,
        escalated: false,
        cancellableWithoutPenalty: true,
        // `WR-06`: بلا `search_started_at` (دالّةٌ أقدم) يبدأُ العدّادُ من الإنشاء.
        searchStartedAtMs: Date.parse(CREATED_AT),
        pickupAtMs: null,
        dispatchAtMs: null,
      },
    });
    expect(calls[0]?.text).toContain("ride_search_state");
    expect(calls[0]?.values).toEqual(["5550001", ORDER_ID]);
  });

  it("الصفرُ يُقرأُ صفراً، ونصُّ `bigint` يُقرأُ عدداً لا يُفترَضُ", async () => {
    const zero = await createRideSearchReader(
      fakeSql({ ...STATE, notified_driver_count: 0 }).sql,
    ).read({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(zero.ok && zero.value.found && zero.value.state.notifiedDriverCount).toBe(0);

    const text = await createRideSearchReader(
      fakeSql({ ...STATE, notified_driver_count: "17" }).sql,
    ).read({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(text.ok && text.value.found && text.value.state.notifiedDriverCount).toBe(17);
  });

  it("«معرّفٌ باطلٌ» و«لا رحلةَ» رفضانِ مقروءانِ لا عطبانِ", async () => {
    for (const refusal of ["INVALID_ORDER_ID", "ORDER_NOT_FOUND"] as const) {
      const result = await createRideSearchReader(fakeSql({ ok: false, error: refusal }).sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ found: false, refusal });
    }
  });

  it("حقلٌ ناقصٌ أو حالةٌ مجهولةٌ أو عدٌّ سالبٌ: عطبٌ لا حالةٌ مُجمَّلةٌ", async () => {
    for (const payload of [
      { ...STATE, status: "flying" },
      { ...STATE, service: "teleport" },
      { ...STATE, notified_driver_count: -1 },
      { ...STATE, created_at: null },
      { ...STATE, cancellable_without_penalty: "true" },
      // رايتا المآلِ (`PD-050`): غيابُهما أو غيرُ المنطقِ منهما عطبٌ — الطورُ لا يُختلَقُ.
      { ...STATE, wider_circle_opened: undefined },
      { ...STATE, escalated: undefined },
      { ...STATE, wider_circle_opened: "نعم" },
      { ...STATE, escalated: null },
    ]) {
      const result = await createRideSearchReader(fakeSql(payload).sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(!result.ok && result.error.reason).toBe("STORE_ERROR");
    }
  });

  it("استثناءُ التحويلِ في القاعدةِ يُقرأُ عطباً، ونصٌّ غيرُ رقميٍّ لا يُنادي", async () => {
    const threw = await createRideSearchReader(fakeSql({ throws: true }).sql).read({
      telegramUserId: "5550001",
      orderId: "ليسَ uuid",
    });
    expect(!threw.ok && threw.error.reason).toBe("STORE_ERROR");

    const bad = fakeSql(STATE);
    const identity = await createRideSearchReader(bad.sql).read({
      telegramUserId: "not-a-number",
      orderId: ORDER_ID,
    });
    expect(!identity.ok && identity.error.reason).toBe("USER_NOT_FOUND");
    expect(bad.calls.length).toBe(0);
  });
});

describe("createRideCancelCommand — قراءةُ حكمِ الإلغاءِ", () => {
  it("النجاحُ يُعلَنُ إلغاءً ولا يحملُ حقلاً ماليّاً ولا عقوبةً", async () => {
    const { sql, calls } = fakeSql({ ok: true });
    const result = await createRideCancelCommand(sql).cancel({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ cancelled: true });
    expect(calls[0]?.text).toContain("cancel_ride_by_telegram");
    expect(calls[0]?.values).toEqual(["5550001", ORDER_ID]);
  });

  it("ثلاثةُ رفضاتٍ مفصولةٌ: «باطلٌ» و«لا رحلةَ» و«فاتَ أوانُ الإلغاءِ»", async () => {
    for (const refusal of [
      "INVALID_ORDER_ID",
      "ORDER_NOT_FOUND",
      "ORDER_NOT_CANCELLABLE",
    ] as const) {
      const result = await createRideCancelCommand(
        fakeSql({ ok: false, error: refusal }).sql,
      ).cancel({ telegramUserId: "5550001", orderId: ORDER_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ cancelled: false, refusal });
    }
  });

  it("غيابُ الحسابِ عطبٌ مفصولٌ، ورمزٌ مجهولٌ عطبٌ لا نجاحٌ", async () => {
    const user = await createRideCancelCommand(
      fakeSql({ ok: false, error: "USER_NOT_FOUND" }).sql,
    ).cancel({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(!user.ok && user.error.reason).toBe("USER_NOT_FOUND");

    const rider = await createRideCancelCommand(
      fakeSql({ ok: false, error: "RIDER_NOT_REGISTERED" }).sql,
    ).cancel({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(!rider.ok && rider.error.reason).toBe("RIDER_NOT_REGISTERED");

    const unknown = await createRideCancelCommand(
      fakeSql({ ok: false, error: "SOMETHING_ELSE" }).sql,
    ).cancel({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(!unknown.ok && unknown.error.reason).toBe("STORE_ERROR");
  });

  it("جوابٌ غائبٌ أو استثناءٌ: عطبٌ مُعلَنٌ لا إلغاءٌ مزعومٌ", async () => {
    const nulled = await createRideCancelCommand(fakeSql(null).sql).cancel({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(!nulled.ok && nulled.error.reason).toBe("STORE_ERROR");
    const threw = await createRideCancelCommand(fakeSql({ throws: true }).sql).cancel({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(!threw.ok && threw.error.reason).toBe("STORE_ERROR");
  });
});
