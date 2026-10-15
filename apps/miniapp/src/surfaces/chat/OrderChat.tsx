/**
 * الغرض: `WR-04` — بطاقةُ «المحادثة» داخلَ رحلةِ الراكبِ ومَهمّةِ السائق: زرٌّ
 *   بعددِ غيرِ المقروء، وسجلٌّ يُسترجَعُ من الخادم، وحقلُ إرسالٍ يُعيدُ المحاولةَ
 *   بالمعرّفِ نفسِه فلا تتكرّرُ الرسالة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 * يُستخدم من: `rider/active/ActiveRideScreen.tsx` و`driver/job/JobScreen.tsx`.
 *
 * النصوصُ تُمرَّرُ مُترجَمةً من الشاشةِ الحاضنة (`labels`) — فمفاتيحُ الراكبِ في
 * جزءِ `rider-ride` ومفاتيحُ السائقِ في جزءِ `driver`، ولا يُحمِّلُ أحدُهما جزءَ الآخر.
 */

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { openExternalLink } from "../../tg/index.ts";
import { type DeviceFixResult, readFreshDeviceFix } from "../rider/destination/device-fix.ts";
import {
  applyThread,
  type ChatApi,
  type ChatFailure,
  type ChatLocation,
  type ChatMessage,
  type ChatSnapshot,
  chatFailureOf,
  fromWireMessage,
  mergeMessages,
  newClientMessageId,
  type PendingMessage,
  productionChatApi,
  settlePending,
} from "./order-chat-client.ts";
import { type ChatSocketFactory, productionChatSocket } from "./order-chat-socket.ts";

export interface OrderChatLabels {
  readonly title: string;
  readonly open: string;
  readonly hide: string;
  readonly unread: string;
  readonly placeholder: string;
  readonly send: string;
  readonly sending: string;
  readonly failed: string;
  readonly retry: string;
  readonly closed: string;
  readonly empty: string;
  readonly loadFailed: string;
  readonly unavailable: string;
  readonly seen: string;
  readonly counterpart: string;
  readonly status: string;
  readonly refresh: string;
  /** `WR-05` — «{amount}» يُستبدَلُ بالمبلغ. */
  readonly offerFixed: string;
  readonly offerSuggested: string;
  readonly offerOpen: string;
  /** `WR-04` — مشاركةُ نقطةِ الموقعِ داخلَ المحادثة. */
  readonly shareLocation: string;
  readonly locating: string;
  readonly locationPreview: string;
  readonly sendLocation: string;
  readonly cancel: string;
  readonly locationFailed: string;
  readonly locationMessage: string;
  readonly openInMaps: string;
  /** «{value}» يُستبدَلُ بدقّةِ القراءةِ بالمتر. */
  readonly accuracy: string;
  /** `WR-04` — الترجمة: النصُّ الأصليُّ يبقى متاحًا بنقرة. */
  readonly translated: string;
  readonly showOriginal: string;
  readonly showTranslation: string;
  /** `WR-04` (ADR 0277) — الإفصاحُ: الرسائلُ النصّيّةُ تُترجَمُ آليًّا عبرَ خدمةٍ خارجيّة. */
  readonly translationNotice: string;
}

type LocationDraft =
  | { readonly state: "idle" }
  | { readonly state: "locating" }
  | { readonly state: "preview"; readonly location: ChatLocation }
  | { readonly state: "failed" };

/** `WR-05` — سطرُ السعرِ بمعناه، أو `null` لطلبٍ أقدمَ من السياسة. */
export function chatOfferLine(
  labels: Pick<OrderChatLabels, "offerFixed" | "offerSuggested" | "offerOpen">,
  offerMode: "fixed" | "suggested" | "open" | null,
  offerSar: number | null,
): string | null {
  if (offerMode === "open") return labels.offerOpen;
  if (offerSar === null) return null;
  if (offerMode === "fixed") return labels.offerFixed.replace("{amount}", String(offerSar));
  if (offerMode === "suggested") {
    return labels.offerSuggested.replace("{amount}", String(offerSar));
  }
  return null;
}

