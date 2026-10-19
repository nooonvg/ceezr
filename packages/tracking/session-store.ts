/**
 * الغرض: منفذ حفظ وقائع جلسة التتبّع — المرحلة ٦.
 *   المنفذ هنا، وتنفيذه على PostgreSQL في infrastructure/tracking، ومزدوجه في الذاكرة أدناه.
 * الحالة: منفّذ فعلياً — يستهلكه packages/application/tracking/live-tracking.ts.
 * ينتمي إلى: packages/tracking
 * يُتوقع أن يستخدمه لاحقاً: مسار GPS عبر HTTP إن رُكِّب (apps/gateway/src/routes/tracking.ts)
 *
 * ## لماذا منفذ لا استعلام مباشر
 *
 * لأن للجلسة قارئين مختلفَي الطبيعة: المسار الحيّ (بوت السائق) يقرأ جلسةً واحدة
 * بمعرّف سائق مئات المرّات في الدقيقة، والعمليات تقرأ كل الجلسات المفتوحة مرّةً
 * كل بضع ثوانٍ. ودمجهما في نموذج قراءة واحد يُنتج استعلاماً سيّئاً للاثنين.
 *
 * ## ولماذا التوابع تُعيد الوقائع لا `void`
 *
 * لأن الكاتب في القاعدة هو من يحسم السباق (فهرس فريد جزئي على السائق الواحد)،
 * فالوقائع بعد الكتابة قد تخالف ما أُرسل: رسالتا موقعٍ متزامنتان تحاولان فتح
 * جلستين، والفائزة واحدة. ومن يفترض أن ما أرسله هو ما استقرّ يبني على وهم.
 *
 * ## `BUG-009` — لماذا صار المُعاد سجلّاً لا وقائعَ مجرّدةً
 *
 * `ADR 0053` يوجب أن يحمل كلُّ حدثٍ `sessionId` و`sequence`، وأن يُولَّد الرقمُ
 * **داخلَ نفسِ الكتابةِ** التي تُثبِّت التقدُّمَ (§٣-أ/٦ و٨). فالكاتبُ وحدَه يعرف الرقمَ،
 * ولا سبيلَ لناديه أن يستنتجَه — ومن ثمَّ يُعيده المنفذُ صراحةً.
 *
 * **ولم يُضَف الرقمُ إلى `TrackingSessionFacts`** عن قصدٍ: تلك بنيةُ مجالٍ يُنشئها
 * `startSession` في الذاكرةِ، فحملُها رقماً كان سيُوجب على المجالِ أن يخترعَ قيمةً —
 * أي عدّاداً في الذاكرةِ من حيثُ مُنِع (§٣-أ/٤). والفصلُ يجعل «المجالُ لا يُولِّد
 * الرقمَ» **خاصيّةَ أنواعٍ** لا وعداً في تعليقٍ.
 */

import type { SessionEndReason, TrackingSessionFacts } from "../domain/tracking/session.ts";

/**
 * وقائعُ جلسةٍ وقد اقترن بها ما لا يعرفه إلَّا صاحبُ الصفِّ: معرِّفُها ورقمُها.
 *
 * `sequence` = آخرُ رقمٍ أصدرَته هذه الجلسةُ. وفي التوابعِ التي تُصدِر رقماً (`open`
 * و`close` و`closeByTrip` و`advance` عندَ القبولِ) هو **الرقمُ الجديدُ** الذي يحمله
 * الحدثُ المُصاحبُ. وفي القراءةِ المجرّدةِ (`openSessionOf`) هو آخرُ ما أُصدِر.
 */
export interface TrackingSessionRecord {
  /** `tracking_sessions.id` — معرِّفُ القناةِ التي يُقاس عليها الترتيبُ. */
  readonly sessionId: string;
  readonly facts: TrackingSessionFacts;
  readonly sequence: number;
}

/**
 * حكمُ القاعدةِ على إصلاحةٍ — ثلاثةُ أحوالٍ لا رابعَ لها.
 *
 * والشكلُ مقصودٌ: `sequence` **لا يوجد** إلَّا في `accepted`. فالنادي الذي يحاول
 * نشرَ حدثٍ عن إصلاحةٍ مرفوضةٍ لا يجد رقماً يضعه في الحدثِ، فيقف عندَ المُترجِمِ لا
 * عندَ مراجعةِ شيفرةٍ. وهذا هو إنفاذُ `ADR 0053` §٣-أ/٧ («لا يُنشَر حدثٌ إذا لم
 * تقبل الكتابةُ») بالأنواعِ لا بالانضباطِ.
 */
