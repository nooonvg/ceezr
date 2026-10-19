/**
 * الغرض: وقائع جلسة التتبّع في PostgreSQL — تنفيذ `TrackingSessionStore`.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة ٦، ورقمُ الترتيبِ في `BUG-009`.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، ونماذج قراءة خريطة العمليات
 *
 * ## لماذا كل تابع جملة `update ... where ended_at is null` واحدة
 *
 * لأن البديل — قراءةٌ ثم كتابةٌ في التطبيق — يفتح نافذةً بين الاثنين تكفي
 * لرسالتَي موقعٍ متزامنتين من نفس السائق (تلغرام يُرسل تحديثات الموقع الحيّ
 * تباعاً، ولا شيء يضمن تسلسلها في الخادم). فيقرأ النداءان «لا جلسة» ثم يُدرج
 * كلاهما.
 *
 * والفهرس الفريد الجزئي (`tracking_sessions_one_open_per_driver`) يمنع الصفّ
 * الثاني، لكنه يمنعه **بخطأ** لا بصمت — فيجب أن يكون في المسار جوابٌ لذلك
 * الخطأ. ولذلك الفتح `on conflict do nothing` ثم قراءةُ المستقرّ: الفائز واحد،
 * والخاسر يقرأ ما كتبه الفائز ويكمل بلا فشلٍ يظهر للسائق.
 *
 * ## `BUG-009` — أين يُولَّد الرقمُ بالضبطِ
 *
 * في `set last_sequence = last_sequence + 1` **داخلَ نفسِ `update`** التي تكتب
 * `last_fix_at`. لا في `JS`، ولا في نداءٍ ثانٍ، ولا من `recordedAtMs`، ولا من
 * `now()`. وهذا ما يجعل الرقمَ صحيحاً بعدَ إعادةِ تشغيلِ الخادمِ بلا إجراءٍ إضافيٍّ:
 * لا شيءَ منه في العمليةِ ليُفقَد (`ADR 0053` §٣-أ/٤ و٥ و٦).
 *
 * وذرّيّةُ الزيادةِ ليست ادّعاءً: `PostgreSQL` في `READ COMMITTED` يُعيد تقويمَ شرطِ
 * `where` على **النسخةِ المُحدَّثةِ** من الصفِّ إذا انتظرَت الجملةُ معاملةً متزامنةً،
 * ويقرأ `last_sequence` من تلك النسخةِ نفسِها. فنداءان متزامنان يُنتجان رقمَينِ
 * متعاقبَينِ لا رقماً واحداً مكرَّراً — وهو ما لا يضمنه `read-then-write` بحالٍ.
 *
 * ## ولماذا سقط `greatest` من `advance`
 *
 * `greatest` كانت تبتلع الإصلاحةَ الأقدمَ: تكتب الصفَّ بأحدثِ الطابعَينِ وتُعيد
 * صفّاً ناجحاً — فلا يستطيع الناديُ أن يعرفَ أنَّ ما أرسلَه رُفِض. وهو بعينُه ما
 * جعلَ `location_updated` يُنشَر عن إصلاحةٍ لم تُقدِّم شيئاً (`BUG-009`). فصار
 * الشرطُ في `where` والحكمُ ظاهراً في المُعاد.
 */

import type { SessionEndReason, TrackingSessionFacts } from "../../domain/tracking/session.ts";
import type { TrackingSessionRecord, TrackingSessionStore } from "../../tracking/session-store.ts";
import type { Sql } from "../db/client.ts";

interface SessionRow {
  readonly id: string;
  readonly driver_id: string;
  readonly trip_id: string | null;
  readonly started_at: string | Date;
  readonly last_fix_at: string | Date | null;
  readonly ended_at: string | Date | null;
  readonly end_reason: string | null;
  readonly last_sequence: number;
}

const SELECT_COLUMNS =
  "id, driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason, last_sequence";

