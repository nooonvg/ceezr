/**
 * الغرض: إثباتُ UI-3 / PR 5 (R11–R15 + [B] · ADR 0238): الجذورُ الثلاثةُ تبويباتٌ في إطارِ UI-2، والتدفّقاتُ
 *   برجوعٍ واحد، وعيبا الترتيبِ مُصلَحان، ولوحاتُ [B] على عقودِها القائمةِ بحالاتٍ صادقةٍ و503 = «غيرُ متاح».
 * الحالة: منفّذ فعلياً — UI-3 / PR 5.
 *
 * حدٌّ معلَن: لا بيئةَ DOM (لا تبعيّةَ جديدة). يُقاسُ: المصنِّفُ والدالّاتُ النقيّة، والسلسلةُ الحقيقيّةُ
 * `apiFetch` → ردُّ خادمٍ مُقلَّد (`fetch`) → المصنِّف، والرسمُ الساكنُ لكلِّ حالٍ بلغاتِه الثلاث (بذرةُ
 * `initial`)، وعقدُ الربطِ في `RiderRoot` ساكناً. ما لا يُقاسُ: نقرٌ حيٌّ ولا تأثيراتُ React بعدَ التركيب.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  type MiniAppLanguage,
  miniAppDictionary,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { ApiError, ApiNetworkError } from "../../api/client.ts";
import { clearSession, setSession } from "../../identity/session.ts";
import { TicketsScreen } from "../support/TicketsScreen.tsx";
import { RIDER_ACCOUNT_BUILT_FROM_DEBT, RIDER_ACCOUNT_DEBT_KEYS } from "./account/account-view.ts";
import { FaqScreen } from "./faq/FaqScreen.tsx";
import { NotificationsScreen } from "./notifications/NotificationsScreen.tsx";
import { PrivacyScreen } from "./privacy/PrivacyScreen.tsx";
import { initialRiderFlow, riderLandingTab } from "./rider-flow.ts";
import { classifyCapabilityFailure, failureCode } from "./settings/capability.ts";
import { RIDER_SETTINGS_CONSUMERS } from "./settings/consumers.ts";
import { EmergencyContactPanel } from "./settings/EmergencyContactPanel.tsx";
import {
  contactProblems,
  contactSaveErrorKey,
  hasEmergencyContact,
  readEmergencyContact,
  saveEmergencyContact,
} from "./settings/emergency-contact.ts";
import { NotificationPrefsPanel } from "./settings/NotificationPrefsPanel.tsx";
import {
  prefsChanged,
  readNotificationPrefs,
  saveNotificationPrefs,
} from "./settings/notification-prefs.ts";
import { SavedPlacesPanel } from "./settings/SavedPlacesPanel.tsx";
import {
  type ApiSavedPlace,
  labelProblem,
  placeErrorKey,
  placeKindKey,
  replacesExisting,
  savedPlacesApi,
  unsavedRecent,
} from "./settings/saved-places.ts";
import { TicketThread } from "./settings/TicketThread.tsx";
import {
  canSendMessage,
  senderKey,
  threadErrorKey,
  ticketThreadApi,
} from "./settings/ticket-thread.ts";
import { RIDER_SUPPORT_DECLARED_DEBT, SupportScreen } from "./support/SupportScreen.tsx";
import { RIDER_SUPPORT_SPEC, RIDER_SUPPORT_VIEW } from "./support/support-view.ts";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
}
const ROOT = codeOnly(read("./RiderRoot.tsx"));
const ARABIC = /[\u0600-\u06FF]/;
const RAW_KEY = /rider\.(account|notifications|support|frame|privacy)\.[a-zA-Z]/;
const UNAVAILABLE = { kind: "unavailable" } as const;
const SESSION = { kind: "session" } as const;

function t(language: MiniAppLanguage, key: string): string {
  const value = miniAppDictionary(language)[key];
  if (value === undefined) throw new Error(`${key} @ ${language}`);
  return value;
}
/** النصُّ كما يُرسَمُ في HTML. Preact (ADR 0258) لا يُهرِّبُ الفاصلةَ العليا في النصّ، وReact كانَ يُهرِّبُها. */
function html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const never = <T,>() => new Promise<T>(() => {});

