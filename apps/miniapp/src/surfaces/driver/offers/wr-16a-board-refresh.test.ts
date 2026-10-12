/**
 * الغرض: `WR-16A` — «حدّث اللوح» جلبٌ فعليٌّ من الخادمِ بتحميلٍ وفشلٍ ونجاح، وانقطاعُ الاتصالِ
 *   حالةٌ مسمّاةٌ لا «تعثّر الطلب»، واللوحُ القديمُ يُقالُ ولا يُكتَم.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import ar from "../../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import { ApiNetworkError } from "../../../api/client.ts";
import {
  boardRefreshNotice,
  isRetryableOffersError,
  offersCodeOf,
  offersErrorKey,
} from "./offers-view.ts";

describe("WR-16A — انقطاعُ الاتصالِ حالةٌ مسمّاة", () => {
  it("خطأُ الشبكةِ `NETWORK_UNREACHABLE`، والرمزُ من الخادمِ كما هو، وغيرُهما `UNKNOWN`", () => {
    expect(offersCodeOf(new ApiNetworkError())).toBe("NETWORK_UNREACHABLE");
    const server = Object.assign(new Error("x"), { code: "OFFER_STORE_NOT_AVAILABLE" });
    expect(offersCodeOf(server)).toBe("OFFER_STORE_NOT_AVAILABLE");
    expect(offersCodeOf(new Error("x"))).toBe("UNKNOWN");
    expect(offersCodeOf(null)).toBe("UNKNOWN");
  });

  it("له نصُّه وزرُّ إعادة", () => {
    expect(offersErrorKey("NETWORK_UNREACHABLE")).toBe("driver.offers.network.unreachable");
    expect(isRetryableOffersError("NETWORK_UNREACHABLE")).toBe(true);
  });
});

describe("WR-16A — نتيجةُ «حدّث اللوح»", () => {
  it("التحميلُ والنجاحُ والفشلُ والانقطاعُ لكلٍّ سطرُه", () => {
    expect(boardRefreshNotice({ kind: "idle" }, false)).toBeNull();
    expect(boardRefreshNotice({ kind: "busy" }, false)?.key).toBe("driver.offers.refresh.busy");
    expect(boardRefreshNotice({ kind: "done" }, false)).toEqual({
      key: "driver.offers.refresh.done",
      role: "status",
    });
    expect(boardRefreshNotice({ kind: "failed", code: "UNKNOWN" }, true)).toEqual({
      key: "driver.offers.refresh.failed",
      role: "alert",
    });
    expect(boardRefreshNotice({ kind: "failed", code: "NETWORK_UNREACHABLE" }, true)?.key).toBe(
      "driver.offers.refresh.offline",
    );
  });

  it("تحديثٌ آنيٌّ فشلَ يُقالُ ولو نجحَ تحديثٌ يدويٌّ قبلَه", () => {
    expect(boardRefreshNotice({ kind: "idle" }, true)?.key).toBe("driver.offers.refresh.stale");
    expect(boardRefreshNotice({ kind: "done" }, true)?.key).toBe("driver.offers.refresh.stale");
  });

  it("الزرُّ يُنادي الجلبَ غيرَ الماسحِ لا `load`، ويُعطَّلُ أثناءَه", () => {
    const source = readFileSync(new URL("./OffersScreen.tsx", import.meta.url), "utf8");
    expect(source).toContain("onClick={() => void refreshBoard()}");
    expect(source).not.toContain('className="dof__refresh" onClick={() => void load()}');
    expect(source).toContain('disabled={refresh.kind === "busy"}');
  });

  it("كلُّ مفتاحٍ له نصٌّ في اللغاتِ الثلاث", () => {
    const keys = [
      "driver.offers.network.unreachable",
      "driver.offers.refresh.busy",
      "driver.offers.refresh.done",
      "driver.offers.refresh.failed",
      "driver.offers.refresh.offline",
      "driver.offers.refresh.stale",
    ];
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const key of keys) expect(typeof dict[key]).toBe("string");
    }
  });
});
