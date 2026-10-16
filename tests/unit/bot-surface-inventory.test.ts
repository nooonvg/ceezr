/* biome-ignore-all lint/style/noNonNullAssertion: مفاتيح الجرد مكتملة تعريفًا (driver/rider) — الاختبار يفحص الكل فلا يمرّ null */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { BotAudience } from "../../packages/application/bots/main-menu.ts";
import {
  BOT_ALLOWED_CALLBACK_PREFIXES,
  COMMAND_HOMES,
  decideSurface,
  LEGACY_DIALOG_STEP_COMMANDS,
  OWNER_OPS_COMMANDS,
} from "../../packages/application/bots/miniapp-surface.ts";

/**
 * جردُ أوامرِ وcallbacks البوت — `ADR 0286` (المرحلة 1 من خارطة الاستكمال).
 *
 * هذا هو **الجردُ المانعُ**: القائمةُ تُستخرجُ منَ الشيفرةِ نفسِها (موزّعاتُ
 * الحوارَين)، لا تُكتبُ يدويًا. أيُّ أمرٍ أو بادئةِ زرٍّ جديدةٍ تُضافُ إلى
 * الحواراتِ بلا تصنيفٍ تُسقِطُ هذا الاختبارَ بصوتٍ عالٍ — فلا يمرُّ عملٌ تجاريٌّ
 * جديدٌ عبرَ البوتِ بالسهوِ.
 *
 * التصنيفُ (عقدُ ADR 0286):
 *  - **عملٌ تجاريٌّ ⇒ Mini App**: كلُّ أمرٍ تجاريٍّ موطنُهُ التطبيقُ (`COMMAND_HOMES`
 *    home=miniapp) ويفتحُ شاشته؛ وكلُّ زرِ عملٍ قديمٍ (callback) يُرَدُّ
 *    `app_button` — لا يُنفَّذُ خلفيًا.
 *  - **دخولٌ وأساسياتٌ ⇒ البوت**: `/start` `/help` `/app` واللغةُ والطوارئُ
 *    وقراءاتٌ لا تُغيّرُ حالةً — بادئاتُ السماحِ المغلقةُ (`lang` · `sos`).
 *  - **استثناءٌ يُرفعُ للمالكِ**: أوامرُ تشغيلِ الدعمِ (`OWNER_OPS_COMMANDS`).
 *  - **خطواتُ حوارٍ قديمةٍ**: `LEGACY_DIALOG_STEP_COMMANDS` — لا أعمالًا مستقلةً.
 */

const DRIVER_DIALOG = "packages/application/bots/driver-dialog.ts";
const RIDER_DIALOG = "packages/application/bots/rider-dialog.ts";

/** جسمُ دالّةٍ بالاسمِ — موازنةُ الأقواسِ الساذجةُ كافيةٌ لملفاتِ الطبقةِ هذه. */
function functionBody(path: string, name: string): string {
  const src = readFileSync(path, "utf8");
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(src);
  if (m === null) throw new Error(`لم يُعثر على ${name} في ${path}`);
  const start = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i);
    }
  }
  throw new Error(`لم تُغلق ${name} في ${path}`);
}

/** أوامرُ موزّعِ الأوامرِ: `case "/x":` داخلَ جسمِ handleCommand. */
function commandsOf(path: string): string[] {
  const body = functionBody(path, "handleCommand");
  return [...new Set([...body.matchAll(/case "(\/[a-z]+)"/g)].map((m) => m[1] ?? ""))]
    .filter(Boolean)
    .sort();
}

/**
 * بادئاتُ الـcallbacks التي يعرفُها الحوار:
 *  - السائقُ: `case "x":` داخلَ handleCallback.
 *  - الراكبُ: `if (prefix === "x")` (سلسلةُ الشرطِ داخلَ المعالجِ الرئيسي).
 */
function driverCallbackPrefixes(): string[] {
  const body = functionBody(DRIVER_DIALOG, "handleCallback");
  return [...new Set([...body.matchAll(/case "([a-z]+)"/g)].map((m) => m[1] ?? ""))]
    .filter(Boolean)
    .sort();
}

function riderCallbackPrefixes(): string[] {
  const src = readFileSync(RIDER_DIALOG, "utf8");
  return [...new Set([...src.matchAll(/if \(prefix === "([a-z]+)"\)/g)].map((m) => m[1] ?? ""))]
    .filter(Boolean)
    .sort();
}

/** زرُّ `cmd:` يمرُّ عبرَ `commandOf` إلى مواطنِ الأوامرِ — ليس بادئةَ عملٍ مستقلة. */
const CMD_PREFIX = "cmd";

interface AudienceInventory {
  readonly commands: string[];
  readonly callbacks: string[];
}
function inventory(): { driver: AudienceInventory; rider: AudienceInventory } {
  return {
    driver: { commands: commandsOf(DRIVER_DIALOG), callbacks: driverCallbackPrefixes() },
    rider: { commands: commandsOf(RIDER_DIALOG), callbacks: riderCallbackPrefixes() },
  };
}

