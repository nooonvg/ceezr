/**
 * الغرض: `WASLA — الدورة ٤` — إثباتُ صحةِ القارئِ الموحّدِ
 *   (`createDriverDutyAndTripReader`) على PostgreSQL حقيقيٍّ لا على مزدوجٍ في
 *   الذاكرة، وأنّهُ يُطابقُ القارئينِ المنفصلينِ (`createActiveTripReader` +
 *   `createDriverDutyReader`) في كلِّ حالةٍ يمرُّ بها سائقٌ حقيقيٌّ.
 *
 *   ولماذا هذا الملفُّ لا زيادةٌ في `tests/unit`؟ لأنّ ما يُقاس هنا هو
 *   **استعلامٌ واحدٌ على قاعدةٍ حقيقية** بفروعِهِ المُرسَبةِ وحالاتِ عدمِ
 *   الوجودِ (`لا صفَّ إتاحة`، `لا رحلة`، `رحلةٌ منتهية`) — ومزدوجُ الذاكرةِ
 *   يُقرِّرُ الجوابَ بيدِهِ فلا يشهدُ على شيءٍ. ولأنّ الفرقَ بينَ القارئينِ
 *   هنا هو **عددُ الرحلاتِ إلى القاعدة** — وهو عينُ الإصلاحِ (رحلةٌ واحدةٌ
 *   بدلَ اثنتينِ في كلّ إصلاحةِ موقعٍ) — فقد صُنعَ `sql` مُحصاةُ النداءاتِ
 *   ليشهدَ على العددِ لا على الظهورِ وحده.
 *
 *   ويُختبرُ معَهُ عقدُ السباقِ الذي حفظَهُ الإصلاحُ: إسنادٌ يقعُ بعدَ لقطةِ
 *   الإصلاحةِ تراهُ الإصلاحةُ التاليةُ وتُرفِقُهُ (مسارُ الإرفاقِ القائمُ)،
 *   من خلالِ المسارِ الحقيقيِّ كاملًا (ويبهوك ← حوار ← تطبيق ← قاعدة ← ناقل).
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `tracking-queries.ts` أو
 *   على تركيبِ `dutyAndTrip` في `live-tracking.ts` أو `container.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createLiveTracking } from "../../packages/application/tracking/live-tracking.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTrackingSessionRepository } from "../../packages/infrastructure/tracking/session-repository.ts";
import {
  createActiveTripReader,
  createDriverDutyAndTripReader,
  createDriverDutyReader,
} from "../../packages/infrastructure/tracking/tracking-queries.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const MS_PER_SECOND = 1000;

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: "duty-and-trip-secret",
});

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId: string;

/** تُنشأ في beforeAll وتُقفل في afterAll — لا تُقفل في afterEach (لا فائدة). */
let container: ReturnType<typeof buildContainer> | undefined;
let events: TrackingEvent[] = [];
let driverSent: SentMessage[] = [];

/**
 * مُحصاةُ النداءاتِ على مجموعةِ الاتصالاتِ نفسِها — تشهدُ على عددِ الرحلاتِ إلى
 * القاعدةِ لا على الظهورِ وحده. وكُسِيَت بـ`Proxy` لا بتغليفٍ يدويٍّ لأنّ كلَّ
 * توقيعاتِ `Sql` (القوالبِ الموسومةِ والمعاملاتِ وغيرِها) تمرُّ كما هي بلا
 * إعادةِ كتابةٍ تُخفي مسلكًا.
 */
let queryCount = 0;
let countingSql: Sql;

async function seedUser(chat: number, role: "driver" | "rider"): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}, ${chat}::bigint, ${`مستخدم ${chat}`}, ${`+9665${chat}`}, 'ar', ${role})
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر إنشاء المستخدم");
  return id;
}

