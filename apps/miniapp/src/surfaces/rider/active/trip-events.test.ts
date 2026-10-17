/**
 * ADR 0287 — عميلُ أحداثِ الرحلةِ في Mini App: لا إقرارَ بحدثٍ لم تُطبّقْه اللقطةُ،
 * والانضمامُ يُعادُ عندَ كلِّ اتصالٍ (عودةُ العميلِ)، والإقرارُ بعدَ التطبيقِ لا قبله.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { Socket } from "socket.io-client";
import { ackableIds, phaseSeq, subscribeTripEvents, type TripEvent } from "./trip-events.ts";

const EVENTS: TripEvent[] = [
  { id: "m", event: "MATCHED", seq: 1, created_at: "", acked: false },
  { id: "a", event: "ARRIVED", seq: 2, created_at: "", acked: true },
  { id: "s", event: "STARTED", seq: 3, created_at: "", acked: false },
  { id: "c", event: "COMPLETED", seq: 4, created_at: "", acked: false },
];

function fakeSocket() {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const emitted: string[] = [];
  let disconnected = false;
  const socket = {
    on: (name: string, fn: (payload?: unknown) => void) => {
      handlers.set(name, fn);
      return socket;
    },
    emit: (name: string) => {
      emitted.push(name);
      return socket;
    },
    disconnect: () => {
      disconnected = true;
      return socket;
    },
  };
  return {
    socket: socket as unknown as Socket,
    fire: (name: string, payload?: unknown) => handlers.get(name)?.(payload),
    emitted,
    isDisconnected: () => disconnected,
  };
}

describe("ADR 0287 — أحداثُ الرحلةِ في Mini App", () => {
  it("تسلسلُ الطورِ يطابقُ القاعدةَ (MATCHED=1 … COMPLETED=4)", () => {
    expect(["driver_assigned", "driver_arrived", "on_trip", "completed"].map(phaseSeq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(phaseSeq("searching")).toBe(0);
    expect(phaseSeq("closed")).toBe(0);
  });

  it("لا إقرارَ بما فوقَ طورِ اللقطةِ المطبَّقةِ ولا بالمُقَرِّ سلفًا", () => {
    expect(ackableIds(EVENTS, "driver_assigned")).toEqual(["m"]);
    expect(ackableIds(EVENTS, "on_trip")).toEqual(["m", "s"]);
    expect(ackableIds(EVENTS, "completed")).toEqual(["m", "s", "c"]);
    expect(ackableIds(EVENTS, "searching")).toEqual([]);
  });

  it("الانضمامُ عندَ كلِّ اتصالٍ (عودةٌ بعدَ انقطاعٍ) ثم مزامنةٌ، والإشارةُ تحملُ الطلبَ", () => {
    const fake = fakeSocket();
    const signals: (string | null)[] = [];
    const sub = subscribeTripEvents(
      { transport: { connect: () => fake.socket }, sessions: { read: () => "tok" }, baseUrl: "" },
      { onSignal: (o) => signals.push(o) },
    );
    fake.fire("connect");
    fake.fire("trip:joined");
    fake.fire("trip:update", { order_id: "o-1" });
    fake.fire("connect"); // عودةُ الاتصالِ
    expect(fake.emitted).toEqual(["trip:join", "trip:join"]);
    expect(signals).toEqual([null, "o-1"]);
    sub.disconnect();
    expect(fake.isDisconnected()).toBe(true);
  });

  it("بلا جلسةٍ لا اتصالَ يُخترَعُ", () => {
    let connected = false;
    subscribeTripEvents(
      {
        transport: {
          connect: () => {
            connected = true;
            return fakeSocket().socket;
          },
        },
        sessions: { read: () => null },
        baseUrl: "",
      },
      { onSignal: () => undefined },
    );
    expect(connected).toBe(false);
  });

  it("الشاشةُ تُقِرُّ بعدَ تطبيقِ اللقطةِ لا قبلَه (ترتيبُ المصدرِ)", () => {
    const src = readFileSync(new URL("./ActiveRideScreen.tsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const syncTripEvents"));
    const applied = body.indexOf("await refresh(id)");
    const ack = body.indexOf("tripEvents.api.ack(");
    expect(applied).toBeGreaterThan(-1);
    expect(ack).toBeGreaterThan(applied);
    // القراءةُ الفاشلةُ أو المشغولةُ (null) لا تُقِرُّ.
    expect(body.slice(applied, ack)).toContain("if (applied === null");
  });
});
