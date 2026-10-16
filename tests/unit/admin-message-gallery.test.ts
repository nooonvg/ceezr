/**
 * الغرض: `ADM-MSG-01` — معرضُ الرسائلِ: أنَّ العيّناتِ تُولَّدُ من الناشراتِ الحقيقيّةِ لكلِّ جمهورٍ،
 *   وأنَّ بطاقاتِ القروباتِ بلا زرِّ «وَصْلة» والرسائلَ الخاصّةَ الملفوفةَ به، وأنَّ القاموسَ كاملٌ،
 *   وأنَّ «أرسلها لي» لا يُرسِلُ إلّا إلى محادثةِ المسؤولِ الداخلِ وبالبوتِ الصحيحِ وبعدَ CSRF.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على معرض الرسائل أو ناشرات تيليجرام
 */

import { describe, expect, it } from "bun:test";
import { renderMessagesPage } from "../../apps/admin-dashboard/src/index.ts";
import type { AdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import {
  ADMIN_SESSION_COOKIE,
  csrfTokenFor,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import {
  buildMessageCatalog,
  buildMessageGallery,
  catalogAudienceOf,
  GALLERY_AUDIENCES,
} from "../../apps/gateway/src/admin/message-gallery.ts";
import {
  createAdminUiRoutes,
  type MessagePreviewPort,
} from "../../apps/gateway/src/routes/admin-ui.ts";
import ar from "../../packages/shared/i18n/ar.json" with { type: "json" };
import { ok } from "../../packages/shared/result/index.ts";

const MINIAPP = "https://miniapp.example";
const ADMIN_CHAT = "9001";

function hasWebApp(markup: unknown): boolean {
  return JSON.stringify(markup ?? null).includes('"web_app"');
}

describe("معرض الرسائل — العيّنات", () => {
  it("لكلّ جمهورٍ عيّنةٌ واحدةٌ على الأقلّ، والمعرّفات فريدة", async () => {
    const specimens = await buildMessageGallery({ miniAppUrl: MINIAPP });
    for (const audience of GALLERY_AUDIENCES) {
      expect(specimens.some((s) => s.audience === audience.id)).toBe(true);
    }
    expect(new Set(specimens.map((s) => s.id)).size).toBe(specimens.length);
    for (const s of specimens) expect(s.text.trim().length).toBeGreaterThan(0);
  });

  it("بطاقاتُ القروبات بلا زرّ تطبيقٍ، وبطاقتا القروب بزرّ «قبول» حقيقيّ", async () => {
    const specimens = await buildMessageGallery({ miniAppUrl: MINIAPP });
    const groups = specimens.filter((s) => s.audience.endsWith("_group"));
    for (const s of groups) expect(hasWebApp(s.markup)).toBe(false);
    const card = specimens.find((s) => s.id === "group-unsub-delivery");
    expect(JSON.stringify(card?.markup)).toContain("unsub:claim:");
  });

  it("الرسائلُ الخاصّة الملفوفة تحمل زرّ الدخول كما في الإنتاج", async () => {
    const specimens = await buildMessageGallery({ miniAppUrl: MINIAPP });
    const cancelled = specimens.find((s) => s.id === "driver-cancelled-assigned");
    expect(JSON.stringify(cancelled?.markup)).toContain("📱 وَصْلة");
    const offer = specimens.find((s) => s.id === "driver-offer-delivery");
    // `ADR 0286` — بطاقةُ العرضِ إشعارٌ وزرُّ تطبيقٍ: القبولُ في التطبيقِ لا زرَّ
    // رجوعٍ في المحادثةِ، فالعيّنةُ تحملُ زرَّ `web_app` إلى العرضِ بذاتِهِ.
    expect(JSON.stringify(offer?.markup)).toContain("web_app");
    expect(JSON.stringify(offer?.markup)).toContain("open=offer_");
  });

  it("بلا رابط التطبيق لا زرَّ تطبيقٍ في أيّ عيّنة", async () => {
    const specimens = await buildMessageGallery({ miniAppUrl: null });
    for (const s of specimens) expect(hasWebApp(s.markup)).toBe(false);
  });
});

describe("معرض الرسائل — القاموس", () => {
  it("كلُّ مفاتيح ar.json حاضرة مرّةً واحدة", () => {
    const dictionary = ar as Record<string, string>;
    const groups = buildMessageCatalog(dictionary);
    const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
    expect(total).toBe(Object.keys(dictionary).length);
  });

  it("التصنيف بالبادئة", () => {
    expect(catalogAudienceOf("group.unsub_card")).toBe("drivers_group");
    expect(catalogAudienceOf("support.card")).toBe("support_group");
    expect(catalogAudienceOf("safety.group_card")).toBe("escalation_group");
    expect(catalogAudienceOf("rider.welcome")).toBe("rider");
    expect(catalogAudienceOf("common.cancelled")).toBe("shared");
  });
});

describe("معرض الرسائل — الصفحة", () => {
  it("تُهرِّب النصّ وتعرض زرّ الإرسال برمز CSRF", () => {
    const html = renderMessagesPage({
      audiences: [{ id: "rider", label: "طالب الخدمة" }],
      specimens: [
        {
          id: "x",
          audience: "rider",
          bot: "rider",
          title: "عنوان",
          when: "متى",
          source: "src.ts",
          text: "<script>",
          markup: { inline_keyboard: [[{ text: "زر", callback_data: "a:b" }]] },
        },
      ],
      catalog: [{ label: "طالب الخدمة", entries: [{ key: "k", text: "نص" }] }],
      csrfToken: "tok",
      canSend: true,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain('action="/admin/messages/x/send"');
    expect(html).toContain('value="tok"');
    expect(html).toContain("tg-btn");
  });
});

// ---------------------------------------------------------------------------
// المسار
// ---------------------------------------------------------------------------

const SESSION_TOKEN = "session-token-for-gallery-test";
const SESSION_HASH = sha256Hex(SESSION_TOKEN);

function authDouble(): AdminAuthPort {
  const unused = async (): Promise<never> => {
    throw new Error("لم يكن ينبغي نداؤه");
  };
  return {
    issueCode: unused,
    consumeCode: unused,
    openSession: unused,
    closeSession: async () => ok({ ok: true as const, value: 1 }),
    touchSession: async () =>
      ok({
        ok: true as const,
        value: {
          userId: "62798701-aaa5-494b-a7dd-04bab10c9101",
          cityId: "11111111-1111-1111-1111-111111111111",
          telegramId: ADMIN_CHAT,
          fullName: "مسؤول",
        },
      }),
  } as unknown as AdminAuthPort;
}

interface SentPreview {
  readonly bot: string;
  readonly chatId: string;
  readonly text: string;
  readonly markup: unknown;
}

function harness(withPreview: boolean) {
  const sent: SentPreview[] = [];
  const preview: MessagePreviewPort = {
    miniAppUrl: MINIAPP,
    send: async (bot, chatId, text, markup) => {
      sent.push({ bot, chatId, text, markup });
    },
  };
  const app = createAdminUiRoutes({
    sql: (() => Promise.resolve([])) as never,
    auth: authDouble(),
    codeSender: { send: async () => true },
    ...(withPreview ? { messagePreview: preview } : {}),
  });
  return { app, sent };
}

const cookie = { cookie: `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}` };

async function post(app: ReturnType<typeof harness>["app"], id: string, csrf: string | null) {
  const body = new FormData();
  if (csrf !== null) body.set("csrf", csrf);
  return app.request(`/messages/${id}/send`, { method: "POST", body, headers: cookie });
}

describe("معرض الرسائل — المسار", () => {
  it("الصفحة تُعرض", async () => {
    const { app } = harness(true);
    const response = await app.request("/messages", { headers: cookie });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("معرض الرسائل");
  });

  it("يرسل بطاقة القروب إلى محادثة المسؤول وحدها ببوت السائق وبلا زرّ تطبيق", async () => {
    const { app, sent } = harness(true);
    const response = await post(app, "group-unsub-transport", csrfTokenFor(SESSION_HASH));
    expect(response.status).toBe(303);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(ADMIN_CHAT);
    expect(sent[0]?.bot).toBe("driver");
    expect(hasWebApp(sent[0]?.markup)).toBe(false);
  });

  it("رسالة الراكب تُرسل ببوت الراكب", async () => {
    const { app, sent } = harness(true);
    await post(app, "rider-nodriver-transport", csrfTokenFor(SESSION_HASH));
    expect(sent[0]?.bot).toBe("rider");
  });

  it("بلا CSRF لا إرسال", async () => {
    const { app, sent } = harness(true);
    const response = await post(app, "group-unsub-transport", null);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(sent).toHaveLength(0);
  });

  it("معرّف مجهول ⇐ 422 بلا إرسال", async () => {
    const { app, sent } = harness(true);
    const response = await post(app, "nope", csrfTokenFor(SESSION_HASH));
    expect(response.status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it("بلا منفذ المعاينة ⇐ 503", async () => {
    const { app } = harness(false);
    const response = await post(app, "group-unsub-transport", csrfTokenFor(SESSION_HASH));
    expect(response.status).toBe(503);
  });
});
