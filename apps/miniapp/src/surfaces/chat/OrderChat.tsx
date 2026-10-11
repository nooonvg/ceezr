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
import {
  applyThread,
  type ChatApi,
  type ChatFailure,
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
}

/** فاصلُ الاستطلاعِ: سريعٌ والغرفةُ مفتوحةٌ بلا قناة، وبطيءٌ احتياطاً معها. */
export const CHAT_POLL_OPEN_MS = 4_000;
export const CHAT_POLL_IDLE_MS = 15_000;
export const CHAT_POLL_LIVE_MS = 30_000;
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
}: OrderChatProps) {
  const baseId = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [pending, setPending] = useState<readonly PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState(false);
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

  // الاستطلاعُ الاحتياطيّ — لا يتوقّفُ ألبتّةَ، يتباطأُ فقط حينَ تعملُ القناة.
  useEffect(() => {
    if (failure === "not_found" || failure === "session") return undefined;
    const every = live ? CHAT_POLL_LIVE_MS : open ? CHAT_POLL_OPEN_MS : CHAT_POLL_IDLE_MS;
    const timer = setInterval(() => void refresh(), every);
    return () => clearInterval(timer);
  }, [failure, live, open, refresh]);

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
        const result = await api.send(orderId, item.clientMessageId, item.body);
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

          <ol ref={listRef} className="ocht__list" aria-live="polite">
            {snapshot !== null && snapshot.messages.length === 0 && pending.length === 0 ? (
              <li className="ocht__empty">{labels.empty}</li>
            ) : null}
            {(snapshot?.messages ?? []).map((m) => (
              <li
                key={m.id}
                className={m.mine ? "ocht__msg ocht__msg--mine" : "ocht__msg ocht__msg--theirs"}
              >
                <span className="ocht__body">{m.body}</span>
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
                <span className="ocht__body">{p.body}</span>
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

          {snapshot !== null && !snapshot.writable ? (
            <p className="ocht__notice">{labels.closed}</p>
          ) : (
            <form className="ocht__form" onSubmit={onSubmit}>
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