describe("جرد أوامر وcallbacks البوت — عقد ADR 0286 (المرحلة 1)", () => {
  const inv = inventory();
  const driverInv = inv.driver;
  const riderInv = inv.rider;

  test("الجردُ غيرُ فارغٍ — الاستخراجُ منَ الشيفرةِ يعملُ فعلًا", () => {
    expect(driverInv.commands.length).toBeGreaterThan(5);
    expect(riderInv.commands.length).toBeGreaterThan(5);
    expect(driverInv.callbacks.length).toBeGreaterThan(5);
    expect(riderInv.callbacks.length).toBeGreaterThan(5);
  });

  for (const audience of ["rider", "driver"] as const) {
    test(`${audience}: كلُّ أمرٍ يعرفهُ الحوارُ مصنَّفٌ — عملٌ في التطبيقِ أو أساسيٌّ في البوتِ أو خطوةُ حوارٍ أو أمرُ مالكٍ`, () => {
      const unclassified = inv[audience]!.commands.filter(
        (command) =>
          COMMAND_HOMES[audience][command] === undefined &&
          !LEGACY_DIALOG_STEP_COMMANDS[audience].has(command) &&
          !OWNER_OPS_COMMANDS.has(command),
      );
      // رسالةُ الفشلِ تحملُ الجردَ كاملًا — الفرقُ يُرى لا يُخمَّن
      expect(
        `أوامرٌ بلا تصنيفٍ: ${unclassified.join(" · ")} — أضِفْ موطنًا في COMMAND_HOMES أو وثّقْها في مجموعةٍ مغلقةٍ (استثناءُ المالكِ يُرفعُ لهُ قرارًا)`,
      ).toBe(
        `أوامرٌ بلا تصنيفٍ:  — أضِفْ موطنًا في COMMAND_HOMES أو وثّقْها في مجموعةٍ مغلقةٍ (استثناءُ المالكِ يُرفعُ لهُ قرارًا)`,
      );
    });

    test(`${audience}: كلُّ عملٍ تجاريٍّ موطنُهُ التطبيقُ (home=miniapp) يفتحُ شاشةً — لا أمرَ تجاريًا يبقى في البوتِ`, () => {
      for (const [command, home] of Object.entries(COMMAND_HOMES[audience])) {
        if (home.home !== "miniapp") continue;
        // موطنُ التطبيقِ يستلزمُ شاشةً — زرُّ التطبيقِ بلا هدفٍ ليس عملًا يُنجَز
        expect(home.screen).toBeDefined();
        // والأمرُ موجودٌ فعلًا في الحوارِ (لا سجلَّ لأوامرٍ ميتةٍ)
        expect(inv[audience]!.commands).toContain(command);
      }
    });
  }

  test("ما بقيَ في البوتِ مكتوبٌ سببُه — لا أساسياتَ بلا تعليلٍ", () => {
    for (const audience of ["rider", "driver"] as const) {
      for (const [, home] of Object.entries(COMMAND_HOMES[audience])) {
        if (home.home === "bot") expect(home.why).toBeDefined();
      }
    }
  });

  test("قائمةُ السماحِ للـcallbacks مثبتةٌ: الطوارئُ واللغةُ فقط — أيُّ توسيعٍ قرارٌ يُوثَّقُ", () => {
    expect([...BOT_ALLOWED_CALLBACK_PREFIXES].sort()).toEqual(["lang", "sos"]);
  });

  for (const audience of ["rider", "driver"] as const) {
    test(`${audience}: كلُّ زرِّ عملٍ قديمٍ (callback) يُرَدُّ app_button — لا استثناءَ لعرضٍ أو رحلةٍ أو مطالبةٍ`, () => {
      const business = inv[audience]!.callbacks.filter(
        (prefix) => !BOT_ALLOWED_CALLBACK_PREFIXES.has(prefix) && prefix !== CMD_PREFIX,
      );
      expect(business.length).toBeGreaterThan(3); // الجردُ حقيقيٌّ لا شكليٌّ
      for (const prefix of business) {
        // `data: prefix:accept:x` يُقرَّرُ منَ السطحِ لا منَ قائمةٍ يدويةٍ
        const decision = decideSurfaceFor(audience, `${prefix}:accept:1`);
        expect(decision).toEqual({ kind: "app_button" });
      }
    });

    test(`${audience}: أزرارُ الطوارئِ واللغةِ وحدها تمرُّ إلى معالجِها`, () => {
      for (const prefix of BOT_ALLOWED_CALLBACK_PREFIXES) {
        expect(decideSurfaceFor(audience, `${prefix}:x`)).toEqual({ kind: "legacy" });
      }
    });
  }

  test("زرُّ cmd: يمرُّ عبرَ مواطنِ الأوامرِ لا بادئةَ عملٍ مستقلة", () => {
    // cmd:/language (موطنُهُ البوتُ) يمرُّ legacy — أزرارُ لوحةِ /help تعملُ كما صُمِّمَت
    const decision = decideSurfaceFor("driver", `${CMD_PREFIX}:/language`);
    expect(decision).toEqual({ kind: "legacy" });
  });
});

/** قرارُ السطحِ لبادئةِ زرٍّ — بثابتِ المرسلِ: محادثةٌ خاصةٌ (chatId = المرسلِ). */
function decideSurfaceFor(audience: BotAudience, data: string): { kind: string } {
  return decideSurface(audience, {
    kind: "callback",
    updateId: 1,
    data,
    from: { telegramUserId: "1", chatId: "1", languageHint: "ar" },
  });
}