// ── المصنِّف ─────────────────────────────────────────────────────────────────

describe("[B] المصنِّف — 503 = غيرُ متاح", () => {
  it("503 أو *_NOT_AVAILABLE أو مسارٌ لم يُركَّب ⇒ unavailable", () => {
    expect(classifyCapabilityFailure(new ApiError(503, "PLACE_STORE_NOT_AVAILABLE", "x"))).toEqual(
      UNAVAILABLE,
    );
    expect(classifyCapabilityFailure(new ApiError(503, "HTTP_ERROR", "x"))).toEqual(UNAVAILABLE);
    expect(
      classifyCapabilityFailure(new ApiError(500, "TICKET_THREAD_STORE_NOT_AVAILABLE", "x")),
    ).toEqual(UNAVAILABLE);
    expect(classifyCapabilityFailure(new ApiError(404, "HTTP_ERROR", "x"))).toEqual(UNAVAILABLE);
  });

  it("404 برمزٍ من التطبيقِ خطأٌ بعينِه لا «غيرُ متاح»، و401 جلسة، والشبكةُ خطأٌ يُعاد", () => {
    expect(classifyCapabilityFailure(new ApiError(404, "PLACE_NOT_FOUND", "x"))).toEqual({
      kind: "error",
      code: "PLACE_NOT_FOUND",
    });
    expect(classifyCapabilityFailure(new ApiError(401, "SESSION_REJECTED", "x"))).toEqual(SESSION);
    expect(classifyCapabilityFailure(new ApiNetworkError())).toEqual({
      kind: "error",
      code: "NETWORK",
    });
    expect(failureCode("boom")).toBe("UNKNOWN");
    expect(classifyCapabilityFailure(new ApiError(403, "TICKET_CLOSED", "x"))).toEqual({
      kind: "error",
      code: "TICKET_CLOSED",
    });
  });
});

// ── السلسلةُ الحقيقيّة: apiFetch → fetch مُقلَّد ──────────────────────────────

describe("[B] العقودُ القائمةُ وحدَها — المسارُ والفعلُ والجسمُ، و503 من الخادم", () => {
  const original = globalThis.fetch;
  const seen: { url: string; method: string; body: unknown }[] = [];
  let reply: { status: number; payload: unknown } = { status: 200, payload: { ok: true } };

  beforeEach(() => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });
    seen.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify(reply.payload), {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
    clearSession();
  });

  it("جهةُ الطوارئ: GET ثمَّ PUT بالاسمِ والرقم — ولا DELETE في العقد", async () => {
    reply = { status: 200, payload: { ok: true, name: null, phone: null } };
    expect(hasEmergencyContact(await readEmergencyContact())).toBe(false);
    reply = { status: 200, payload: { ok: true, status: "saved" } };
    await saveEmergencyContact({ name: "Sara", phone: "966500000000" });
    expect(seen).toEqual([
      { url: "/v1/me/emergency-contact", method: "GET", body: undefined },
      {
        url: "/v1/me/emergency-contact",
        method: "PUT",
        body: { name: "Sara", phone: "966500000000" },
      },
    ]);
    expect(read("./settings/emergency-contact.ts")).not.toContain('"DELETE"');
  });

  it("الأماكن: PATCH بجسمٍ كاملٍ (نوعٌ واسمٌ وإحداثيّتان) وDELETE بالمعرّفِ مُرمَّزاً", async () => {
    reply = { status: 200, payload: { ok: true, status: "updated", place: {} } };
    await savedPlacesApi.update("a/b", { kind: "home", label: "Home", lat: 21.5, lng: 39.2 });
    reply = { status: 200, payload: { ok: true, status: "deleted" } };
    await savedPlacesApi.remove("a/b");
    reply = { status: 200, payload: { ok: true, status: "created", place: {} } };
    await savedPlacesApi.create({ kind: "other", label: "Gym", lat: 1, lng: 2 });
    expect(seen).toEqual([
      {
        url: "/v1/me/places/a%2Fb",
        method: "PATCH",
        body: { kind: "home", label: "Home", lat: 21.5, lng: 39.2 },
      },
      { url: "/v1/me/places/a%2Fb", method: "DELETE", body: undefined },
      {
        url: "/v1/me/places",
        method: "POST",
        body: { kind: "other", label: "Gym", lat: 1, lng: 2 },
      },
    ]);
  });

  it("التفضيلاتُ: الحقلانِ وحدَهما، ورسائلُ التذكرة: POST برسالةٍ واحدة", async () => {
    reply = { status: 200, payload: { ok: true, status: "saved" } };
    await saveNotificationPrefs({ offersEnabled: false, updatesEnabled: true });
    reply = { status: 200, payload: { ok: true, status: "added", message_id: "m1" } };
    await ticketThreadApi.send("t1", "hello");
    expect(seen).toEqual([
      {
        url: "/v1/me/notification-preferences",
        method: "PUT",
        body: { offersEnabled: false, updatesEnabled: true },
      },
      { url: "/v1/support/tickets/t1/messages", method: "POST", body: { message: "hello" } },
    ]);
  });

  it("كلُّ [B] يقولُ 503 من الخادمِ «غيرُ متاح» — لا نجاحٌ ولا خطأٌ عامّ", async () => {
    const cases: [string, () => Promise<unknown>][] = [
      ["EMERGENCY_CONTACT_STORE_NOT_AVAILABLE", readEmergencyContact],
      ["NOTIFICATION_PREFS_STORE_NOT_AVAILABLE", readNotificationPrefs],
      ["PLACE_STORE_NOT_AVAILABLE", savedPlacesApi.list],
      ["TICKET_THREAD_STORE_NOT_AVAILABLE", () => ticketThreadApi.read("t1")],
    ];
    for (const [code, call] of cases) {
      reply = { status: 503, payload: { ok: false, code } };
      const thrown = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(classifyCapabilityFailure(thrown), code).toEqual(UNAVAILABLE);
    }
  });
});