async function seedDriver(chat: number, onDuty: boolean): Promise<string> {
  const userId = await seedUser(chat, "driver");
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${userId}::uuid, 'verified', 'sedan', ${`س ${chat}`})
    returning id
  `;
  const driverId = drivers[0]?.id;
  if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
  if (onDuty) {
    await sql`select record_attendance(${driverId}::uuid, true, 'test_seed')`;
  }
  return driverId;
}

async function seedOrderFor(
  riderChat: number,
  driverId: string,
  status: string,
  assigned: boolean,
): Promise<string> {
  const userId = await seedUser(riderChat, "rider");
  const riderRows = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id)
    values (${cityId}, ${userId}::uuid)
    returning id
  `;
  const riderId = riderRows[0]?.id;
  if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
  const rows = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, assigned_driver_id, service, status, pickup,
      created_at, updated_at
    )
    values (
      ${cityId}, ${riderId}::uuid, ${assigned ? driverId : null}::uuid,
      'transport', ${status}::order_status,
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography,
      now() - make_interval(mins => 5), now() - make_interval(mins => 5)
    )
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر إنشاء الطلب");
  return id;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات القارئ الموحّد مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدةٍ بها الهجرات مطبّقة.");
}

describeIf("القارئ الموحّد للخدمة والرحلة النشطة — على PostgreSQL حقيقي", () => {
  beforeAll(() => {
    if (DATABASE_URL === undefined) throw new Error("TEST_DATABASE_URL مطلوب");
    sql = createSql({ connectionString: DATABASE_URL, max: 4, prepare: false });
    countingSql = new Proxy(sql, {
      apply(target, thisArg, argumentsList) {
        queryCount += 1;
        return Reflect.apply(target, thisArg, argumentsList);
      },
    }) as unknown as Sql;
  });

  afterAll(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
    const cityRows = await sql<{ id: string }[]>`select id from cities order by id limit 1`;
    cityId = cityRows[0]?.id ?? "";
    queryCount = 0;
    events = [];
    driverSent = [];
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  it("يُطابقُ القارئينِ المنفصلينِ في كلِّ حالةٍ — واستعلامٌ واحدٌ لا اثنانِ", async () => {
    /**
     * مصفوفةُ الحالاتِ التي يمرُّ بها سائقٌ حقيقيٌّ: على الخدمةِ وبدونِها،
     * برحلةٍ نشطةٍ (matched/in_progress) وبدونِها، وبحثالةٍ منتهيةٍ (completed)
     * لا تُحسَبُ رحلةً نشطةً، وبلا صفِّ إتاحةٍ أصلًا (سائقٌ لم يُعلن إتاحتَهُ
     * قطّ = خارجَ الخدمةِ).
     */
    const unified = createDriverDutyAndTripReader(countingSql);
    const separateTrips = createActiveTripReader(countingSql);
    const separateDuty = createDriverDutyReader(countingSql);

    // ١) سائقٌ على الخدمةِ بلا أيِّ طلبٍ: الخدمةُ حقيقيةٌ والرحلةُ معدومة.
    const d1 = await seedDriver(501, true);
    const before = queryCount;
    const u1 = await unified.dutyAndActiveTrip(d1);
    const queriesForUnified = queryCount - before; // استعلامٌ واحد.
    const t1 = await separateTrips.activeTripOf(d1);
    const duty1 = await separateDuty.isOnDuty(d1);
    expect(u1).toEqual({ onDuty: true, activeTripId: null });
    expect(t1).toBeNull();
    expect(duty1).toBe(true);
    expect(queriesForUnified).toBe(1);

    // ٢) رحلةٌ نشطةٌ (matched) مُسندةٌ إليه: تظهرُ في القارئَينِ بالقيمةِ نفسِها.
    const orderId = await seedOrderFor(601, d1, "matched", true);
    const u2 = await unified.dutyAndActiveTrip(d1);
    const t2 = await separateTrips.activeTripOf(d1);
    expect(u2.activeTripId).toBe(orderId);
    expect(t2).toBe(orderId);
    expect(u2.onDuty).toBe(true);

    // ٣) رحلةٌ منتهيةٌ (completed) لا تُحسَبُ رحلةً نشطةً في القارئَينِ معًا.
    await seedOrderFor(602, d1, "completed", true);
    const others = await unified.dutyAndActiveTrip(d1);
    const t3 = await separateTrips.activeTripOf(d1);
    expect(others.activeTripId).toBe(orderId); // النشطةُ (matched) تبقى هي الجواب.
    expect(t3).toBe(orderId);

    // ٤) سائقٌ خارجَ الخدمةِ (is_available = false): الحكمُ واحدٌ في القارئَينِ.
    await sql`select record_attendance(${d1}::uuid, false, 'test_seed')`;
    const u4 = await unified.dutyAndActiveTrip(d1);
    const duty4 = await separateDuty.isOnDuty(d1);
    expect(u4.onDuty).toBe(false);
    expect(duty4).toBe(false);

    // ٥) سائقٌ بلا صفِّ إتاحةٍ أصلًا: خارجَ الخدمةِ — coalesce في القارئَينِ.
    const d5 = await seedDriver(505, false);
    const u5 = await unified.dutyAndActiveTrip(d5);
    const duty5 = await separateDuty.isOnDuty(d5);
    expect(u5.onDuty).toBe(false);
    expect(duty5).toBe(false);
    expect(u5.activeTripId).toBeNull();
  });

  it("عقدُ السباقِ محفوظٌ: إسنادٌ بعدَ لقطةِ الإصلاحةِ تراهُ الإصلاحةُ التاليةُ وتُرفِقُهُ", async () => {
    /**
     * هذا هو الضمانُ الذي لا يجوزُ أن يتزعزعَ بالقراءةِ الموحّدةِ: الجلسةُ
     * تُفتحُ على لقطةِ إصلاحتِها، والإسنادُ الذي يقعُ بعدَها لا يُضيعُ —
     * الإصلاحةُ التاليةُ تراهُ وتُرفِقُهُ بمسارِ الإرفاقِ القائمِ. والمسارُ
     * هنا حقيقيٌّ كاملًا: ويبهوكُ تلغرام ← الحوارُ ← التطبيقُ ← القاعدةُ ←
     * ناقلُ الأحداثِ — بلا اختصارٍ في منتصفِ الطريقِ.
     */
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing([]),
    });
    container.tracking.bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          events.push(event);
        },
      },
    );

    const driverId = await seedDriver(502, true);

    // نبضةُ الموقعِ الأولى: لا رحلةَ بعدُ — الجلسةُ تُفتحُ بلا رحلةٍ.
    const first = await container.handler.handle("driver", {
      update_id: nextUpdateId(),
      message: {
        chat: { id: 502 },
        from: { id: 502, language_code: "ar" },
        location: { ...JEDDAH, horizontal_accuracy: 8 },
        date: Math.floor(Date.now() / MS_PER_SECOND) - 1,
      },
    });
    expect(first).toBe(true);
    let session = await sql<{ trip_id: string | null }[]>`
      select trip_id from tracking_sessions where driver_id = ${driverId}::uuid
    `;
    expect(session.length).toBe(1);
    expect(session[0]?.trip_id).toBeNull();
    const startedEvents = events.filter((e) => e.type === "session_started");
    expect(startedEvents.length).toBe(1);
    expect(startedEvents[0]?.tripId).toBeNull();

    // الإسنادُ يقعُ **بعدَ** لقطةِ الإصلاحةِ الأولى.
    const orderId = await seedOrderFor(603, driverId, "matched", true);

    // النبضةُ الثانيةُ: ترى الإسنادَ في لقطتِها وتُرفِقُهُ بالجلسةِ نفسِها.
    const second = await container.handler.handle("driver", {
      update_id: nextUpdateId(),
      message: {
        chat: { id: 502 },
        from: { id: 502, language_code: "ar" },
        location: { ...JEDDAH, horizontal_accuracy: 8 },
        date: Math.floor(Date.now() / MS_PER_SECOND),
      },
    });
    expect(second).toBe(true);
    session = await sql<{ trip_id: string | null }[]>`
      select trip_id from tracking_sessions where driver_id = ${driverId}::uuid
    `;
    expect(session.length).toBe(1);
    expect(session[0]?.trip_id).toBe(orderId);
    // ولا جلسةَ ثانيةً تُفتحُ — الإرفاقُ على الجلسةِ القائمةِ لا بديلًا عنها.
    expect(events.filter((e) => e.type === "session_started").length).toBe(1);
    expect(events.filter((e) => e.type === "location_updated").length).toBe(2);
  });

  it("الدفعة 19 — إسنادٌ بعدَ اللقطةِ وأثناءَ انتظارِ openSessionOf: الجلسةُ تُفتحُ على الرحلةِ في المسارينِ (عقدُ main)", async () => {
    /**
     * السباقُ الذي كشفَهُ تدقيقُ PR #595: اللقطةُ (القارئُ الموحّدُ أو المنفصلانِ)
     * ترى السائقَ بلا رحلة، ثمّ يُسنَدُ إليه طلبٌ **فعليًّا في القاعدة** أثناءَ
     * انتظارِ `openSessionOf`، ثمّ تعودُ القراءةُ بلا جلسةٍ سابقة. على `main`
     * تُقرأُ الرحلةُ قراءةً طازجةً عندَ الإنشاءِ فتُفتحُ الجلسةُ عليها؛ وعلى رأسِ
     * `a1ef73b5` كانت تُفتحُ على `null`. والإثباتُ هنا من صفِّ `tracking_sessions`
     * نفسِهِ ومن أحداثِ النشرِ، على المستودعِ الحقيقيِّ والقارئاتِ الحقيقية.
     */
    for (const useUnified of [true, false]) {
      await sql`truncate table tracking_sessions, order_offers, orders restart identity cascade`;
      const chat = useUnified ? 511 : 512;
      const driverId = await seedDriver(chat, true);
      // الطلبُ موجودٌ قبلَ اللقطةِ غيرَ مُسنَد، ويُسنَدُ داخلَ النافذة.
      const orderId = await seedOrderFor(chat + 100, driverId, "searching", false);
      const store = createTrackingSessionRepository(sql);
      let windowHits = 0;
      const published: TrackingEvent[] = [];
      const live = createLiveTracking({
        sessions: {
          ...store,
          openSessionOf: async (id) => {
            if (windowHits === 0) {
              windowHits += 1;
              await sql`update orders set assigned_driver_id = ${driverId}::uuid,
                                          status = 'matched'::order_status
                         where id = ${orderId}::uuid`;
            }
            return store.openSessionOf(id);
          },
        },
        publisher: { publish: async (event) => void published.push(event) },
        trips: createActiveTripReader(sql),
        duty: createDriverDutyReader(sql),
        ...(useUnified ? { dutyAndTrip: createDriverDutyAndTripReader(sql) } : {}),
        clock: { now: () => new Date() },
      });

      await live.onFix({
        driverId,
        cityId,
        latitude: JEDDAH.latitude,
        longitude: JEDDAH.longitude,
        recordedAtMs: Date.now() - MS_PER_SECOND,
        accuracyMeters: 8,
        verdict: "ACCEPT",
        findings: [],
      });

      expect(windowHits).toBe(1);
      const rows = await sql<{ trip_id: string | null }[]>`
        select trip_id from tracking_sessions
         where driver_id = ${driverId}::uuid and ended_at is null
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.trip_id).toBe(orderId);
      expect(published.map((e) => [e.type, e.tripId])).toEqual([
        ["session_started", orderId],
        ["location_updated", orderId],
      ]);
    }
  });
});