function ms(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toFacts(row: SessionRow): TrackingSessionFacts {
  return {
    driverId: row.driver_id,
    tripId: row.trip_id,
    startedAtMs: ms(row.started_at),
    lastFixAtMs: row.last_fix_at === null ? null : ms(row.last_fix_at),
    endedAtMs: row.ended_at === null ? null : ms(row.ended_at),
    endReason: row.end_reason as SessionEndReason | null,
  };
}

function toRecord(row: SessionRow): TrackingSessionRecord {
  return {
    sessionId: row.id,
    facts: toFacts(row),
    /**
     * `integer` لا `bigint` في المخطَّطِ، فـ`postgres.js` يُعيده رقماً لا نصّاً —
     * والتعليلُ في ترويسةِ الهجرةِ. والحارسُ هنا لئلَّا يمرَّ نصٌّ صامتاً لو غُيِّر
     * نوعُ العمودِ يوماً: مقارنةُ نصٍّ بنصٍّ تقول `"10" < "9"`.
     */
    sequence: Number(row.last_sequence),
  };
}

export function createTrackingSessionRepository(sql: Sql): TrackingSessionStore {
  const openOf = async (driverId: string): Promise<TrackingSessionRecord | null> => {
    const rows = await sql<SessionRow[]>`
      select ${sql.unsafe(SELECT_COLUMNS)}
        from tracking_sessions
       where driver_id = ${driverId}::uuid and ended_at is null
       limit 1
    `;
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  };

  return {
    openSessionOf: openOf,

    open: async (driverId, tripId, startedAtMs) => {
      /**
       * `on conflict do nothing` على الفهرس الجزئي: من خسر السباق لا يفشل ولا
       * يُنشئ صفّاً ثانياً، بل يقرأ الجلسة التي استقرّت. وهذا يجعل «الفتح» فعلاً
       * متسامحاً مع التكرار كما ينصّ منفذه — والتسامح شرطٌ لا رفاهية: مصدر
       * النداء رسالةُ موقعٍ تصل مرّاتٍ في الثانية.
       */
      /**
       * و`city_id` تُشتقّ من `drivers` في نفس الجملة لا تُمرَّر من النداء:
       * فمدينة الجلسة واقعةٌ تُثبَّت لحظة الفتح (راجع الهجرة)، ومن يفتح الجلسة هو
       * مسار رسالة الموقع الذي لا يعرف المدينة ولا ينبغي أن يعرفها. ولو مُرِّرت
       * لصارت للمدينة كاتبان: `drivers` والنداء — وأوّل اختلافٍ بينهما يُنتج
       * جلسةً لا تظهر في خريطة أي مدينة.
       */
      /**
       * ولا يُذكَر `last_sequence` هنا: قيمتُه الابتدائيّةُ `default` في المخطَّطِ (١)،
       * وكتابتُها من التطبيقِ كانت ستجعل «أوّلَ رقمٍ في القناةِ» قيمةً في شيفرةٍ
       * وقيمةً في مخطَّطٍ — واختلافُهما يوماً عيبٌ صامتٌ.
       */
      const inserted = await sql<SessionRow[]>`
        insert into tracking_sessions (driver_id, city_id, trip_id, started_at)
        select d.id, d.city_id,
               ${tripId === null ? null : sql`${tripId}::uuid`},
               ${new Date(startedAtMs)}
          from drivers d
         where d.id = ${driverId}::uuid
        on conflict do nothing
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = inserted[0];
      if (row !== undefined) return toRecord(row);

      const existing = await openOf(driverId);
      if (existing !== null) return existing;
      // لا صفّ أُدرج ولا صفّ مفتوح: تعارضٌ من غير الفهرس الجزئي (سائق محذوف مثلاً).
      throw new Error("تعذّر فتح جلسة تتبّع ولا توجد جلسة مفتوحة");
    },

    attachTrip: async (driverId, tripId) => {
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set trip_id = ${tripId === null ? null : sql`${tripId}::uuid`},
               updated_at = now()
         where driver_id = ${driverId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    advance: async (driverId, lastFixAtMs) => {
      /**
       * جملةٌ واحدةٌ تحكم وتكتب وتُصدِر الرقمَ وتُخبِر بالنتيجةِ.
       *
       * `current` تقرأ ما في الصفِّ، و`advanced` تكتب **بشرطٍ**، والاختيارُ الأخيرُ
       * يُميّز الأحوالَ الثلاثةَ بلا نداءٍ ثانٍ:
       *
       *   - صفٌّ من `advanced`  ⇐ قُبِلت، والرقمُ الجديدُ فيه.
       *   - لا صفَّ من `advanced` وصفٌّ في `current` ⇐ أقدمُ قِدَماً صارماً: رُفِضت،
       *     ولم يُستهلَك رقمٌ، ولم تتغيّر الحالةُ.
       *   - لا صفَّ في الاثنَينِ ⇐ لا جلسةَ مفتوحةً.
       *
       * والشرطُ `last_fix_at <= $ts` لا `<`: المتساوي في الطابعِ **يُقبَل** ويأخذ
       * رقمَه (`ADR 0053` §٤-ج). وطابعُ تلغرام بدقّةِ الثانيةِ، فإصلاحتان في ثانيةٍ
       * واحدةٍ حالةٌ عاديّةٌ لا شذوذٌ — ورفضُ ثانيتِهما كان سيُجمِّد الخريطةَ عندَ
       * أوّلِ حركةٍ سريعةٍ.
       *
       * و`current` تُقرأ من لقطةِ الجملةِ، فقد تُظهِر — تحتَ تزاحمٍ — حالةً سبقت
       * كتابةً متزامنةً استقرّت. وهذا لا يُفسد الحكمَ: الحكمُ مأخوذٌ من وجودِ صفٍّ في
       * `advanced` لا من مقارنةٍ في `current`، و`current` مصدرُ عرضٍ للحالةِ المرفوضةِ
       * لا مصدرُ قرارٍ.
       */
      const at = new Date(lastFixAtMs);
      const rows = await sql<(SessionRow & { readonly accepted: boolean })[]>`
        with current as (
          select ${sql.unsafe(SELECT_COLUMNS)}
            from tracking_sessions
           where driver_id = ${driverId}::uuid and ended_at is null
        ),
        advanced as (
          update tracking_sessions as t
             set last_fix_at = ${at},
                 last_sequence = t.last_sequence + 1,
                 updated_at = now()
           where t.driver_id = ${driverId}::uuid
             and t.ended_at is null
             and (t.last_fix_at is null or t.last_fix_at <= ${at})
          returning t.id, t.driver_id, t.trip_id, t.started_at, t.last_fix_at,
                    t.ended_at, t.end_reason, t.last_sequence
        )
        select true as accepted, id, driver_id, trip_id, started_at, last_fix_at,
               ended_at, end_reason, last_sequence
          from advanced
        union all
        select false as accepted, id, driver_id, trip_id, started_at, last_fix_at,
               ended_at, end_reason, last_sequence
          from current
         where not exists (select 1 from advanced)
      `;

      const row = rows[0];
      if (row === undefined) return { kind: "no_session" };
      return row.accepted
        ? { kind: "accepted", record: toRecord(row) }
        : { kind: "stale", record: toRecord(row) };
    },

    close: async (driverId, reason, endedAtMs) => {
      /**
       * الإغلاقُ يستهلك رقماً لأنَّه ينشر `session_ended` (`ADR 0053` §٤-أ: رقمُ
       * الإغلاقِ آخرُ أرقامِ القناةِ). و`where ended_at is null` يجعله يستهلكه مرّةً
       * واحدةً: إغلاقُ جلسةٍ مُغلقةٍ لا يُصيب صفّاً فلا يُصدِر رقماً ولا يُنشَر عنه شيءٌ.
       */
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set ended_at = ${new Date(endedAtMs)},
               end_reason = ${reason},
               last_sequence = last_sequence + 1,
               updated_at = now()
         where driver_id = ${driverId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    closeByTrip: async (tripId, reason, endedAtMs) => {
      const rows = await sql<SessionRow[]>`
        update tracking_sessions
           set ended_at = ${new Date(endedAtMs)},
               end_reason = ${reason},
               last_sequence = last_sequence + 1,
               updated_at = now()
         where trip_id = ${tripId}::uuid and ended_at is null
        returning ${sql.unsafe(SELECT_COLUMNS)}
      `;
      return rows.map(toRecord);
    },
  };
}