export type SessionAdvanceOutcome =
  /** قُبِلت الكتابةُ وأُصدِر رقمٌ جديدٌ — وهذا وحدَه ما يُجيز النشرَ. */
  | { readonly kind: "accepted"; readonly record: TrackingSessionRecord }
  /**
   * الإصلاحةُ أقدمُ قِدَماً صارماً من آخرِ ما قُبِل، فلم تُكتَب ولم يُستهلَك رقمٌ.
   * الحالةُ المعروضةُ لا تتغيّر (`ADR 0053` §٣-أ/١١).
   */
  | { readonly kind: "stale"; readonly record: TrackingSessionRecord }
  /** لا جلسةَ مفتوحةً لهذا السائقِ أصلاً — لا حكمَ ولا رقمَ. */
  | { readonly kind: "no_session" };

/**
 * منفذ الجلسات. **يرمي عند عطل** ولا يعيد `Result`: مستهلكه الوحيد اليوم
 * (`live-tracking.ts`) يلفّ كل نداء بحاجزٍ واحد لأنّ سياسته واحدة لكل الأعطال —
 * النقل اللحظي عونٌ لا شرطٌ، وعطله لا يُبطل حفظ الموقع القانوني. فإعادة
 * `Result` هنا كانت ستُنتج تفريعاً في كل سطر ينتهي إلى نفس السطر.
 *
 * و`SessionAdvanceOutcome` في `advance` ليس نقضاً لذلك: هو ليس تمثيلاً لعطلٍ بل
 * **حكمُ مجالٍ** — قبولٌ أو رفضٌ — وهو المعلومةُ التي بُنِي عليها `BUG-009`.
 */
export interface TrackingSessionStore {
  /** الجلسة المفتوحة للسائق (ended_at is null)، أو `null`. */
  openSessionOf(driverId: string): Promise<TrackingSessionRecord | null>;

  /**
   * يفتح جلسة. إن كانت للسائق جلسةٌ مفتوحة أصلاً تُعاد كما هي **ولا تُفتح ثانية**:
   * الفتح فعلٌ متسامح مع التكرار لأن مصدره رسالة موقعٍ قد تتكرّر.
   *
   * والرقمُ المُعاد عندَ فتحٍ حقيقيٍّ هو **أوّلُ أرقامِ القناةِ** (`ADR 0053` §٤-أ)،
   * وهو ما يحمله حدثُ `session_started`.
   */
  open(
    driverId: string,
    tripId: string | null,
    startedAtMs: number,
  ): Promise<TrackingSessionRecord>;

  /**
   * يربط الجلسة المفتوحة برحلة (أو يفصلها بـ`null`).
   *
   * **ولا يستهلك رقماً**: لا حدثَ يُنشَر عن الربطِ، ورقمٌ يُستهلَك بلا حدثٍ فجوةٌ
   * مصطنعةٌ تُرسل كلَّ مستهلكٍ إلى لقطةٍ بلا سببٍ (`ADR 0053` §٣-ب).
   */
  attachTrip(driverId: string, tripId: string | null): Promise<TrackingSessionRecord | null>;

  /**
   * يعرض إصلاحةً على القاعدةِ فتحكم عليها وتُصدِر رقماً إن قبِلتها.
   *
   * القبولُ والرفضُ والزيادةُ كلُّها في **جملةٍ واحدةٍ**: لا قراءةَ ثمَّ كتابةٌ، ولا
   * `Math.max` في التطبيقِ. والرفضُ للأقدمِ قِدَماً صارماً (`<`) وحدَه — والمتساوي
   * في الطابعِ يُقبَل ويأخذ رقمَه (`ADR 0053` §٤-ج).
   */
  advance(driverId: string, lastFixAtMs: number): Promise<SessionAdvanceOutcome>;

  /** يُغلق جلسة السائق المفتوحة. `null` = لم تكن له جلسة مفتوحة. */
  close(
    driverId: string,
    reason: SessionEndReason,
    endedAtMs: number,
  ): Promise<TrackingSessionRecord | null>;