export interface OrderChatProps {
  readonly orderId: string;
  readonly labels: OrderChatLabels;
  /** حالةُ الطلبِ مُترجَمةً من الشاشةِ الحاضنة — تظهرُ في رأسِ الغرفة. */
  readonly statusText: string;
  readonly api?: ChatApi;
  readonly socket?: ChatSocketFactory | null;
  /** يُفتَحُ مبسوطاً — للاختبارِ والروابطِ التي تقصدُ المحادثةَ مباشرةً. */
  readonly initiallyOpen?: boolean;
  /** قراءةُ الموقعِ عندَ ضغطِ «شارك موقعي» وحدَه — لا قبلَه ولا في الخلفيّة. */
  readonly readFix?: () => Promise<DeviceFixResult>;
  readonly openLink?: (url: string) => unknown;
}

const MESSAGE_MAX = 1000;

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function OrderChat({
  orderId,
  labels,
  statusText,
  api = productionChatApi,
  socket = productionChatSocket,
  initiallyOpen = false,
  readFix = readFreshDeviceFix,
  openLink = openExternalLink,
}: OrderChatProps) {
  const baseId = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [pending, setPending] = useState<readonly PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({ state: "idle" });
  const [originals, setOriginals] = useState<ReadonlySet<string>>(new Set());
  const snapshotRef = useRef<ChatSnapshot | null>(null);
  const inFlight = useRef(false);
  const listRef = useRef<HTMLOListElement | null>(null);

  const again = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    // إشارةٌ وصلت أثناءَ استرجاعٍ جارٍ لا تُهمَل: تُعادُ القراءةُ بعدَه مرّةً واحدة.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const wire = await api.fetchAfter(orderId, snapshotRef.current?.lastSeq ?? 0);
      const next = applyThread(snapshotRef.current, wire);
      snapshotRef.current = next;
      setSnapshot(next);
      setPending((p) => settlePending(p, next.messages));
      setFailure(null);
    } catch (error) {
      setFailure(chatFailureOf(error));
    } finally {
      inFlight.current = false;
    }
    if (again.current) {
      again.current = false;
      await refresh();
    }
  }, [api, orderId]);

  // أوّلُ قراءةٍ، ثمَّ القناةُ إن وُجِدَت.
  useEffect(() => {
    snapshotRef.current = null;
    setSnapshot(null);
    void refresh();
    if (socket === null) return undefined;
    const handle = socket(orderId, {
      onJoined: () => {
        setLive(true);
        void refresh();
      },
      onUpdate: (lastSeq) => {
        if (lastSeq > (snapshotRef.current?.lastSeq ?? 0)) void refresh();
      },
      onLost: () => setLive(false),
    });
    return () => handle.close();
  }, [orderId, refresh, socket]);

  // لا استقصاءَ دوريّاً (`ADR 0035` §4): ما فاتَ يُسترجَعُ عندَ (إعادةِ) الانضمامِ
  // إلى الغرفة، وعندَ عودةِ المستخدمِ إلى التطبيق، وبزرِّ «تحديث».
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // المفتوحةُ تُقرأُ: يتقدّمُ موضعُ القراءةِ إلى آخرِ رسالة.
  const lastSeq = snapshot?.lastSeq ?? 0;
  const myRead = snapshot?.myLastReadSeq ?? 0;
  useEffect(() => {
    if (!open || lastSeq === 0 || lastSeq <= myRead) return;
    api
      .markRead(orderId, lastSeq)
      .then(() => {
        const current = snapshotRef.current;
        if (current === null) return;
        const next = { ...current, myLastReadSeq: lastSeq, unread: 0 };
        snapshotRef.current = next;
        setSnapshot(next);
      })
      .catch(() => undefined);
  }, [api, lastSeq, myRead, open, orderId]);

  // كلُّ سطرٍ جديدٍ (مؤكَّدٍ أو مُعلَّقٍ) يُنزِلُ السجلَّ إلى آخرِه.
  const rowCount = (snapshot?.messages.length ?? 0) + pending.length;
  useEffect(() => {
    const list = listRef.current;
    if (!open || rowCount === 0 || list === null) return;
    if (typeof list.scrollTo === "function") list.scrollTo({ top: list.scrollHeight });
  }, [open, rowCount]);

  const deliver = useCallback(
    async (item: PendingMessage) => {
      setPending((p) =>
        p.map((x) =>
          x.clientMessageId === item.clientMessageId ? { ...x, state: "sending" as const } : x,
        ),
      );
      try {
        const result = await api.send(
          orderId,
          item.clientMessageId,
          item.kind === "location" && item.location !== undefined
            ? { kind: "location", location: item.location }
            : { kind: "text", text: item.body },
        );
        const confirmed = fromWireMessage(result.message);
        const current = snapshotRef.current;
        if (current !== null) {
          const next = {
            ...current,
            messages: mergeMessages(current.messages, [confirmed]),
            lastSeq: Math.max(current.lastSeq, confirmed.seq),
            myLastReadSeq: Math.max(current.myLastReadSeq, confirmed.seq),
          };
          snapshotRef.current = next;
          setSnapshot(next);
        }
        setPending((p) => p.filter((x) => x.clientMessageId !== item.clientMessageId));
      } catch (error) {
        const kind = chatFailureOf(error);
        if (kind === "closed") {
          setPending((p) => p.filter((x) => x.clientMessageId !== item.clientMessageId));
          // النصُّ لا يضيعُ بصمت: يعودُ إلى الحقلِ إن كانَ فارغًا، والغرفةُ تُعرَضُ مغلقة.
          if ((item.kind ?? "text") === "text") setDraft((d) => (d.length === 0 ? item.body : d));
          void refresh();
          return;
        }
        setPending((p) =>
          p.map((x) =>
            x.clientMessageId === item.clientMessageId ? { ...x, state: "failed" as const } : x,
          ),
        );
      }
    },
    [api, orderId, refresh],
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || text.length > MESSAGE_MAX) return;
    const item: PendingMessage = {
      clientMessageId: newClientMessageId(),
      body: text,
      state: "sending",
    };
    setPending((p) => [...p, item]);
    setDraft("");
    void deliver(item);
  };

  const startLocation = async () => {
    setLocationDraft({ state: "locating" });
    try {
      const fix = await readFix();
      if (!fix.ok) {
        setLocationDraft({ state: "failed" });
        return;
      }
      setLocationDraft({
        state: "preview",
        location: { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM ?? null, label: null },
      });
    } catch {
      setLocationDraft({ state: "failed" });
    }
  };

  const sendLocation = (location: ChatLocation) => {
    const item: PendingMessage = {
      clientMessageId: newClientMessageId(),
      body: `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`,
      state: "sending",
      kind: "location",
      location,
    };
    setPending((p) => [...p, item]);
    setLocationDraft({ state: "idle" });
    void deliver(item);
  };

  const toggleOriginal = (id: string) =>
    setOriginals((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const locationCard = (location: ChatLocation) => (
    <span className="ocht__loc">
      <span className="ocht__loc-title">{location.label ?? labels.locationMessage}</span>
      <span className="ocht__loc-coords" dir="ltr">
        {`${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
      </span>
      {location.accuracyM !== null ? (
        <span className="ocht__loc-acc">
          {labels.accuracy.replace("{value}", String(Math.round(location.accuracyM)))}
        </span>
      ) : null}
      {typeof location.mapsUrl === "string" ? (
        <button
          type="button"
          className="ocht__loc-open"
          onClick={() => {
            const url = location.mapsUrl;
            if (typeof url === "string") void openLink(url);
          }}
        >
          {labels.openInMaps}
        </button>
      ) : null}
    </span>
  );

  const messageBody = (m: ChatMessage) => {
    if (m.kind === "location" && m.location !== null) return locationCard(m.location);
    if (m.translation === null) {
      return (
        <span className="ocht__body" dir="auto">
          {m.body}
        </span>
      );
    }
    const showingOriginal = originals.has(m.id);
    return (
      <>
        <span className="ocht__body" dir="auto">
          {showingOriginal ? m.body : m.translation.text}
        </span>
        <span className="ocht__tr">
          {showingOriginal ? null : <span>{labels.translated} · </span>}
          <button type="button" className="ocht__tr-toggle" onClick={() => toggleOriginal(m.id)}>
            {showingOriginal ? labels.showTranslation : labels.showOriginal}
          </button>
        </span>
      </>
    );
  };

  // لا غرفةَ لهذا الطلب (لم يُسنَدْ بعدُ أو انقضت النافذة): لا بطاقةَ ألبتّة.
  if (failure === "not_found" && snapshot === null) return null;

  const unread = snapshot?.unread ?? 0;
  const panelId = `${baseId}-panel`;

  return (
    <section className="ocht" aria-labelledby={`${baseId}-title`}>
      <button
        type="button"
        className="ocht__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span id={`${baseId}-title`} className="ocht__title">
          {labels.title}
        </span>
        {unread > 0 && !open ? (
          <span className="ocht__badge">
            <span className="ocht__sr">{labels.unread}: </span>
            {String(unread)}
          </span>
        ) : null}
        <span className="ocht__toggle-hint">{open ? labels.hide : labels.open}</span>
      </button>

      {open ? (
        <div id={panelId} className="ocht__panel">
          <p className="ocht__meta">
            <span>
              {labels.counterpart}: {snapshot?.counterpartFirstName ?? "—"}
            </span>
            <span className="ocht__status">
              {labels.status}: {statusText}
            </span>
          </p>
          {snapshot !== null &&
          chatOfferLine(labels, snapshot.offerMode, snapshot.offerSar) !== null ? (
            <p className="ocht__offer">
              {chatOfferLine(labels, snapshot.offerMode, snapshot.offerSar)}
            </p>
          ) : null}
          {snapshot?.translationActive === true ? (
            <p className="ocht__offer ocht__privacy">{labels.translationNotice}</p>
          ) : null}

          {failure === "session" ? (
            <p className="ocht__notice" role="alert">
              {labels.unavailable}
            </p>
          ) : null}
          {failure === "network" || failure === "rejected" ? (
            <p className="ocht__notice" role="alert">
              {labels.loadFailed}{" "}
              <button type="button" className="ocht__retry" onClick={() => void refresh()}>
                {labels.retry}
              </button>
            </p>
          ) : null}

          {live ? null : (
            <button type="button" className="ocht__refresh" onClick={() => void refresh()}>
              {labels.refresh}
            </button>
          )}

          <ol ref={listRef} className="ocht__list" aria-live="polite">
            {snapshot !== null && snapshot.messages.length === 0 && pending.length === 0 ? (
              <li className="ocht__empty">{labels.empty}</li>
            ) : null}
            {(snapshot?.messages ?? []).map((m) => (
              <li
                key={m.id}
                className={m.mine ? "ocht__msg ocht__msg--mine" : "ocht__msg ocht__msg--theirs"}
              >
                {messageBody(m)}
                <span className="ocht__time">
                  {timeOf(m.createdAt)}
                  {m.mine && snapshot !== null && m.seq <= snapshot.counterpartLastReadSeq
                    ? ` · ${labels.seen}`
                    : ""}
                </span>
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.clientMessageId} className="ocht__msg ocht__msg--mine ocht__msg--pending">
                {p.kind === "location" && p.location !== undefined ? (
                  locationCard(p.location)
                ) : (
                  <span className="ocht__body" dir="auto">
                    {p.body}
                  </span>
                )}
                <span className="ocht__time">
                  {p.state === "sending" ? labels.sending : labels.failed}
                  {p.state === "failed" ? (
                    <button type="button" className="ocht__retry" onClick={() => void deliver(p)}>
                      {labels.retry}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          {snapshot?.writable && locationDraft.state !== "idle" ? (
            <div className="ocht__locdraft" role="status">
              {locationDraft.state === "locating" ? <p>{labels.locating}</p> : null}
              {locationDraft.state === "failed" ? (
                <p>
                  {labels.locationFailed}{" "}
                  <button
                    type="button"
                    className="ocht__retry"
                    onClick={() => void startLocation()}
                  >
                    {labels.retry}
                  </button>
                </p>
              ) : null}
              {locationDraft.state === "preview" ? (
                <>
                  <p className="ocht__locdraft-title">{labels.locationPreview}</p>
                  {locationCard(locationDraft.location)}
                  <button
                    type="button"
                    className="ocht__send"
                    onClick={() => sendLocation(locationDraft.location)}
                  >
                    {labels.sendLocation}
                  </button>
                </>
              ) : null}
              {locationDraft.state !== "locating" ? (
                <button
                  type="button"
                  className="ocht__retry"
                  onClick={() => setLocationDraft({ state: "idle" })}
                >
                  {labels.cancel}
                </button>
              ) : null}
            </div>
          ) : null}

          {snapshot !== null && !snapshot.writable ? (
            <p className="ocht__notice">{labels.closed}</p>
          ) : (
            <form className="ocht__form" onSubmit={onSubmit}>
              <button
                type="button"
                className="ocht__attach"
                aria-label={labels.shareLocation}
                title={labels.shareLocation}
                disabled={snapshot === null || locationDraft.state === "locating"}
                onClick={() => void startLocation()}
              >
                {labels.shareLocation}
              </button>
              <textarea
                className="ocht__input"
                value={draft}
                maxLength={MESSAGE_MAX}
                rows={2}
                aria-label={labels.placeholder}
                placeholder={labels.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                disabled={snapshot === null}
              />
              <button
                type="submit"
                className="ocht__send"
                disabled={snapshot === null || draft.trim().length === 0}
              >
                {labels.send}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