// ── الدالّاتُ النقيّة ─────────────────────────────────────────────────────────

describe("[B] الدالّاتُ النقيّة — مرآةُ قواعدِ الخادمِ لا بديلٌ عنها", () => {
  it("جهةُ الطوارئ: الاسمُ 1..120 والرقمُ 4..20 رقماً", () => {
    expect(contactProblems({ name: "  ", phone: "12" })).toEqual(["nameRequired", "phoneInvalid"]);
    expect(contactProblems({ name: "x".repeat(121), phone: "1234" })).toEqual(["nameTooLong"]);
    expect(contactProblems({ name: "Sara", phone: "+9665" })).toEqual(["phoneInvalid"]);
    expect(contactProblems({ name: "Sara", phone: "966500000000" })).toEqual([]);
    expect(hasEmergencyContact({ ok: true, name: "Sara", phone: null })).toBe(false);
    expect(contactSaveErrorKey("WHATEVER")).toBe("rider.account.emergency.error.generic");
  });

  it("الأماكن: الاستبدالُ لـhome/work وحدَهما، والمحفوظُ لا يُعرَضُ حفظُه، والنوعُ المجهولُ «آخر»", () => {
    const home: ApiSavedPlace = {
      id: "1",
      kind: "home",
      label: "Home",
      lat: 1,
      lng: 2,
      updatedAt: "2026-10-06T00:00:00Z",
    };
    expect(replacesExisting("home", [home])).toBe(true);
    expect(replacesExisting("work", [home])).toBe(false);
    expect(replacesExisting("other", [{ ...home, kind: "other" }])).toBe(false);
    expect(
      unsavedRecent(
        [
          { label: "Home", lat: 1, lng: 2, lastUsedAt: "2026-10-06T00:00:00Z" },
          { label: "Mall", lat: 3, lng: 4, lastUsedAt: "2026-10-06T00:00:00Z" },
        ],
        [home],
      ),
    ).toEqual([{ label: "Mall", lat: 3, lng: 4, lastUsedAt: "2026-10-06T00:00:00Z" }]);
    expect(placeKindKey("gym")).toBe("rider.account.places.kind.other");
    expect(labelProblem(" ")).toBe("required");
    expect(labelProblem("x".repeat(81))).toBe("tooLong");
    expect(placeErrorKey("PLACE_NOT_FOUND")).toBe("rider.account.places.error.notFound");
  });

  it("التفضيلاتُ والرسائل", () => {
    const on = { offersEnabled: true, updatesEnabled: true };
    expect(prefsChanged(on, on)).toBe(false);
    expect(prefsChanged(on, { ...on, offersEnabled: false })).toBe(true);
    expect(canSendMessage("  ", false)).toBe(false);
    expect(canSendMessage("hi", true)).toBe(false);
    expect(canSendMessage("x".repeat(2001), false)).toBe(false);
    expect(canSendMessage("hi", false)).toBe(true);
    expect(senderKey("staff")).toBe("rider.support.thread.sender.unknown");
    expect(threadErrorKey("TICKET_CLOSED")).toBe("rider.support.thread.error.closed");
  });

  it("الدَّينُ المعلَنُ: ما بُنِيَ رُفِع، و«تعديلُ الهويّة» باقٍ (لا عقد)، ورسائلُ التذكرةِ عادَت دَيناً بلا قارئ (TRUTH-01)", () => {
    expect(RIDER_ACCOUNT_DEBT_KEYS).toEqual(["rider.account.debt.editIdentity"]);
    expect(RIDER_ACCOUNT_BUILT_FROM_DEBT).toEqual([
      "rider.account.debt.emergencyContact",
      "rider.account.debt.editPlaces",
    ]);
    expect(RIDER_SUPPORT_DECLARED_DEBT).toEqual([
      "rider.support.debt.attachment",
      "rider.support.debt.thread",
    ]);
  });
});

