/**
 * الغرض: `BUG-009` — إثباتُ أنَّ ترتيبَ أحداثِ التتبُّعِ **رقمٌ من الخادمِ لكلِّ جلسةٍ**
 *   كما ألزمَ `ADR 0053`، على PostgreSQL حقيقيٍّ لا على مزدوجٍ في الذاكرة.
 *
 *   ولماذا هذا الملفُّ لا زيادةٌ في `tests/unit`؟ لأنَّ ما يُقاس هنا لا يمكن أن
 *   يُقاس بمزدوجٍ من حيثُ المبدأِ لا من حيثُ الكسل:
 *
 *   (١) **الذرّيّةُ**: القبولُ والرفضُ وزيادةُ الرقمِ في جملةِ `update ... returning`
 *       واحدةٍ. ومزدوجُ الذاكرةِ يُقلِّد الحكمَ بمتغيّرٍ في العمليةِ، فنجاحُه لا يشهد
 *       على شيءٍ — هو بعينِه العدّادُ الذي منعَه `ADR 0053` §٣-أ/٤.
 *   (٢) **الديمومةُ**: أنَّ الرقمَ يستأنف من الصفِّ بعدَ ذهابِ العمليةِ. ومزدوجٌ في
 *       الذاكرةِ يبدأ من الصفرِ دائماً، فهو لا يستطيع أن يُخفق في هذا الاختبارِ.
 *   (٣) **أنَّ المولِّدَ حقيقيٌّ**: كلُّ رقمٍ يُقاس عليه في هذا الملفِّ صادرٌ من
 *       القاعدةِ أو مقروءٌ من `tracking_sessions`. **ولا يُكتَب رقمٌ مصطنعٌ في
 *       توقُّعٍ** — أمرُ التنفيذِ §١٠ نصَّ على أنَّ الأرقامَ المصطنعةَ تُخفي المولِّدَ.
 *
 *   والحالتان ١ و٧ من §٨ في `ADR 0053` مشروطتان بقاعدةٍ حقيقيّةٍ نصًّا، وهما
 *   «الخمسُ نبضاتٍ المختلطةُ» و«استئنافُ الرقمِ بعدَ إعادةِ التشغيلِ» أدناه.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `session-repository.ts` أو على
 *   عمودِ `tracking_sessions.last_sequence` أو على قرارِ النشرِ في `live-tracking.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { listLiveDriverPositions } from "../../apps/gateway/src/admin/queries.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { LivePosition } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTrackingSessionRepository } from "../../packages/infrastructure/tracking/session-repository.ts";
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
const WEBHOOK_SECRET = "sequence-secret";
const DRIVER_CHAT = 130_909;

const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

/** ثانيةٌ بالمللي — `recordedAtMs` من تلغرام بدقّةِ الثانيةِ، فالفروقُ تُقاس بها. */
const MS_PER_SECOND = 1000;

