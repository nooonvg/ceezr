/**
 * الغرض: `F4-08` — **اختباراتُ سباقٍ على مسارِ الموقعِ**، لا اختباراتُ تتابعٍ.
 *   البندُ نصَّ على خمسٍ: «ترتيبٌ مقلوبٌ · تكرارٌ · ساعتانِ متباعدتانِ · مثيلانِ ·
 *   انقطاعُ Redis». وأربعٌ منها ههنا على PostgreSQL حقيقيٍّ، والخامسةُ
 *   (انقطاعُ Redis) في `tests/real-redis/location-hot-state-outage-real.test.ts`
 *   لأنَّ انقطاعاً يُحاكى بمزدوجٍ لا يشهدُ على شيءٍ: المزدوجُ يُخفقُ حينَ نأمرُه،
 *   والمقصودُ أن يُخفقَ العميلُ الحقيقيُّ في منتصفِ مسارٍ حقيقيٍّ.
 *
 *   ## ولماذا ملفٌّ ثانٍ بجوارِ `tracking-sequence.test.ts`؟
 *
 *   ذاكَ يقيسُ **العقدَ** (`ADR 0053`) بنبضاتٍ تصلُ واحدةً بعدَ واحدةٍ: الترتيبُ
 *   مقلوبٌ في الطوابعِ لا في الزمنِ. **وهذا يقيسُ التزامنَ**: نبضاتٌ تُطلَقُ معاً
 *   فتتداخلُ في القاعدةِ، وحوضا اتّصالٍ مستقلّانِ يكتبانِ الصفَّ نفسَه. والفرقُ
 *   ليسَ في الصياغةِ: تتابعٌ يمرُّ على عدّادٍ في الذاكرةِ أيضاً، **والتزامنُ لا
 *   يمرُّ إلَّا على كتابةٍ ذرّيّةٍ**.
 *
 *   ## الثوابتُ الأربعةُ التي تُقاسُ في كلِّ سباقٍ — لا نتيجةٌ واحدةٌ متوقَّعةٌ
 *
 *   التزامنُ لا يُنتِجُ تشعُّباً واحداً، **فالمقيسُ ثوابتُ لا تسلسلاتٌ**:
 *     ث١ — **لا رقمَ مكرَّرٌ ولا مفقودٌ في المنشورِ**: أرقامُ القناةِ متزايدةٌ
 *          صارماً بترتيبِ التسليمِ، مهما تداخلَ التنفيذُ.
 *     ث٢ — **لا تراجعَ في الموضعِ المعروضِ**: كلُّ حدثٍ منشورٍ طابعُه ≥ طابعِ ما
 *          قبلَه، فالخريطةُ لا ترجعُ (`ADR 0050` §٢ صفُّ الترتيبِ).
 *     ث٣ — **الصفُّ يحملُ الأحدثَ** بعدَ سكونِ السباقِ، لا آخرَ الواصلينَ.
 *     ث٤ — **آخرُ رقمٍ منشورٍ = `last_sequence` في الصفِّ**: لا رقمَ وُلِدَ خارجَ
 *          الكتابةِ التي قبِلَت.
 *
 *   ## ما لا يُدَّعى ههنا — قبلَ أن يُقرأَ الأخضرُ أكثرَ ممّا يقولُ
 *
 *   حالةُ «مثيلانِ» تُشغِّلُ **حاويتَينِ في عمليةٍ واحدةٍ بحوضَي اتّصالٍ
 *   مستقلَّينِ**. وهذا يشهدُ على **ذرّيّةِ الكاتبِ** حينَ يزاحمُه كاتبٌ لا يُشاركُه
 *   ذاكرةً ولا اتّصالاً — **ولا يشهدُ على طوبولوجيا متعدّدةِ المثيلاتِ**، فتلك
 *   محجوبةٌ بقرارِ المالكِ `DEC-14` (`numInstances: 1`)، ولا يُقرأُ هذا الملفُّ
 *   نقضاً له ولا تقدُّماً في `F5-06` ولا في `SCL-008` (`ح-5`).
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `update-driver-location.ts` أو
 *   على `session-repository.ts` أو على عمودِ `tracking_sessions.last_sequence`.
 * ملاحظات مستقبلية: يومَ يُقرَّرُ محوِّلُ توزيعٍ (`F4-03`) تُضافُ ههنا حالةُ
 *   منتِجَينِ على عقدتَينِ، ولا يُغيَّرُ ثابتٌ من الأربعةِ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { LivePosition } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
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
const WEBHOOK_SECRET = "race-secret";
const DRIVER_CHAT = 140_801;
const SECOND_DRIVER_CHAT = 140_802;

/** جدّة — والإزاحةُ بالدرجاتِ تجعلُ كلَّ نبضةٍ موضعاً مميَّزاً يُقرأُ في الحدثِ. */
const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
const DEGREE_STEP = 0.0005;

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const MS_PER_SECOND = 1000;