// ── الرسمُ الساكنُ لكلِّ حال × اللغاتِ الثلاث ────────────────────────────────

describe("[B] اللوحاتُ — كلُّ حالٍ صادقٌ بلغاتِه، ولا فعلَ صوريّ", () => {
  for (const language of MINIAPP_LANGUAGES) {
    const tt = (key: string) => html(t(language, key));

    it(`جهةُ الطوارئ @ ${language}`, () => {
      const r = (initial: Parameters<typeof EmergencyContactPanel>[0]["initial"]) =>
        renderToStaticMarkup(
          <EmergencyContactPanel language={language} read={never} save={never} initial={initial} />,
        );
      const reading = r(undefined);
      expect(reading).toContain('aria-busy="true"');
      expect(reading).not.toContain("<input");

      const unavailable = r({ state: { kind: "failed", failure: UNAVAILABLE } });
      expect(unavailable).toContain(tt("rider.account.emergency.unavailable"));
      expect(unavailable).not.toContain("<input");
      expect(unavailable).not.toContain("<button");

      const failed = r({ state: { kind: "failed", failure: { kind: "error", code: "X" } } });
      expect(failed).toContain('role="alert"');
      expect(failed).toContain(tt("rider.account.emergency.retry"));

      const empty = r({ state: { kind: "ready", contact: { ok: true, name: null, phone: null } } });
      expect(empty).toContain(tt("rider.account.emergency.empty"));
      expect(empty).toContain(tt("rider.account.emergency.add"));
      expect(empty).toContain(tt("rider.account.emergency.note"));

      const saved = r({
        state: { kind: "ready", contact: { ok: true, name: "Sara", phone: "966500000000" } },
        saved: true,
      });
      expect(saved).toContain("Sara");
      expect(saved).toContain('<bdi dir="ltr">966500000000</bdi>');
      expect(saved).toContain(tt("rider.account.emergency.saved"));

      const invalid = r({
        state: { kind: "ready", contact: { ok: true, name: null, phone: null } },
        editing: true,
        name: "",
        phone: "12",
        attempted: true,
        saveFailure: UNAVAILABLE,
      });
      expect(invalid.match(/aria-invalid="true"/g)).toHaveLength(2);
      expect(invalid).toContain(tt("rider.account.emergency.problem.nameRequired"));
      expect(invalid).toContain(tt("rider.account.emergency.problem.phoneInvalid"));
      expect(invalid).toContain(tt("rider.account.emergency.unavailable"));
      expect(invalid).not.toContain(tt("rider.account.emergency.saved"));
      if (language === "en") expect(saved + invalid).not.toMatch(ARABIC);
      expect(saved + invalid + empty).not.toMatch(RAW_KEY);
    });

    it(`الأماكنُ المحفوظة @ ${language}`, () => {
      const home: ApiSavedPlace = {
        id: "p1",
        kind: "home",
        label: "Home A",
        lat: 1,
        lng: 2,
        updatedAt: "2026-10-06T00:00:00Z",
      };
      const r = (initial: Parameters<typeof SavedPlacesPanel>[0]["initial"]) =>
        renderToStaticMarkup(<SavedPlacesPanel language={language} initial={initial} />);

      const unavailable = r({ state: { kind: "failed", failure: UNAVAILABLE } });
      expect(unavailable).toContain(tt("rider.account.places.unavailable"));
      expect(unavailable).not.toContain("<button");

      const listed = r({
        state: {
          kind: "ready",
          loaded: {
            places: [home],
            recent: {
              kind: "listed",
              list: [{ label: "Mall", lat: 3, lng: 4, lastUsedAt: "2026-10-06T00:00:00Z" }],
            },
          },
        },
        notice: "deleted",
      });
      expect(listed).toContain("Home A");
      expect(listed).toContain(tt("rider.account.places.kind.home"));
      expect(listed).toContain(
        html(t(language, "rider.account.places.edit.aria").replace("{label}", "Home A")),
      );
      expect(listed).toContain(
        html(t(language, "rider.account.places.create.aria").replace("{label}", "Mall")),
      );
      expect(listed).toContain(tt("rider.account.places.notice.deleted"));

      const recentDown = r({
        state: { kind: "ready", loaded: { places: [], recent: UNAVAILABLE } },
      });
      expect(recentDown).toContain(tt("rider.account.places.empty"));
      expect(recentDown).toContain(tt("rider.account.places.recent.unavailable"));

      const confirm = r({
        state: { kind: "ready", loaded: { places: [home], recent: { kind: "listed", list: [] } } },
        draft: { mode: "delete", place: home },
      });
      expect(confirm).toContain(
        html(t(language, "rider.account.places.delete.confirm").replace("{label}", "Home A")),
      );
      expect(confirm).toContain(tt("rider.account.places.delete.yes"));

      const create = r({
        state: { kind: "ready", loaded: { places: [home], recent: { kind: "listed", list: [] } } },
        draft: {
          mode: "create",
          from: { label: "Mall", lat: 3, lng: 4, lastUsedAt: "2026-10-06T00:00:00Z" },
        },
        label: "Mall",
        kind: "home",
        failure: { kind: "error", code: "PLACE_NOT_FOUND" },
      });
      expect(create).toContain('role="radiogroup"');
      expect(create).toContain(
        html(
          t(language, "rider.account.places.replaces").replace(
            "{kind}",
            t(language, "rider.account.places.kind.home"),
          ),
        ),
      );
      expect(create).toContain(tt("rider.account.places.error.notFound"));
      if (language === "en") expect(listed + confirm + create).not.toMatch(ARABIC);
      expect(listed + confirm + create).not.toMatch(RAW_KEY);
      expect(listed + confirm + create).not.toContain("{label}");
    });

    it(`تفضيلاتُ الإشعارات @ ${language}`, () => {
      const saved = { offersEnabled: true, updatesEnabled: false };
      const r = (initial: Parameters<typeof NotificationPrefsPanel>[0]["initial"]) =>
        renderToStaticMarkup(<NotificationPrefsPanel language={language} initial={initial} />);
      const unavailable = r({ state: { kind: "failed", failure: UNAVAILABLE } });
      expect(unavailable).toContain(tt("rider.notifications.prefs.unavailable"));
      expect(unavailable).not.toContain('role="radiogroup"');

      const unchanged = r({ state: { kind: "ready", saved }, draft: saved, savedNotice: true });
      expect(unchanged.match(/role="radiogroup"/g)).toHaveLength(2);
      expect(unchanged).toContain(tt("rider.notifications.prefs.operational"));
      expect(unchanged).toMatch(/<button disabled type="submit"/);
      expect(unchanged).toContain(tt("rider.notifications.prefs.saved"));

      const changed = r({
        state: { kind: "ready", saved },
        draft: { ...saved, offersEnabled: false },
        failure: UNAVAILABLE,
      });
      expect(changed).toContain('<button type="submit"');
      expect(changed).not.toContain("disabled");
      expect(changed).not.toContain(tt("rider.notifications.prefs.saved"));
      expect(changed).toContain(tt("rider.notifications.prefs.unavailable"));
      if (language === "en") expect(unchanged + changed).not.toMatch(ARABIC);
    });

    it(`رسائلُ التذكرة @ ${language}`, () => {
      const collapsed = renderToStaticMarkup(<TicketThread ticketId="t1" language={language} />);
      expect(collapsed).toContain('aria-expanded="false"');
      expect(collapsed).not.toContain("aria-controls");
      expect(collapsed).not.toContain("<section");

      const r = (initial: Parameters<typeof TicketThread>[0]["initial"]) =>
        renderToStaticMarkup(
          <TicketThread
            ticketId="t1"
            language={language}
            initiallyOpen
            timeZone="UTC"
            initial={initial}
          />,
        );
      const messages = r({
        state: {
          kind: "ready",
          messages: [
            {
              id: "m1",
              sender_type: "rider",
              message: "Lost bag",
              created_at: "2026-10-06T10:00:00Z",
            },
            { id: "m2", sender_type: "staff", message: "Hi", created_at: "bad" },
          ],
        },
        sent: true,
      });
      expect(messages).toContain('aria-expanded="true"');
      expect(messages).toContain("aria-controls=");
      expect(messages).toContain("Lost bag");
      expect(messages).toContain(tt("rider.support.thread.sender.rider"));
      expect(messages).toContain(tt("rider.support.thread.sender.unknown"));
      expect(messages).toContain(tt("rider.support.thread.note"));
      expect(messages).toContain("<textarea");
      expect(messages).toContain(tt("rider.support.thread.sent"));

      const closed = r({ state: { kind: "ready", messages: [] }, closed: true });
      expect(closed).not.toContain("<textarea");
      expect(closed).toContain(tt("rider.support.thread.error.closed"));
      expect(closed).toContain(tt("rider.support.thread.empty"));

      const unavailable = r({ state: { kind: "failed", failure: UNAVAILABLE } });
      expect(unavailable).toContain(tt("rider.support.thread.unavailable"));
      expect(unavailable).not.toContain("<textarea");

      const missing = r({
        state: { kind: "failed", failure: { kind: "error", code: "TICKET_NOT_FOUND" } },
      });
      expect(missing).toContain(tt("rider.support.thread.error.notFound"));
      expect(missing).not.toContain(tt("rider.support.thread.retry"));
      if (language === "en") expect(messages + closed).not.toMatch(ARABIC);
    });
  }

  it("مفاتيحُ PR 5 نفسُها في القواميسِ الثلاثة", () => {
    const prefixes = [
      "rider.frame.",
      "rider.account.emergency.",
      "rider.account.places.",
      "rider.notifications.prefs.",
      "rider.support.thread.",
    ];
    const keys = (language: MiniAppLanguage) =>
      Object.keys(miniAppDictionary(language))
        .filter((k) => prefixes.some((p) => k.startsWith(p)))
        .sort();
    expect(keys("ar").length).toBeGreaterThan(100);
    expect(keys("en")).toEqual(keys("ar"));
    expect(keys("ur")).toEqual(keys("ar"));
  });
});