  /**
   * يُغلق كل الجلسات المفتوحة المرتبطة برحلة. مفتاحه الرحلة لا السائق لأن مُنهي
   * الرحلة (زرّ «أنهيت») يعرف الطلب ولا يعرف معرّف السائق الداخلي.
   */
  closeByTrip(
    tripId: string,
    reason: SessionEndReason,
    endedAtMs: number,
  ): Promise<readonly TrackingSessionRecord[]>;
}

/**
 * مزدوج في الذاكرة — للاختبارات الوحدوية وحدها.
 *
 * صريحٌ في اسمه أنه ذاكرة: كل ما جرى في المرحلة ٤ من لبس كان لأن تنفيذاً في
 * الذاكرة حمل اسماً محايداً، فبدا مرشّحاً للإنتاج.
 *
 * ## تنبيهٌ لازمٌ بعدَ `BUG-009`
 *
 * هذا المزدوجُ **يُقلِّد** حكمَ القاعدةِ ولا يُثبِته: عدّادُه متغيّرٌ في العمليةِ، وهو
 * بعينِه ما مَنَعه `ADR 0053` §٣-أ/٤ في مسارِ الإنتاجِ. فلا يجوز أن يُقرأ منه دليلٌ
 * على الذرّيّةِ ولا على الديمومةِ — وقد اشترط `ADR 0053` §٨ الحالتَينِ ١ و٧ على
 * PostgreSQL حقيقيٍّ لهذا السببِ بعينِه. وحضورُه هنا لتبقى اختباراتُ السلوكِ
 * الوحدويّةُ سريعةً بلا قاعدةٍ، لا ليكونَ بديلاً عنها.
 */
export function createMemoryTrackingSessionStore(): TrackingSessionStore {
  interface Entry {
    readonly sessionId: string;
    readonly facts: TrackingSessionFacts;
    sequence: number;
  }
  const open = new Map<string, Entry>();

  const snapshot = (entry: Entry): TrackingSessionRecord => ({
    sessionId: entry.sessionId,
    facts: entry.facts,
    sequence: entry.sequence,
  });

  const put = (entry: Entry): Entry => {
    open.set(entry.facts.driverId, entry);
    return entry;
  };

  return {
    openSessionOf: async (driverId) => {
      const entry = open.get(driverId);
      return entry === undefined ? null : snapshot(entry);
    },

    open: async (driverId, tripId, startedAtMs) => {
      const existing = open.get(driverId);
      if (existing !== undefined) return snapshot(existing);
      return snapshot(
        put({
          sessionId: crypto.randomUUID(),
          sequence: 1,
          facts: {
            driverId,
            tripId,
            startedAtMs,
            lastFixAtMs: null,
            endedAtMs: null,
            endReason: null,
          },
        }),
      );
    },

    attachTrip: async (driverId, tripId) => {
      const existing = open.get(driverId);
      if (existing === undefined) return null;
      return snapshot(put({ ...existing, facts: { ...existing.facts, tripId } }));
    },

    advance: async (driverId, lastFixAtMs) => {
      const existing = open.get(driverId);
      if (existing === undefined) return { kind: "no_session" };

      const previous = existing.facts.lastFixAtMs;
      // القِدَمُ الصارمُ وحدَه يُرَدُّ — والمساواةُ ليست قِدَماً (`ADR 0053` §٤-ج).
      if (previous !== null && lastFixAtMs < previous) {
        return { kind: "stale", record: snapshot(existing) };
      }

      const advanced = put({
        ...existing,
        sequence: existing.sequence + 1,
        facts: { ...existing.facts, lastFixAtMs },
      });
      return { kind: "accepted", record: snapshot(advanced) };
    },

    close: async (driverId, reason, endedAtMs) => {
      const existing = open.get(driverId);
      if (existing === undefined) return null;
      open.delete(driverId);
      return {
        sessionId: existing.sessionId,
        sequence: existing.sequence + 1,
        facts: { ...existing.facts, endedAtMs, endReason: reason },
      };
    },

    closeByTrip: async (tripId, reason, endedAtMs) => {
      const closed: TrackingSessionRecord[] = [];
      for (const [driverId, entry] of [...open.entries()]) {
        if (entry.facts.tripId !== tripId) continue;
        open.delete(driverId);
        closed.push({
          sessionId: entry.sessionId,
          sequence: entry.sequence + 1,
          facts: { ...entry.facts, endedAtMs, endReason: reason },
        });
      }
      return closed;
    },
  };
}