const config: AppConfig = testConfig({
  port: 3993,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let events: TrackingEvent[];
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let liveOps: string[];

interface SequenceRow {
  readonly id: string;
  readonly last_sequence: number;
  readonly last_fix_at: string | null;
  readonly ended_at: string | null;
}

/** يقرأ الصفَّ نفسَه لا نسخةً في الذاكرة — فالمقياسُ ما استقرَّ في القاعدةِ. */
async function sessionsOf(driverId: string): Promise<readonly SequenceRow[]> {
  return sql<SequenceRow[]>`
    select id, last_sequence, last_fix_at, ended_at
      from tracking_sessions where driver_id = ${driverId}
     order by started_at asc, id asc
  `;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات ترتيبِ التتبُّعِ مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدةٍ بها الهجرات مطبَّقة.");
}

describeIf("ترتيبُ أحداثِ التتبُّعِ على PostgreSQL حقيقيٍّ — BUG-009 / ADR 0053", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;

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

    events = [];
    driverSent = [];
    riderSent = [];
    liveOps = [];

    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: {
        start: async (chatId: string, _position: LivePosition, _live: number) => {
          liveOps.push(`start:${chatId}`);
          return `msg-${liveOps.length}`;
        },
        update: async (chatId: string) => {
          liveOps.push(`update:${chatId}`);
          return true;
        },
        stop: async (chatId: string) => {
          liveOps.push(`stop:${chatId}`);
          return true;
        },
      },
    });

    /**
     * الاشتراكُ بنفسِ تصريحِ المُرحِّلِ في التركيبِ (`operations` / `all_cities`) —
     * فما يُلتقَط هنا هو ما يراه مستهلكٌ حقيقيٌّ، لا مجرًى صُنِع للاختبارِ.
     */
    container.tracking.bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          events.push(event);
        },
      },
    );
  });

  /**
   * سائقٌ موثَّقٌ وداخلُ الخدمةِ. والزرعُ بالكتابةِ المباشرةِ لا بحوارِ التسجيلِ
   * كاملاً: مقصدُ هذا الملفِّ ميكانيكا الرقمِ، وحوارُ التسجيلِ مقيسٌ في
   * `tracking-realtime` و`registration`. والإتاحةُ بـ`record_attendance` لأنَّها
   * كاتبُ الإتاحةِ في الإنتاجِ، ومهيّئٌ يكتب الصفَّ بيدِه يختبر حالةً لا تنتجها
   * الشيفرةُ أبداً.
   */
  async function seedDriver(chat: number): Promise<string> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${`سائق ${chat}`}, ${`+9665${chat}`}, 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}::uuid, 'verified', 'sedan', ${`س ${chat}`})
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`select record_attendance(${driverId}::uuid, true, 'test_seed')`;
    return driverId;
  }

  /**
   * نبضةُ موقعٍ من بوتِ السائقِ بطابعٍ زمنيٍّ مضبوطٍ — `date` بالثانيةِ كما يُرسل
   * تلغرام، وهو المصدرُ الذي يُشتقُّ منه `recordedAtMs` في المُخطِّطِ. والدخولُ من
   * `handler.handle` وهو **نفسُ** ما يُنادى من موجّهِ الويبهوكِ بعدَ التحقُّقِ من
   * السرِّ، فلا يُقصَر المسارُ على منطقٍ داخليٍّ.
   */
  async function postLocation(chatId: number, agoSeconds: number): Promise<void> {
    const handled = await container.handler.handle("driver", {
      update_id: nextUpdateId(),
      message: {
        chat: { id: chatId },
        from: { id: chatId, language_code: "ar" },
        location: { ...JEDDAH, horizontal_accuracy: 8 },
        date: Math.floor(Date.now() / MS_PER_SECOND) - agoSeconds,
      },
    });
    expect(handled).toBe(true);
  }

  const positionsOf = (all: readonly TrackingEvent[]) =>
    all.filter((event) => event.type === "location_updated");

  it("خمسُ نبضاتٍ مختلطةِ الترتيبِ: الحالةُ لا تتراجع، ولا يُنشَر إلَّا المقبولُ", async () => {
    /**
     * **الدليلُ الحاسمُ** — §١٠ من أمرِ التنفيذِ و§٨/١ من `ADR 0053`.
     *
     * الطوابعُ الزمنيّةُ أ<ب<ج<د<هـ، وترتيبُ الوصولِ أ · ج · ب · هـ · د. أي أنَّ
     * نبضتَينِ من الخمسِ تصلانِ بعدَ ما هو أحدثُ منهما (ب بعدَ ج، ود بعدَ هـ).
     *
     * والمقاسُ ثلاثةُ أمورٍ في مسارٍ واحدٍ حقيقيٍّ (ويبهوكُ تلغرام ← الحوارُ ←
     * التطبيقُ ← القاعدةُ ← ناقلُ الأحداثِ):
     *   ١. `last_fix_at` في الصفِّ = طابعُ **هـ** لا طابعُ د — الحالةُ لا تتراجع.
     *   ٢. عددُ أحداثِ `location_updated` = ثلاثةٌ لا خمسةٌ — لا نشرَ عندَ الرفضِ.
     *   ٣. أرقامُ تلك الأحداثِ متزايدةٌ صارماً، وآخرُها = `last_sequence` في الصفِّ.
     *
     * **ولا رقمَ مصطنعٌ في التوقُّعاتِ**: كلُّ رقمٍ يُقارَن هنا مقروءٌ من القاعدةِ أو
     * محمولٌ في حدثٍ أصدرَته القاعدةُ. ولو استُبدل المولِّدُ بعدّادٍ في الذاكرةِ لسقط
     * البندُ الثالثُ بعدَ إعادةِ بناءِ الحاويةِ لا هنا — ولذلك جاءَ اختبارُ
     * الاستئنافِ التالي.
     */
    const driverId = await seedDriver(DRIVER_CHAT);

    const arrivals = [50, 30, 40, 10, 20] as const; // أ · ج · ب · هـ · د
    for (const ago of arrivals) await postLocation(DRIVER_CHAT, ago);

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    // ١ — الحالةُ المحفوظةُ هي الأحدثُ (هـ = قبلَ عشرِ ثوانٍ) لا الأخيرةُ وصولاً (د).
    const newest = Math.max(...arrivals.map((ago) => -ago));
    const savedAgoSeconds = Math.round(
      (Date.now() - new Date(row.last_fix_at ?? 0).getTime()) / MS_PER_SECOND,
    );
    expect(savedAgoSeconds).toBeLessThanOrEqual(-newest + 2);
    expect(savedAgoSeconds).toBeGreaterThanOrEqual(-newest - 2);

    // ٢ — ثلاثُ إصلاحاتٍ قُبِلت (أ · ج · هـ) فثلاثةُ أحداثٍ لا خمسةٌ.
    const positions = positionsOf(events);
    expect(positions.length).toBe(3);

    // ٣ — الأرقامُ من الجلسةِ نفسِها، متزايدةٌ صارماً، وآخرُها ما في الصفِّ.
    const sequences = positions.map((event) => event.sequence);
    expect(new Set(positions.map((event) => event.sessionId)).size).toBe(1);
    expect(positions[0]?.sessionId).toBe(row.id);
    for (let index = 1; index < sequences.length; index += 1) {
      const previous = sequences[index - 1] ?? 0;
      const current = sequences[index] ?? 0;
      expect(current).toBeGreaterThan(previous);
    }
    expect(sequences.at(-1)).toBe(row.last_sequence);

    // ٤ — ولا رقمَ منسوخٌ من طابعٍ زمنيٍّ: الأرقامُ رتبيّةٌ صغيرةٌ لا مللي ثانية.
    const startedEvent = events.find((event) => event.type === "session_started");
    expect(startedEvent?.sequence).toBe(1);
    expect(row.last_sequence).toBeLessThan(arrivals.length + 2);
  });

  it("ساعةُ جهازٍ منحرفةٌ إلى الأمامِ لا تُفسِد ترتيبَ القناةِ", async () => {
    /**
     * §٨/٩ من `ADR 0053`. والمقصودُ بالفسادِ ههنا **ترتيبُ القناةِ** لا قبولُ
     * الإصلاحةِ: الرقمُ من الخادمِ فلا تملك ساعةُ الجهازِ سبيلاً إلى إنقاصِه، وأيُّ
     * انحرافٍ لا يُنتِج إلَّا حكماً بالقبولِ أو الردِّ في طبقةِ الدومينِ.
     *
     * والانحرافُ ثلاثُ ثوانٍ إلى الأمامِ لأنَّ `DEFAULT_GPS_POLICY.maxFutureSkewSeconds`
     * خمسٌ، فما فوقَها يُرَدُّ قبلَ أن يبلغَ الكاتبَ أصلاً — وهذه الحالةُ تقصد ما
     * **يُقبَل** رغمَ انحرافِه.
     *
     * **والأثرُ المُعلَنُ لا المُخفى:** الإصلاحةُ المنحرفةُ تُقدِّم `last_fix_at` إلى
     * المستقبلِ، فنبضةٌ صادقةٌ بعدَها تصير أقدمَ منها فتُرَدُّ `stale`. وهذا **عينُ ما
     * ينصُّه `BUG-009`** («رفض الأقدم صراحةً») بحسبِ الطابعِ المتاحِ، لا عيبٌ جديدٌ:
     * الخادمُ لا يملك ساعةً أصدقَ من ساعةِ الجهازِ لهذه النبضةِ. والمحروسُ ههنا أنَّ
     * القناةَ **لا تتراجع** وأنَّ الأرقامَ تبقى متزايدةً صارماً مهما انحرفَت الساعةُ.
     */
    const driverId = await seedDriver(DRIVER_CHAT);

    await postLocation(DRIVER_CHAT, 10);
    await postLocation(DRIVER_CHAT, -3); // ساعةٌ منحرفةٌ ثلاثَ ثوانٍ إلى الأمامِ
    await postLocation(DRIVER_CHAT, 1); // نبضةٌ صادقةٌ صارت أقدمَ من المنحرفةِ

    const row = (await sessionsOf(driverId))[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    const positions = positionsOf(events);
    const sequences = positions.map((event) => event.sequence);

    // الأرقامُ متزايدةٌ صارماً — والمنحرفةُ لم تُنقِص رقماً ولا أعادَته.
    for (let index = 1; index < sequences.length; index += 1) {
      expect(sequences[index] ?? 0).toBeGreaterThan(sequences[index - 1] ?? 0);
    }
    // وكلُّها من الجلسةِ نفسِها، وآخرُها ما في الصفِّ — فالمرساةُ سليمةٌ.
    expect(new Set(positions.map((event) => event.sessionId)).size).toBe(1);
    expect(sequences.at(-1)).toBe(row.last_sequence);
    // والنبضةُ التي صارت أقدمَ لم تُنشَر: المنشورُ اثنانِ لا ثلاثةٌ.
    expect(positions.length).toBe(2);
  });

  it("الرقمُ يستأنف من القاعدةِ بعدَ ذهابِ العمليةِ — لا من الصفرِ", async () => {
    /**
     * §٨/٧ من `ADR 0053`. وإعادةُ التشغيلِ تُحاكى بأقصى ما تُحاكى به داخلَ عمليةٍ
     * واحدةٍ: **اتّصالٌ جديدٌ ومستودعٌ جديدٌ** لا يُشاركان الأوّلَ حالةً في الذاكرةِ.
     * فلو كان الرقمُ في متغيّرٍ لبدأَ المستودعُ الثاني من الأوّلِ حتماً.
     */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 40);
    await postLocation(DRIVER_CHAT, 20);

    const before = (await sessionsOf(driverId))[0];
    if (before === undefined) throw new Error("لم تُفتح جلسة");
    expect(before.last_sequence).toBeGreaterThan(1);

    const restarted = createSql({ connectionString: DATABASE_URL ?? "" });
    try {
      const store = createTrackingSessionRepository(restarted);
      const outcome = await store.advance(driverId, Date.now());
      expect(outcome.kind).toBe("accepted");
      if (outcome.kind !== "accepted") throw new Error("رُفِضت إصلاحةٌ أحدثُ");
      expect(outcome.record.sessionId).toBe(before.id);
      expect(outcome.record.sequence).toBe(before.last_sequence + 1);
    } finally {
      await restarted.end({ timeout: 5 });
    }

    const after = (await sessionsOf(driverId))[0];
    expect(after?.last_sequence).toBe(before.last_sequence + 1);
  });

  it("إصلاحةٌ أقدمُ تُرَدُّ صراحةً ولا تستهلك رقماً ولا تُغيّر الحالةَ", async () => {
    /** §٨/٢ و§٣-أ/١١ — الرفضُ حكمٌ مُعلَنٌ (`stale`) لا صمتٌ، ولا يُحرّك العدّادَ. */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 20);

    const before = (await sessionsOf(driverId))[0];
    if (before === undefined) throw new Error("لم تُفتح جلسة");

    const store = createTrackingSessionRepository(container.sql);
    const older = new Date(before.last_fix_at ?? 0).getTime() - 30 * MS_PER_SECOND;
    const outcome = await store.advance(driverId, older);

    expect(outcome.kind).toBe("stale");
    const after = (await sessionsOf(driverId))[0];
    expect(after?.last_sequence).toBe(before.last_sequence);
    // مقارنةُ اللحظةِ لا مقارنةُ الكائنِ: المُشغِّلُ يُعيد `Date` جديداً في كلِّ قراءةٍ.
    expect(new Date(after?.last_fix_at ?? 0).getTime()).toBe(
      new Date(before.last_fix_at ?? 0).getTime(),
    );
  });

  it("تساوي الطابعِ الزمنيِّ ليس قِدَماً: الإصلاحةُ الثانيةُ تُقبَل وتأخذ رقمَها", async () => {
    /**
     * §٤-ج و§٨/٣. والسببُ واقعةٌ لا احتمالٌ: `recordedAtMs` من تلغرام بدقّةِ
     * **الثانيةِ**، فنبضتانِ في ثانيةٍ واحدةٍ متساويتانِ حتماً. ورفضُ المتساوي
     * يُسقط نصفَ نبضاتِ سائقٍ يُرسل مرّتَينِ في الثانيةِ.
     */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 20);

    const before = (await sessionsOf(driverId))[0];
    if (before === undefined) throw new Error("لم تُفتح جلسة");
    const same = new Date(before.last_fix_at ?? 0).getTime();

    const store = createTrackingSessionRepository(container.sql);
    const outcome = await store.advance(driverId, same);

    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") throw new Error("رُفِض المتساوي");
    expect(outcome.record.sequence).toBe(before.last_sequence + 1);
  });

  it("لا عدّادَ عالميٌّ: جلستا سائقَينِ ترقّمانِ استقلالاً", async () => {
    /**
     * §٨/٥ و§٣-أ/١. العدّادُ العالميُّ يبدو أبسطَ، وأثرُه أنَّ نبضةَ سائقٍ تُحدث
     * فجوةً في ترتيبِ سائقٍ آخرَ فتُرسل مستهلكَه إلى لقطةٍ بلا سببٍ.
     */
    const first = await seedDriver(DRIVER_CHAT);
    const second = await seedDriver(DRIVER_CHAT + 1);

    await postLocation(DRIVER_CHAT, 40);
    await postLocation(DRIVER_CHAT, 30);
    await postLocation(DRIVER_CHAT, 20);
    await postLocation(DRIVER_CHAT + 1, 20);

    const firstRow = (await sessionsOf(first))[0];
    const secondRow = (await sessionsOf(second))[0];
    expect(firstRow?.last_sequence).toBe(4);
    expect(secondRow?.last_sequence).toBe(2);
    expect(firstRow?.id).not.toBe(secondRow?.id);
  });

  it("session_started وsession_ended من عدّادِ الجلسةِ نفسِه لا من عدّادٍ ثانٍ", async () => {
    /** §٤-أ و§٨/٦ — بدايةُ الجلسةِ ونهايتُها حدثانِ في القناةِ نفسِها. */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 30);
    await postLocation(DRIVER_CHAT, 10);

    const beforeEnd = (await sessionsOf(driverId))[0];
    if (beforeEnd === undefined) throw new Error("لم تُفتح جلسة");

    await container.tracking.live.onDutyEnded(driverId);

    const started = events.find((event) => event.type === "session_started");
    const ended = events.find((event) => event.type === "session_ended");
    const positions = positionsOf(events);

    expect(started?.sessionId).toBe(beforeEnd.id);
    expect(ended?.sessionId).toBe(beforeEnd.id);
    expect(started?.sequence).toBe(1);
    // النهايةُ تتلو آخرَ إصلاحةٍ مقبولةٍ بواحدٍ — لا تُعيد الترقيمَ ولا تُكرّره.
    expect(ended?.sequence).toBe((positions.at(-1)?.sequence ?? 0) + 1);
    expect(ended?.sequence).toBe(beforeEnd.last_sequence + 1);

    const closed = (await sessionsOf(driverId))[0];
    expect(closed?.ended_at).not.toBeNull();
    expect(closed?.last_sequence).toBe(ended?.sequence);
  });

  it("اللقطةُ الموثوقةُ تحمل مرساةَ الترتيبِ فيُحاذي العميلُ lastAppliedSeq", async () => {
    /**
     * §٨/٨ و§٣-أ/١٢. والفجوةُ تُعالَج بلقطةٍ لا بإعادةِ بثٍّ، فالمقاسُ أنَّ اللقطةَ
     * **تكفي** للمحاذاةِ: رقمُها هو نفسُه رقمُ الصفِّ لحظةَ قراءتِها. ولا يوجد في
     * النظامِ ما يُعيد بثَّ حدثٍ ماضٍ — لا مخزنَ أحداثٍ ولا تابعَ إعادةٍ في الناقلِ.
     */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 30);
    await postLocation(DRIVER_CHAT, 10);

    const row = (await sessionsOf(driverId))[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    const snapshot = await listLiveDriverPositions(container.sql, cityId);
    const mine = snapshot.find((entry) => entry.driverId === driverId);
    expect(mine?.sessionId).toBe(row.id);
    expect(mine?.sessionSequence).toBe(row.last_sequence);
    expect(mine?.sessionSequence).toBe(positionsOf(events).at(-1)?.sequence);

    expect("replay" in container.tracking.bus).toBe(false);
  });
  it("جلسةٌ تجاوزت سقفَها تُغلق `EXPIRED` وتنشر `session_ended` برقمِ الصفِّ نفسِه", async () => {
    /**
     * `BUG-010` على قاعدةٍ حقيقيّةٍ لا على مزدوجٍ. وثلاثُ دعاوى لا يشهد لها
     * مزدوجُ الذاكرةِ من حيثُ المبدأِ:
     *
     * (١) أنَّ الرقمَ المنشورَ **هو** `last_sequence` المستقرُّ في `tracking_sessions`
     *     بعدَ `update ... returning` الذرّيّةِ — لا عدّادٌ في العمليةِ.
     * (٢) أنَّ الصفَّ نفسَه صار `ended_at`/`end_reason = EXPIRED`، فالإغلاقُ والنشرُ
     *     شيءٌ واحدٌ لا شيئان قد ينفصلان.
     * (٣) أنَّ النهايةَ تسبق بدايةَ الخَلَفِ في ما يراه مستهلكٌ مشتركٌ فعلاً.
     *
     * والبدايةُ تُبعَد خلفَ السقفِ **في القاعدةِ نفسِها** لا بساعةٍ مزوّرةٍ في
     * العمليةِ: الحكمُ يُقرأ من الصفِّ، فتزويرُ الساعةِ يختبر غيرَ ما يجري.
     */
    const driverId = await seedDriver(DRIVER_CHAT);
    await postLocation(DRIVER_CHAT, 0);
    const before = await sessionsOf(driverId);
    expect(before).toHaveLength(1);
    const firstId = before[0]?.id;
    if (firstId === undefined) throw new Error("لم تُفتح جلسةٌ أولى");

    await sql`
      update tracking_sessions
         set started_at = now() - interval '13 hours',
             last_fix_at = now() - interval '13 hours'
       where id = ${firstId}::uuid
    `;
    events = [];

    await postLocation(DRIVER_CHAT, 0);

    const closed = await sql<{ end_reason: string | null; last_sequence: number }[]>`
      select end_reason, last_sequence from tracking_sessions where id = ${firstId}::uuid
    `;
    expect(closed[0]?.end_reason).toBe("EXPIRED");

    const rows = await sessionsOf(driverId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === firstId)?.ended_at).not.toBeNull();
    expect(rows.find((row) => row.id !== firstId)?.ended_at).toBeNull();

    const ended = events.filter((event) => event.type === "session_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.sessionId).toBe(firstId);
    expect(ended[0]?.metadata?.reason).toBe("EXPIRED");
    expect(ended[0]?.sequence).toBe(closed[0]?.last_sequence);

    const types = events.map((event) => event.type);
    expect(types.indexOf("session_ended")).toBeLessThan(types.indexOf("session_started"));
  });
});