// ── شاشاتُ R11–R15 داخلَ الإطار ──────────────────────────────────────────────

describe("R11–R15 — الإطارُ يملكُ العنوانَ والرجوع", () => {
  it("لا H1 مكرَّرٌ ولا رجوعٌ بلا مُستقبِل، والاتّجاهُ من اللغة", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dir = language === "en" ? 'dir="ltr"' : 'dir="rtl"';
      const notifications = renderToStaticMarkup(
        <NotificationsScreen
          initialLanguage={language}
          showTitle={false}
          read={never}
          prefs={{ read: never }}
        />,
      );
      expect(notifications).not.toContain('id="nc-title"');
      expect(notifications).not.toContain("nc__back");
      expect(notifications).toContain(dir);
      const privacy = renderToStaticMarkup(
        <PrivacyScreen language={language} showTitle={false} fetchStatus={never} />,
      );
      expect(privacy).not.toContain('id="rp-title"');
      expect(privacy).not.toContain("rp__back");
      expect(privacy).toContain(dir);
      const faq = renderToStaticMarkup(<FaqScreen language={language} showTitle={false} />);
      expect(faq).not.toContain('id="rf-title"');
      expect(faq).not.toContain("rf__back");
    }
    for (const path of [
      "./history/RideHistoryScreen.tsx",
      "./history/RideDetailScreen.tsx",
      "./notifications/NotificationsScreen.tsx",
    ]) {
      expect(codeOnly(read(path)), path).not.toContain("onBack?.()");
      expect(codeOnly(read(path)), path).toContain("showTitle ?");
    }
  });

  it("فشلُ وسمِ الإشعارِ يُقالُ ولا يُبلَع، والخصوصيّةُ تُعادُ قراءتُها بعدَ خطأ", () => {
    const n = codeOnly(read("./notifications/NotificationsScreen.tsx"));
    expect(n).toContain("setMarkFailed(true)");
    expect(n).toContain('t("rider.notifications.markFailed")');
    const p = codeOnly(read("./privacy/PrivacyScreen.tsx"));
    expect(p).toContain("setAttempt((n) => n + 1)");
    expect(p).toContain("[fetchStatus, attempt]");
  });

  it("قائمةُ دَينٍ فارغةٌ لا ترسمُ عنوانَ «غيرُ متاح» فوقَ لا شيء (والسائقُ لا يتغيّر)", () => {
    const tickets = renderToStaticMarkup(
      <TicketsScreen
        language="ar"
        declaredDebt={[]}
        readTickets={never}
        openTicket={never}
        pageSize={20}
        spec={RIDER_SUPPORT_SPEC}
        view={RIDER_SUPPORT_VIEW}
      />,
    );
    expect(tickets).not.toContain("sup__debt");
    expect(read("../driver/DriverRoot.tsx")).not.toContain("renderTicketExtra");
  });
});

