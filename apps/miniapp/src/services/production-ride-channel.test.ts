/**
 * اختباراتُ تركيبِ الإنتاجِ لقناةِ الرحلةِ الآنيةِ (`F4-07`).
 *
 * يُثبِتُ أنَّ السطحَ الجذريَّ للراكبِ يُمرِّرُ منافذَ Socket.IO حقيقيةً لا
 * اختباريّةً فقط: `channelTransport` و`sessionReader` و`channelBaseUrl`.
 */

import { describe, expect, it } from "bun:test";
import { clearSession } from "../identity/session.ts";
import {
  productionChannelBaseUrl,
  productionRideChannelTransport,
  productionSessionReader,
} from "./production-ride-channel.ts";

describe("production-ride-channel", () => {
  it("الناقلُ مُعرَّفٌ وليسَ `undefined`", () => {
    expect(productionRideChannelTransport).toBeDefined();
    expect(typeof productionRideChannelTransport.connect).toBe("function");
  });

  it("قارئُ الجلسةِ مُعرَّفٌ وليسَ `undefined`", () => {
    expect(productionSessionReader).toBeDefined();
    expect(typeof productionSessionReader.read).toBe("function");
  });

  it("قارئُ الجلسةِ يُرجِعُ `null` بلا جلسةٍ محفوظةٍ", () => {
    // لا يعتمدُ على ترتيبِ الملفّات: الجلسةُ حالةُ وحدةٍ مشتركة في العمليّة.
    clearSession();
    expect(productionSessionReader.read()).toBeNull();
  });

  it("أساسُ العنوانِ دالةٌ تُرجِعُ نصّاً", () => {
    const base = productionChannelBaseUrl();
    expect(typeof base).toBe("string");
  });
});
