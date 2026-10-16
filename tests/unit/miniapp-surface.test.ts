/**
 * الغرض: طبقةُ البوتِ الخفيفةُ — ما يبقى في المحادثةِ وما يُحالُ إلى التطبيقِ (`ADR 0213` · `ADR 0286`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { allItemsFor, type BotAudience } from "../../packages/application/bots/main-menu.ts";
import {
  COMMAND_HOMES,
  decideSurface,
  handleSurfaceUpdate,
  type MiniAppSurfaceConfig,
  type SurfacePorts,
  surfaceCommandsFor,
} from "../../packages/application/bots/miniapp-surface.ts";
import {
  type ActiveOrderSummary,
  type BotReply,
  type DialogState,
  INITIAL_STATE,
  type IncomingUpdate,
  type SessionStore,
} from "../../packages/application/bots/types.ts";
import { t } from "../../packages/shared/i18n/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CONFIG: MiniAppSurfaceConfig = {
  mode: "miniapp",
  miniAppUrl: "https://waslah-miniapp.onrender.com/",
};
const USER = "5550001";
const ORDER = "0f8fad5b-d9cb-469f-a165-70867728950e";

function text(value: string, chatId = USER): IncomingUpdate {
  return {
    kind: "text",
    updateId: 1,
    text: value,
    from: { telegramUserId: USER, chatId, languageHint: "ar" },
  };
}

function sessions(state: DialogState | null, loads: { count: number }): SessionStore {
  return {
    load: async () => {
      loads.count += 1;
      return ok(state);
    },
    save: async () => ok(undefined),
    clear: async () => ok(undefined),
  };
}

interface Harness {
  readonly ports: SurfacePorts;
  readonly loads: { count: number };
  readonly starts: string[];
}

function harness(
  options: {
    readonly state?: DialogState | null;
    readonly registered?: boolean | null;
    readonly active?: readonly ActiveOrderSummary[];
  } = {},
): Harness {
  const loads = { count: 0 };
  const starts: string[] = [];
  return {
    loads,
    starts,
    ports: {
      sessions: sessions(options.state ?? null, loads),
      initialState: INITIAL_STATE,
      isRegistered: async () => (options.registered === undefined ? true : options.registered),
      activeOrdersOf: async () => options.active ?? [],
      onStart: async (id) => {
        starts.push(id);
      },
    },
  };
}

const LEGACY_REPLY: BotReply = { chatId: USER, text: "legacy", keyboard: null };

async function run(
  audience: BotAudience,
  update: IncomingUpdate,
  h: Harness,
  config: MiniAppSurfaceConfig = CONFIG,
): Promise<{ readonly replies: readonly BotReply[]; readonly legacyCalls: number }> {
  let legacyCalls = 0;
  const replies = await handleSurfaceUpdate(audience, update, config, h.ports, async () => {
    legacyCalls += 1;
    return [LEGACY_REPLY];
  });
  return { replies, legacyCalls };
}

function webAppUrls(replies: readonly BotReply[]): string[] {
  return replies.flatMap((reply) =>
    reply.keyboard?.kind === "inline"
      ? reply.keyboard.rows.flat().flatMap((button) => (button.webAppUrl ? [button.webAppUrl] : []))
      : [],
  );
}

describe("السجلُّ: لكلِّ أمرٍ في قائمةِ البوتِ موطنٌ مُعلَنٌ", () => {
  for (const audience of ["rider", "driver"] as const) {
    it(`${audience}: لا أمرَ في القائمةِ بلا موطنٍ`, () => {
      for (const item of allItemsFor(audience)) {
        expect(COMMAND_HOMES[audience][item.command]).toBeDefined();
      }
      for (const name of ["/start", "/help", "/app"]) {
        expect(COMMAND_HOMES[audience][name]).toEqual({ home: "entry" });
      }
    });

    it(`${audience}: ما بقيَ في البوتِ مكتوبٌ سببُه`, () => {
      for (const home of Object.values(COMMAND_HOMES[audience])) {
        if (home.home === "bot") expect(home.why.length).toBeGreaterThan(20);
      }
    });
  }

  it("/sos و/language في البوتِ للجمهورَين — قناتانِ أساسيّتانِ", () => {
    for (const audience of ["rider", "driver"] as const) {
      expect(COMMAND_HOMES[audience]["/sos"]?.home).toBe("bot");
      expect(COMMAND_HOMES[audience]["/language"]?.home).toBe("bot");
    }
  });
});

describe("decideSurface: قرارٌ متزامنٌ بلا قراءةٍ", () => {
  it("القروبُ ⇒ legacy", () => {
    expect(decideSurface("rider", text("/history", "-100200"))).toEqual({ kind: "legacy" });
  });

  it("زرُّ رسالةٍ قائمةٍ (عرضٌ) ⇒ app_button: لا يُنفَّذُ عملٌ من البوتِ (ADR 0286)", () => {
    expect(
      decideSurface("driver", {
        kind: "callback",
        updateId: 1,
        data: "offer:accept:1",
        from: { telegramUserId: USER, chatId: USER, languageHint: "ar" },
      }),
    ).toEqual({ kind: "app_button" });
  });

  it("أزرارُ العملِ القديمةُ كلُّها ⇒ app_button — لا استثناءَ لعرضٍ أو رحلةٍ أو مطالبة", () => {
    for (const data of [
      "offer:accept:1",
      "offer:reject:2",
      "ride:start:3",
      "ride:complete:3",
      "unsub:claim:4",
      "sub:buy:plan-a",
      "avail:off",
      "rate:5:5",
      "trk:off:6",
      "sup:type:question",
      "fin:view",
      "area:skip",
      "city:9",
    ]) {
      expect(
        decideSurface("driver", {
          kind: "callback",
          updateId: 1,
          data,
          from: { telegramUserId: USER, chatId: USER, languageHint: "ar" },
        }),
      ).toEqual({ kind: "app_button" });
    }
  });

  it("أزرارُ الطوارئِ واللغةِ وحدها تمرُّ إلى معالجِها", () => {
    for (const data of ["sos:claim:7", "lang:ar", "lang:en"]) {
      expect(
        decideSurface("driver", {
          kind: "callback",
          updateId: 1,
          data,
          from: { telegramUserId: USER, chatId: USER, languageHint: "ar" },
        }),
      ).toEqual({ kind: "legacy" });
    }
  });

  it("زرُّ cmd: من لوحةِ /help ⇒ يمرُّ بالسجلِّ", () => {
    expect(
      decideSurface("rider", {
        kind: "callback",
        updateId: 1,
        data: "cmd:/history",
        from: { telegramUserId: USER, chatId: USER, languageHint: "ar" },
      }),
    ).toEqual({ kind: "open", command: "/history", screen: "history" });
  });

  it("نصُّ زرِّ القائمةِ القديمةِ يُترجَمُ إلى أمرِه", () => {
    expect(decideSurface("rider", text(t("ar")("menu.rider.history")))).toEqual({
      kind: "open",
      command: "/history",
      screen: "history",
    });
  });

  it("/start@bot payload ⇒ /start", () => {
    expect(decideSurface("rider", text("/start@ODD_R_BOT abc"))).toEqual({
      kind: "entry",
      command: "/start",
      registrationDecides: false,
    });
  });

  it("الموقعُ والصورُ وبطاقةُ الاتصالِ ⇒ legacy", () => {
    expect(
      decideSurface("driver", {
        kind: "location",
        updateId: 1,
        location: { latitude: 21.4, longitude: 39.8 } as never,
        from: { telegramUserId: USER, chatId: USER, languageHint: "ar" },
      }),
    ).toEqual({ kind: "legacy" });
  });
});

describe("handleSurfaceUpdate", () => {
  it("وضعُ legacy يمرِّرُ كلَّ شيءٍ بلا قراءةِ جلسةٍ", async () => {
    const h = harness();
    const out = await run("rider", text("/history"), h, { mode: "legacy", miniAppUrl: null });
    expect(out.legacyCalls).toBe(1);
    expect(h.loads.count).toBe(0);
  });

  it("/sos يمرُّ إلى الحوارِ قبلَ أيِّ قراءةٍ (ADR 0077)", async () => {
    for (const audience of ["rider", "driver"] as const) {
      const h = harness();
      const out = await run(audience, text("/sos"), h);
      expect(out.legacyCalls).toBe(1);
      expect(h.loads.count).toBe(0);
    }
  });

  it("/history ⇒ زرُّ تطبيقٍ على السجلِّ، والحوارُ القديمُ لا يُنادى", async () => {
    const h = harness();
    const out = await run("rider", text("/history"), h);
    expect(out.legacyCalls).toBe(0);
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/?open=history"]);
  });

  it("/status بمشوارٍ جارٍ ⇒ الرحلةُ نفسُها", async () => {
    const h = harness({
      active: [
        {
          orderId: ORDER as never,
          service: "transport",
          status: "searching",
          pickupLabel: null,
          dropoffLabel: null,
          createdAt: new Date(),
        },
      ],
    });
    const out = await run("rider", text("/status"), h);
    expect(webAppUrls(out.replies)).toEqual([
      `https://waslah-miniapp.onrender.com/?open=ride_${ORDER}`,
    ]);
  });

  it("/status بطلبِ توصيلٍ وحدَه ⇒ السجلُّ: لا عملَ يُنفَّذُ في المحادثةِ (ADR 0286)", async () => {
    const h = harness({
      active: [
        {
          orderId: ORDER as never,
          service: "delivery",
          status: "searching",
          pickupLabel: null,
          dropoffLabel: null,
          createdAt: new Date(),
        },
      ],
    });
    const out = await run("rider", text("/status"), h);
    expect(out.legacyCalls).toBe(0);
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/?open=history"]);
  });

  it("/status بلا طلبٍ ⇒ السجلُّ", async () => {
    const out = await run("rider", text("/cancel"), harness());
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/?open=history"]);
  });

  it("/start لسائقٍ غيرِ مسجَّلٍ ⇒ التسجيلُ في التطبيقِ لا حواراً في البوتِ (ADR 0286)", async () => {
    const h = harness({ registered: false });
    const out = await run("driver", text("/start"), h);
    expect(out.legacyCalls).toBe(0);
    expect(h.starts).toEqual([USER]);
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/"]);
    // الرسالةُ ترحيبُ الدخولِ نفسُه: التطبيقُ يوجِّهُ غيرَ المسجَّلِ إلى سطحِ التسجيلِ.
    expect(out.replies[0]?.text).toContain(t("ar")("miniapp.entry.welcome_driver"));
  });

  it("/start لسائقٍ مسجَّلٍ ⇒ ترحيبٌ وزرٌّ، وترقيةُ المسؤولِ تُحاوَلُ (ADR 0212)", async () => {
    const h = harness({ registered: true });
    const out = await run("driver", text("/start"), h);
    expect(out.legacyCalls).toBe(0);
    expect(h.starts).toEqual([USER]);
    expect(out.replies).toHaveLength(2);
    expect(out.replies[0]?.keyboard?.kind).toBe("reply");
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/"]);
  });

  it("/start لراكبٍ غيرِ مسجَّلٍ ⇒ التطبيقُ على شاشةِ التسجيلِ", async () => {
    const out = await run("rider", text("/start"), harness({ registered: false }));
    expect(out.legacyCalls).toBe(0);
    expect(webAppUrls(out.replies)).toEqual([
      "https://waslah-miniapp.onrender.com/?open=onboarding",
    ]);
  });

  it("نصٌّ حرٌّ في حوارٍ جارٍ ⇒ يُصفَّرُ إلى الخمولِ ويُوجَّهُ إلى التطبيقِ — لا جوابَ خطوةٍ في البوتِ (ADR 0286)", async () => {
    const saved: DialogState[] = [];
    const h = harness({ state: { ...INITIAL_STATE, step: "awaiting_name" } });
    const originalSave = h.ports.sessions.save.bind(h.ports.sessions);
    h.ports.sessions.save = async (id: string, state: DialogState) => {
      saved.push(state);
      return originalSave(id, state);
    };
    const out = await run("driver", text("أحمد علي"), h);
    expect(out.legacyCalls).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.step).toBe("idle");
    // موطنُ السائقِ في التطبيقِ: لوحُ العروضِ.
    expect(webAppUrls(out.replies)).toEqual(["https://waslah-miniapp.onrender.com/?open=offers"]);
  });

  it("نصٌّ حرٌّ بلا حوارٍ ⇒ زرُّ التطبيقِ", async () => {
    const out = await run("rider", text("مرحبا"), harness());
    expect(out.legacyCalls).toBe(0);
    expect(webAppUrls(out.replies)).toHaveLength(1);
  });

  it("تعذُّرُ القراءةِ ⇒ ردُّ عطلٍ صريحٌ من الطبقةِ الخفيفةِ، لا عملٌ في المحادثةِ (ADR 0286)", async () => {
    const out = await run("rider", text("/start"), harness({ registered: null }));
    expect(out.legacyCalls).toBe(0);
    expect(out.replies).toHaveLength(1);
    expect(out.replies[0]?.text).toBe(t("ar")("common.error_try_again"));
  });

  it("أمرٌ مجهولٌ للسجلِّ ⇒ الحوارُ القديمُ", async () => {
    const out = await run("driver", text("/activate"), harness());
    expect(out.legacyCalls).toBe(1);
  });
});

describe("surfaceCommandsFor", () => {
  it("لا يُعلَنُ أمرٌ انتقلَ، ويُعلَنُ /app والأساسيّةُ", () => {
    for (const audience of ["rider", "driver"] as const) {
      const names = surfaceCommandsFor(audience, "ar").map((c) => c.command);
      expect(names).toContain("start");
      expect(names).toContain("app");
      expect(names).toContain("sos");
      expect(names).toContain("language");
      expect(names).toContain("help");
      for (const [name, home] of Object.entries(COMMAND_HOMES[audience])) {
        if (home.home === "miniapp") expect(names).not.toContain(name.slice(1));
      }
      for (const command of surfaceCommandsFor(audience, "en")) {
        expect(command.description.length).toBeGreaterThan(0);
        expect(command.description.includes(".description")).toBe(false);
      }
    }
  });
});