// ── RiderRoot: التبويباتُ والتدفّقاتُ والترتيب ───────────────────────────────

describe("RiderRoot — R11/R13/R15 تبويباتٌ جذريّة، والباقي تدفّقاتٌ برجوعٍ واحد", () => {
  it("تبويبُ الهبوطِ من الرابطِ، والحالةُ الأولى عليه", () => {
    const base = { browsed: false, account: false, support: null };
    expect(riderLandingTab(base)).toBe("home");
    expect(riderLandingTab({ ...base, browsed: true })).toBe("rides");
    expect(riderLandingTab({ ...base, account: true })).toBe("account");
    expect(riderLandingTab({ ...base, support: { orderId: null } })).toBe("support");
    expect(riderLandingTab({ ...base, support: { orderId: "o1" } })).toBe("home");
    expect(initialRiderFlow("account").stack.tab).toBe("account");
    expect(initialRiderFlow().stack.tab).toBe("home");
  });

  it("الترتيب: SOS ثمَّ FAQ ثمَّ الخصوصيّة ثمَّ الشكوى المربوطة … ثمَّ الجذر (عيبا الترتيبِ مُصلَحان)", () => {
    const order = [
      "if (sosOpen)",
      "if (faq)",
      "if (privacy)",
      "if (support !== null)",
      "if (lostFound)",
      "if (inspected !== null)",
      "if (notificationsOpen)",
      "if (summarized !== null)",
      "if (followed !== null)",
      "if (intent !== null)",
      'view.screen === "quote"',
      "switch (stack.tab)",
    ].map((needle) => {
      const at = ROOT.indexOf(needle);
      expect(at, needle).toBeGreaterThan(-1);
      return at;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ROOT).not.toContain("if (account)");
    expect(ROOT).not.toContain("if (browsed)");
  });

  it('كلُّ تدفّقٍ جديدٍ في `ScreenFrame mode="flow"` بعنوانٍ من `core` ورجوعٍ واحد، والشاشةُ بلا عنوانٍ ولا رجوع', () => {
    for (const [title, close] of [
      ['t("rider.frame.faq")', "setFaq(false)"],
      ['t("rider.privacy.title")', "setPrivacy(false)"],
      ['t("rider.frame.supportRide")', "setSupport(null)"],
      ['t("rider.frame.lostFound")', "setLostFound(false)"],
      ['t("rider.frame.rideDetail")', "setInspected(null)"],
      ['t("rider.frame.notifications")', "setNotificationsOpen(false)"],
    ] as const) {
      expect(ROOT).toContain(
        `title={${title}}\n        back={{ label: flowBack, onBack: () => ${close} }}`,
      );
    }
    // R11–R15 لا تتلقّى `onBack` في الموجِّه: الرجوعُ لرأسِ الإطارِ وحدَه.
    for (const screen of [
      "RideHistoryScreen",
      "RideDetailScreen",
      "NotificationsScreen",
      "PrivacyScreen",
      "FaqScreen",
      "SupportScreen",
      "AccountScreen",
    ]) {
      const blocks = ROOT.split(`<${screen}`)
        .slice(1)
        .map((b) => b.slice(0, b.indexOf("/>")));
      expect(blocks.length, screen).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block, screen).not.toContain("onBack=");
        expect(block, screen).toContain("showTitle={false}");
        expect(block, screen).toMatch(/initialLanguage=\{language\}|language=\{language\}/);
      }
    }
  });

  it("الجذرُ واحدٌ بشريطِ التبويبات، وعنوانُه لكلِّ تبويبٍ من `core`", () => {
    expect(ROOT.match(/mode="root"/g)).toHaveLength(1);
    expect(ROOT).toContain("title={t(RIDER_ROOT_TITLE_KEY[stack.tab])} tabs={rootTabs}");
    expect(ROOT).toContain('rides: "rider.tabs.rides"');
    expect(ROOT).toContain("onOpenNotifications={() => setNotificationsOpen(true)}");
    expect(ROOT).toContain("onOpenPrivacy={() => setPrivacy(true)}");
  });
});