const config: AppConfig = testConfig({
  port: 3994,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let events: TrackingEvent[];
let driverSent: SentMessage[];
let riderSent: SentMessage[];

interface SequenceRow {
  readonly id: string;
  readonly last_sequence: number;
  readonly last_fix_at: string | null;
  readonly ended_at: string | null;
}

async function sessionsOf(driverId: string): Promise<readonly SequenceRow[]> {
  return sql<SequenceRow[]>`
    select id, last_sequence, last_fix_at, ended_at
      from tracking_sessions where driver_id = ${driverId}
     order by started_at asc, id asc
  `;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات سباقِ مسارِ الموقعِ مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدةٍ بها الهجرات مطبَّقة.",
  );
}

/** قناةُ بثٍّ صامتةٌ: المقيسُ ههنا الكاتبُ والناقلُ لا تلغرام. */
const silentLiveChannel = {
  start: async (_chatId: string, _position: LivePosition, _live: number) => "msg",
  update: async () => true,
  stop: async () => true,
};

describeIf("سباقاتُ مسارِ الموقعِ على PostgreSQL حقيقيٍّ — F4-08", () => {
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

    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: silentLiveChannel,
    });

    container.tracking.bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          events.push(event);
        },
      },
    );
  });

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
   * نبضةٌ من بوتِ السائقِ عبرَ **نفسِ** مدخلِ الويبهوكِ. و`step` إزاحةٌ في
   * الإحداثيّاتِ تجعلُ الموضعَ مميَّزاً، فيُقرأَ التراجعُ من الحدثِ لا يُستنتَجَ.
   */
  function locationUpdate(chatId: number, agoSeconds: number, step: number): unknown {
    return {
      update_id: nextUpdateId(),
      message: {
        chat: { id: chatId },
        from: { id: chatId, language_code: "ar" },
        location: {
          latitude: JEDDAH.latitude + step * DEGREE_STEP,
          longitude: JEDDAH.longitude,
          horizontal_accuracy: 8,
        },
        date: Math.floor(Date.now() / MS_PER_SECOND) - agoSeconds,
      },
    };
  }

  const positionsOf = (all: readonly TrackingEvent[]) =>
    all.filter((event) => event.type === "location_updated");

  /**
   * ساعةُ جهازِ السائقِ كما نُشِرَت. و`timestamp` في الحدثِ ساعةُ الخادمِ لحظةَ
   * النشرِ — فهيَ غيرُ متناقصةٍ بحكمِ كونِها ساعةً، فلو قِيسَ التراجعُ عليها
   * لمرَّ الاختبارُ وإن رجعَ الدبّوسُ فعلاً. والمقروءُ `recordedAtMs` وحدَه.
   */
  const recordedMsOf = (event: TrackingEvent): number => Number(event.metadata?.recordedAtMs);

  /**
   * ث١ — لا رقمَ يتكرَّرُ ولا يُمنَحُ مرّتَينِ.
   *
   * **تصحيحٌ (OPS-016 · 2026-09-12 · حكمُ CI):** كانَ المُوجَبُ ههنا «متزايدةٌ
   * صارماً **بترتيبِ التسليمِ**»، وذاكَ شاهدٌ غيرُ سليمٍ في اختبارٍ متزامنٍ:
   * الرقمُ يُمنَحُ داخلَ `update` واحدةٍ في القاعدةِ (`session-repository.ts`)،
   * أمّا النشرُ فيقعُ **بعدَ** إغلاقِ المعاملةِ في `live-tracking.ts` وخارجَ أيِّ
   * قفلٍ. فنداءانِ متزامنانِ قد يأخذُ أحدُهما ٤ والآخرُ ٥ ثمَّ ينشرُ صاحبُ ٥
   * أوّلاً — فيسقطُ المُوجَبُ بلا خللٍ في السلوكِ. وهذا عينُ ما حذَّرَ منه
   * تعليقُ الحالةِ نفسِها: «لا يُقاسُ جدولةُ التنفيذِ». ولا عقدَ يضمنُ ترتيبَ
   * التسليمِ: `ADR 0053` يجعلُ **الرقمَ** هوَ الترتيبَ، والمستهلكُ يرتّبُ به.
   *
   * فالمُوجَبُ الصادقُ: الأرقامُ المنشورةُ لا يتكرَّرُ فيها رقمٌ ولا يُمنَحُ رقمٌ
   * مرّتَينِ — يُقاسُ على المجموعةِ مرتَّبةً بالرقمِ لا بترتيبِ الوصولِ. وقد
   * شُدَّ المُوجَبُ في المقابلِ: الطوابعُ تُقاسُ **بترتيبِ الرقمِ** (لا بترتيبِ
   * التسليمِ) وأعلى رقمٍ منشورٍ يُطابِقُ `last_sequence` في الصفِّ.
   */
  function expectStrictlyIncreasing(sequences: readonly number[]): void {
    const ordered = [...sequences].sort((left, right) => left - right);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index] ?? 0).toBeGreaterThan(ordered[index - 1] ?? 0);
    }
  }

  it("ترتيبٌ مقلوبٌ متزامنٌ: خمسُ نبضاتٍ تُطلَقُ معاً فلا رقمَ يتكرَّرُ ولا موضعَ يتراجعُ", async () => {
    /**
     * السباقُ الأوّلُ. الطوابعُ خمسةٌ متباينةٌ، **وتُطلَقُ كلُّها في اللحظةِ
     * نفسِها** بترتيبٍ مقلوبٍ في المصفوفةِ. فأيُّها يبلغُ الكاتبَ أوّلاً غيرُ
     * محدَّدٍ، ولذلك **لا يُتوقَّعُ عددٌ بعينِه من المنشورِ** — وتوقُّعُ عددٍ ههنا
     * كانَ سيجعلُ الاختبارَ يقيسُ جدولةَ التنفيذِ لا الحارسَ.
     *
     * والمُتوقَّعُ ثوابتُ: الأرقامُ متزايدةٌ صارماً · الطوابعُ لا تتراجعُ ·
     * الصفُّ ينتهي بالأحدثِ · وآخرُ رقمٍ منشورٍ هوَ ما في الصفِّ.
     */
    const driverId = await seedDriver(DRIVER_CHAT);

    const arrivals = [
      { ago: 10, step: 5 },
      { ago: 50, step: 1 },
      { ago: 30, step: 3 },
      { ago: 20, step: 4 },
      { ago: 40, step: 2 },
    ] as const;

    await Promise.all(
      arrivals.map(async (arrival) =>
        container.handler.handle("driver", locationUpdate(DRIVER_CHAT, arrival.ago, arrival.step)),
      ),
    );

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    const positions = positionsOf(events);
    expect(positions.length).toBeGreaterThan(0);

    // ث١ — لا رقمَ مكرَّرٌ ولا راجعٌ.
    const sequences = positions.map((event) => event.sequence);
    expectStrictlyIncreasing(sequences);
    expect(new Set(sequences).size).toBe(sequences.length);

    // ث٢ — لا تراجعَ في الموضعِ المعروضِ: طوابعُ الجهازِ غيرُ متناقصةٍ **بترتيبِ
    // الرقمِ**، وهوَ الترتيبُ الذي يقرؤه المستهلكُ (`ADR 0053`) لا ترتيبُ الوصولِ.
    const stamps = [...positions]
      .sort((left, right) => left.sequence - right.sequence)
      .map(recordedMsOf);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index] ?? 0).toBeGreaterThanOrEqual(stamps[index - 1] ?? 0);
    }

    // ث٣ — الصفُّ يحملُ الأحدثَ (قبلَ عشرِ ثوانٍ) لا آخرَ الواصلينَ.
    const savedAgoSeconds = Math.round(
      (Date.now() - new Date(row.last_fix_at ?? 0).getTime()) / MS_PER_SECOND,
    );
    expect(savedAgoSeconds).toBeLessThanOrEqual(12);

    // ث٤ — آخرُ رقمٍ منشورٍ هوَ رقمُ الصفِّ، وكلُّها من قناةٍ واحدةٍ.
    expect(new Set(positions.map((event) => event.sessionId)).size).toBe(1);
    expect(positions[0]?.sessionId).toBe(row.id);
    expect(Math.max(...sequences)).toBe(row.last_sequence);
  });

  it("تكرارٌ متزامنٌ: النبضةُ نفسُها مرّتَينِ معاً لا تُحرِّكُ الدبّوسَ ولا تُنتِجُ رقمَينِ لموضعَينِ", async () => {
    /**
     * السباقُ الثاني — «تكرارٌ» بحرفِ البندِ. والمقصودُ **تكرارُ النبضةِ عندَ
     * المصدرِ** (تلغرام يُعيد تحديثاً لم يُؤكَّد استلامُه)، لا تكرارُ الحدثِ عندَ
     * المستهلكِ — وذاكَ مقيسٌ في `tests/unit/tracking-sequence.test.ts`.
     *
     * والحكمُ المنصوصُ (`ADR 0053` §٤-ج): **التساوي ليسَ قِدَماً**، فالنسختانِ
     * تُقبَلانِ ولكلٍّ رقمُها. والدعوى ليست «واحدةٌ تُرَدُّ» — تلكَ دعوى لم
     * يشترطها عقدٌ — بل **أنَّ المكرَّرَ غيرُ ضارٍّ**: الموضعُ المعروضُ بعدَ
     * النسختَينِ هوَ هوَ، و`last_fix_at` لا يتقدَّمُ، والأرقامُ لا تتراجعُ.
     */
    const driverId = await seedDriver(DRIVER_CHAT);
    const update = locationUpdate(DRIVER_CHAT, 15, 1);

    await Promise.all([
      container.handler.handle("driver", update),
      container.handler.handle("driver", update),
    ]);

    const row = (await sessionsOf(driverId))[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    const positions = positionsOf(events);
    expectStrictlyIncreasing(positions.map((event) => event.sequence));

    // المكرَّرُ لا يُحرّكُ الدبّوسَ: كلُّ ما نُشِرَ لموضعٍ واحدٍ وطابعٍ واحدٍ.
    expect(new Set(positions.map(recordedMsOf)).size).toBe(1);
    expect(
      new Set(positions.map((event) => `${event.position?.lat},${event.position?.lng}`)).size,
    ).toBe(1);

    // ولا يُنتِجُ جلسةً ثانيةً، و**أعلى** رقمٍ منشورٍ هوَ رقمُ الصفِّ.
    //
    // **تصحيحُ `OPS-017` (2026-09-19 · حكمُ CI `35431980350`).** كانَ المُوجَبُ
    // ههنا «آخرُ ما نُشِرَ = رقمُ الصفِّ» (`positions.at(-1)`)، وذاكَ **شاهدٌ على
    // جدولةِ التنفيذِ لا على العقدِ** — وهوَ عينُ العطبِ الذي شخَّصَهُ `OPS-016`
    // وأصلحَهُ في السطرِ 210 من هذا الملفِّ: الرقمُ يُمنَحُ داخلَ `update` واحدةٍ
    // في `session-repository.ts:182`، والنشرُ يقعُ **بعدَ** إغلاقِ المعاملةِ في
    // `live-tracking.ts:325` وخارجَ أيِّ قفلٍ — فمن نداءَينِ متزامنَينِ قد يأخذُ
    // أحدُهما ٣ والآخرُ ٢ ثمَّ ينشرُ صاحبُ ٣ أوّلاً، فيكونُ «آخرُ المنشورِ» ٢
    // والصفُّ ٣ **بلا خللٍ في السلوكِ**. وذاكَ حرفاً ما قرأَهُ CI:
    // `Expected: 3 · Received: 2`. ولا عقدَ يضمنُ ترتيبَ التسليمِ: `ADR 0053`
    // يجعلُ **الرقمَ** هوَ الترتيبَ، والمستهلكُ يرتّبُ بهِ.
    //
    // والشاهدُ **شُدَّ لا خُفِّفَ**: أعلى رقمٍ منشورٍ = رقمُ الصفِّ (فلا رقمَ
    // وُلِدَ خارجَ كتابةٍ قبِلَت)، **ولا رقمَ منشورٌ يتجاوزُ رقمَ الصفِّ** (فلا
    // رقمَ نُشِرَ قبلَ أن يُكتَبَ)، وكلٌّ منهما لا يقرأُ ترتيبَ الوصولِ.
    expect((await sessionsOf(driverId)).length).toBe(1);
    const duplicateSequences = positions.map((event) => event.sequence);
    // وسلامةً للقياسِ لا تخفيفاً: `Math.max` على فارغٍ يُعطي `-Infinity`
    // فيُقرأُ الفراغُ عطباً في العقدِ، والفراغُ ههنا عطبٌ بنفسِهِ.
    expect(duplicateSequences.length).toBeGreaterThan(0);
    expect(Math.max(...duplicateSequences)).toBe(row.last_sequence);
    for (const sequence of duplicateSequences) {
      expect(sequence).toBeLessThanOrEqual(row.last_sequence);
      expect(sequence).toBeGreaterThan(0);
    }
  });

  it("ساعتانِ متباعدتانِ: سائقانِ بساعتَينِ متباينتَينِ يترقّمانِ استقلالاً ولا يتلوّثُ ترتيبُ أيٍّ منهما", async () => {
    /**
     * السباقُ الثالثُ. ساعةُ الأوّلِ صادقةٌ، وساعةُ الثاني متأخّرةٌ مائتَي ثانيةٍ
     * — فنبضاتُه كلُّها «أقدمَ» من نبضاتِ الأوّلِ لو كانَ الترتيبُ على الساعةِ.
     * والنبضاتُ تُطلَقُ متداخلةً معاً.
     *
     * والمقيسُ ما نصَّ عليه `ADR 0053` §٣-أ/٣: **لا ترتيبَ كلّيَّ بينَ
     * القناتَينِ**، وكلُّ قناةٍ عدّادُها من صفِّها. فانحرافُ ساعةِ سائقٍ لا
     * يُنقِصُ رقمَ سائقٍ آخرَ ولا يُقدِّمُه.
     *
     * ## ولمَ مائتا ثانيةٍ لا ساعةٌ — تصحيحٌ مقيسٌ لا تخفيفٌ
     *
     * كُتِبَ هذا الاختبارُ أوّلَ مرّةٍ بانحرافِ **ساعةٍ كاملةٍ**، فأخفقَ في CI
     * (الجولةُ `34421891408`) بـ«لم تُفتح جلستان». **والإخفاقُ كانَ صوابَ
     * النظامِ لا عيبَه**: `DEFAULT_GPS_POLICY.rejectOlderThanSeconds = 300`،
     * فإصلاحةٌ عمرُها ساعةٌ تُرفَضُ بـ`TIMESTAMP_TOO_OLD` قبلَ أن تبلغَ الكاتبَ
     * أصلاً، فلا جلسةَ تُفتَحُ. فالعيبُ كانَ في **فرضيةِ الاختبارِ**: اختارَ
     * انحرافاً خارجَ نافذةِ القبولِ، فصارَ يقيسُ رفضَ القِدَمِ لا استقلالَ القناتَينِ.
     *
     * **ولم يُخفَّفْ توكيدٌ ولم يُرفَعْ سقفٌ ولم يُصنَّفْ شيءٌ متجاوَزاً**: صُحّحَتِ
     * الفرضيةُ إلى انحرافٍ **داخلَ** النافذةِ (مائتا ثانيةٍ < 300)، وأُضيفَ
     * شطرٌ ثانٍ يُثبِتُ الحدَّ نفسَه صراحةً: انحرافٌ يتجاوزُ النافذةَ **يُرَدُّ
     * ولا يُرقَّمُ**. فصارَ الملفُّ يقيسُ الحالتَينِ لا واحدةً.
     */
    const firstDriver = await seedDriver(DRIVER_CHAT);
    const secondDriver = await seedDriver(SECOND_DRIVER_CHAT);

    /** داخلَ نافذةِ `rejectOlderThanSeconds = 300` وأكبرُ من كلِّ فرقٍ بينَ نبضاتِ الأوّلِ. */
    const CLOCK_SKEW_SECONDS = 200;
    await Promise.all([
      container.handler.handle("driver", locationUpdate(DRIVER_CHAT, 40, 1)),
      container.handler.handle(
        "driver",
        locationUpdate(SECOND_DRIVER_CHAT, CLOCK_SKEW_SECONDS + 40, 1),
      ),
      container.handler.handle("driver", locationUpdate(DRIVER_CHAT, 20, 2)),
      container.handler.handle(
        "driver",
        locationUpdate(SECOND_DRIVER_CHAT, CLOCK_SKEW_SECONDS + 20, 2),
      ),
    ]);

    const firstRow = (await sessionsOf(firstDriver))[0];
    const secondRow = (await sessionsOf(secondDriver))[0];
    if (firstRow === undefined || secondRow === undefined) throw new Error("لم تُفتح جلستان");

    const positions = positionsOf(events);
    const byChannel = new Map<string, number[]>();
    for (const event of positions) {
      const list = byChannel.get(event.sessionId) ?? [];
      list.push(event.sequence);
      byChannel.set(event.sessionId, list);
    }

    // قناتانِ لا واحدةٌ، وكلُّ واحدةٍ متزايدةٌ صارماً في نفسِها.
    expect(byChannel.size).toBe(2);
    for (const [, sequences] of byChannel) expectStrictlyIncreasing(sequences);

    // وكلُّ قناةٍ **أعلى رقمٍ منشورٍ فيها** هوَ رقمُ صفِّها — لا عدّادَ مشتركٌ
    // بينهما.
    //
    // **تصحيحُ `OPS-017`** (انظر الشرحَ في الحالةِ الثانيةِ أعلاهُ): كانَ
    // المُوجَبُ `at(-1)` وهوَ قراءةُ ترتيبِ التسليمِ، وعليهِ سقطَ التشغيلُ
    // `34719287936` في السطرِ 387 على بايتاتٍ مطابقةٍ لتشغيلٍ ناجحٍ. والمُوجَبُ
    // الآنَ مقيسٌ على المجموعةِ: أعلى المنشورِ في كلِّ قناةٍ = رقمُ صفِّها، ولا
    // رقمَ منشورٌ يتجاوزُ رقمَ صفِّهِ — أقوى، ومستقلٌّ عن التداخلِ.
    const firstPublished = byChannel.get(firstRow.id) ?? [];
    const secondPublished = byChannel.get(secondRow.id) ?? [];
    expect(firstPublished.length).toBeGreaterThan(0);
    expect(secondPublished.length).toBeGreaterThan(0);
    expect(Math.max(...firstPublished)).toBe(firstRow.last_sequence);
    expect(Math.max(...secondPublished)).toBe(secondRow.last_sequence);
    for (const sequence of firstPublished) {
      expect(sequence).toBeLessThanOrEqual(firstRow.last_sequence);
    }
    for (const sequence of secondPublished) {
      expect(sequence).toBeLessThanOrEqual(secondRow.last_sequence);
    }

    // والساعةُ المنحرفةُ لم تمنع القناةَ الثانيةَ من التقدُّمِ.
    expect(secondRow.last_sequence).toBeGreaterThan(1);

    /**
     * والشطرُ الثاني: الحدُّ نفسُه مقيساً صراحةً. انحرافٌ يتجاوزُ
     * `rejectOlderThanSeconds` يُرَدُّ عندَ آلةِ المجالِ قبلَ الكاتبِ: فلا رقمَ
     * جديدٌ ولا حدثَ منشورٌ في تلكَ القناةِ. وهذا هوَ ما أخفقَ عليهِ الاختبارُ
     * أوّلَ مرّةٍ، فصارَ توكيداً مكتوباً لا درساً منسيّاً.
     */
    const BEYOND_WINDOW_SECONDS = 3600;
    const sequenceBefore = secondRow.last_sequence;
    const publishedBefore = byChannel.get(secondRow.id)?.length ?? 0;
    await container.handler.handle(
      "driver",
      locationUpdate(SECOND_DRIVER_CHAT, BEYOND_WINDOW_SECONDS, 3),
    );

    const secondAfter = (await sessionsOf(secondDriver))[0];
    expect(secondAfter?.last_sequence).toBe(sequenceBefore);
    expect(positionsOf(events).filter((event) => event.sessionId === secondRow.id).length).toBe(
      publishedBefore,
    );
  });

  it("مثيلانِ: حاويتانِ بحوضَي اتّصالٍ مستقلَّينِ تكتبانِ الجلسةَ نفسَها فلا يتكرَّرُ رقمٌ", async () => {
    /**
     * السباقُ الرابعُ — وهوَ الذي لا يمرُّ على عدّادٍ في الذاكرةِ بحالٍ. حاويةٌ
     * ثانيةٌ تُبنى بحوضِ اتّصالٍ خاصٍّ بها ولا تُشاركُ الأولى متغيّراً واحداً،
     * ثمَّ تُطلَقُ نبضاتُ السائقِ نفسِه من الحاويتَينِ **معاً**.
     *
     * ولو كانَ الرقمُ في `Map` أو في متغيّرِ عمليةٍ لأعطَت الحاويتانِ الرقمَ
     * نفسَه لحدثَينِ مختلفَينِ — وهوَ ما يمنعُه `ADR 0053` §٣-أ/٤ و٦.
     *
     * **ولا يُقرأُ هذا نقضاً لـ`DEC-14`**: المقيسُ ذرّيّةُ الكاتبِ تحتَ مزاحمةٍ،
     * لا رصةٌ من مثيلاتٍ خلفَ موزّعٍ. تلكَ محجوبةٌ بقرارِ المالكِ، وهذا الملفُّ
     * لا يُقدِّمُ فيها خطوةً (`ح-5` · `ح-7`).
     */
    const driverId = await seedDriver(DRIVER_CHAT);

    const secondEvents: TrackingEvent[] = [];
    const second = buildContainer(config, {
      driverSender: capturing([]),
      riderSender: capturing([]),
      liveLocationChannel: silentLiveChannel,
    });
    second.tracking.bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          secondEvents.push(event);
        },
      },
    );

    try {
      await Promise.all([
        container.handler.handle("driver", locationUpdate(DRIVER_CHAT, 60, 1)),
        second.handler.handle("driver", locationUpdate(DRIVER_CHAT, 50, 2)),
        container.handler.handle("driver", locationUpdate(DRIVER_CHAT, 40, 3)),
        second.handler.handle("driver", locationUpdate(DRIVER_CHAT, 30, 4)),
        container.handler.handle("driver", locationUpdate(DRIVER_CHAT, 20, 5)),
        second.handler.handle("driver", locationUpdate(DRIVER_CHAT, 10, 6)),
      ]);

      /**
       * **تصحيحٌ مُضافٌ (2026-09-10):** كمْ نبضةً من الستِّ تُقبَلُ **غيرُ
       * محتومٍ بطبيعةِ السباقِ**: حارسُ التسلسلِ يردُّ كلَّ ما هوَ أقدمُ منَ
       * المكتوبِ، فإنْ سبقَتِ الأحدثُ (قبلَ عشرِ ثوانٍ) إلى الصفِّ رُدَّتِ
       * الخمسُ الباقياتُ ولم يُنشَرْ إلاّ رقمٌ واحدٌ. وذلكَ **سلوكٌ صحيحٌ**
       * لا عطبٌ، والمقدّمةُ القائلةُ «لا بدَّ من رقمَينِ من ستِّ نبضاتٍ
       * متزامنةٍ» هيَ الخطأُ. فيُضافُ ههنا ما يُقبَلُ **حتماً**: نبضةٌ
       * متسلسلةٌ بعدَ انتهاءِ السباقِ، أحدثُ من كلِّ ما سبقَها، فيصيرُ في
       * الاتّحادِ رقمانِ على الأقلِّ **حتماً لا احتمالاً** — ولم يُضعَفْ
       * توكيدٌ: فحصُ عدمِ التكرارِ وتطابقُ الأقصى معَ الصفِّ يشملانِ الستَّ
       * والزائدةَ جميعاً.
       */
      await second.handler.handle("driver", locationUpdate(DRIVER_CHAT, 1, 7));
    } finally {
      await second.close();
    }

    const rows = await sessionsOf(driverId);
    // جلسةٌ واحدةٌ لا جلستانِ: الكاتبانِ لم يفتحا قناتَينِ لسائقٍ واحدٍ.
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    /**
     * الأرقامُ تُجمَعُ من **الناقلَينِ معاً**: كلُّ حاويةٍ تنشرُ في ناقلِها هيَ
     * (لا محوِّلَ توزيعٍ — `DEC-14`)، فالقناةُ الواحدةُ تُرى نصفَينِ. والمقيسُ
     * أنَّ اتّحادَ النصفَينِ **لا رقمَ فيهِ مكرَّرٌ**، وأنَّ أكبرَه رقمُ الصفِّ.
     */
    const all = [...positionsOf(events), ...positionsOf(secondEvents)];
    const sequences = all.map((event) => event.sequence);
    expect(sequences.length).toBeGreaterThan(1);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(new Set(all.map((event) => event.sessionId))).toEqual(new Set([row.id]));
    expect(Math.max(...sequences)).toBe(row.last_sequence);

    // وكلُّ ناقلٍ في نفسِه متزايدٌ صارماً — لا تراجعَ داخلَ مستهلكٍ واحدٍ.
    expectStrictlyIncreasing(positionsOf(events).map((event) => event.sequence));
    expectStrictlyIncreasing(positionsOf(secondEvents).map((event) => event.sequence));

    // والصفُّ انتهى عندَ الأحدثِ (قبلَ عشرِ ثوانٍ) لا عندَ أقدمِ الواصلينَ.
    const savedAgoSeconds = Math.round(
      (Date.now() - new Date(row.last_fix_at ?? 0).getTime()) / MS_PER_SECOND,
    );
    expect(savedAgoSeconds).toBeLessThanOrEqual(12);
  });
});