// ── TRUTH-01: لا واجهةَ بلا مستهلِك ─────────────────────────────────────────

describe("TRUTH-01 — ما لا يقرؤه أحدٌ لا يُعرَضُ كأنّه يعمل", () => {
  it("لا مستهلِكَ للتفضيلاتِ ولا لرسائلِ التذكرةِ في الخادمِ بعد", () => {
    expect(RIDER_SETTINGS_CONSUMERS).toEqual({ notificationPrefs: false, ticketThread: false });
    // البثُّ بلا تصنيفٍ ولا يقرأُ أعمدةَ التفضيل؛ ولا صفحةَ إدارةٍ تقرأُ `ticket_messages`.
    const migrations = readFileSync(
      new URL(
        "../../../../../supabase/migrations/20260908030000_unified_outbox_broadcast_recipient.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migrations).not.toContain("offers_notifications_enabled");
    expect(migrations).not.toContain("updates_notifications_enabled");
    for (const page of ["disputes.ts", "messages.ts"]) {
      const admin = readFileSync(
        new URL(`../../../../admin-dashboard/src/pages/${page}`, import.meta.url),
        "utf8",
      );
      expect(admin, page).not.toContain("ticket_messages");
    }
  });

  it("شاشةُ الإشعاراتِ تقولُ الحدَّ ولا ترسمُ مفاتيحَ لا تُطفئُ شيئاً — باللغاتِ الثلاث", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const markup = renderToStaticMarkup(
        <NotificationsScreen initialLanguage={language} read={never} prefs={{ read: never }} />,
      );
      expect(markup).not.toContain("rset__form");
      expect(markup).not.toContain('type="checkbox"');
      expect(markup).toContain(html(t(language, "rider.notifications.prefs.pending")));
    }
  });

  it("شاشةُ الدعمِ بلا خانةِ رسائلَ داخلَ التذكرة، والحدُّ معلَن", () => {
    const code = codeOnly(read("./support/SupportScreen.tsx"));
    expect(code).toContain('hasConsumer("ticketThread")');
    for (const language of MINIAPP_LANGUAGES) {
      const markup = renderToStaticMarkup(
        <SupportScreen language={language} readTickets={never} />,
      );
      expect(markup).not.toContain(html(t(language, "rider.support.thread.compose")));
    }
  });
});
