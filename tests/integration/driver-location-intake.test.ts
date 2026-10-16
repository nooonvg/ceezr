/**
 * الغرض: `F4-01` — إثباتُ مسارِ استقبالِ الموقعِ **كاملاً** على قاعدةِ PostgreSQL
 *   حقيقيّةٍ: من طلبِ HTTP بجلسةٍ موقَّعةٍ، عبرَ المصادقةِ الحقيقيّةِ، إلى الدليلِ
 *   الحقيقيِّ، إلى الحارسِ الشرطيِّ في القاعدةِ، ثمَّ إلى الصفِّ القانونيِّ.
 *
 *   والادّعاءُ المُختبَرُ ما لا تُثبتُه قراءةُ كودٍ ولا مزدوجٌ:
 *   (١) أنَّ نبضةً مقبولةً تُغيِّرُ الصفَّ فعلاً بالموضعِ والطابعِ والحكمِ معاً.
 *   (٢) أنَّ **نبضاتٍ مختلطةَ الترتيبِ** — كما تصلُ من شبكةِ هاتفٍ — لا تُرجِعُ
 *       الموضعَ القانونيَّ إلى الوراءِ: الأقدمُ يُجابُ عنه بـ`STALE` والصفُّ ثابتٌ.
 *       وهذا هوَ انحدارُ `BUG-001` مقيساً على السطحِ الجديدِ لا على المنفذِ وحدَه.
 *   (٣) أنَّ التفويضَ من الرمزِ لا من الجسمِ: معرّفٌ مدسوسٌ في الجسمِ لا يكتبُ
 *       على صفِّ سائقٍ آخرَ موجودٍ في القاعدةِ.
 *   (٤) أنَّ صاحبَ جلسةٍ صحيحةٍ بلا صفِّ سائقٍ لا يُنشَأُ له صفٌّ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const SESSION_SECRET = "integration-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "integration-webhook-secret-value";

/**
 * «الآنَ» مثبَّتٌ: سياسةُ المجالِ تحكمُ بالقِدَمِ نسبةً إلى الساعةِ، فلو تُرِكَت
 * ساعةُ الجهازِ لصارَ الملفُّ يسقطُ أو ينجحُ بحسبِ متى شُغِّلَ.
 */
const NOW = new Date("2027-03-01T09:00:00.000Z");
const T_OLD = NOW.getTime() - 20_000;
const T_NEW = NOW.getTime() - 5_000;

const AT_A = { latitude: 21.5471, longitude: 39.1751 } as const;
const AT_B = { latitude: 21.5478, longitude: 39.1759 } as const;

const DRIVER_TELEGRAM = "861001";
const OTHER_TELEGRAM = "861002";

let sql: Sql;
let cityId: string;
let driverId: DriverId;
let otherDriverId: DriverId;
let app: ReturnType<typeof createServer>;

interface Stored {
  readonly lat: number | null;
  readonly recordedAtMs: number | null;
  readonly accuracy: number | null;
  readonly quality: string | null;
}

async function stored(id: DriverId): Promise<Stored> {
  const rows = await sql<
    {
      lat: number | null;
      recorded: Date | null;
      accuracy: number | null;
      quality: string | null;
    }[]
  >`
    select st_y(last_location::geometry) as lat,
           last_location_recorded_at as recorded,
           last_location_accuracy_m as accuracy,
           last_location_quality as quality
      from drivers where id = ${id}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لم يُقرأ السائق");
  return {
    lat: row.lat,
    recordedAtMs: row.recorded === null ? null : row.recorded.getTime(),
    accuracy: row.accuracy,
    quality: row.quality,
  };
}

async function seedDriver(telegramId: string, name: string): Promise<DriverId> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${telegramId}::bigint, ${name}, ${`+96650${telegramId}`},
            'driver'::user_role, 'ar')
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${userId}, 'verified'::verification_status)
    returning id
  `;
  const created = drivers[0]?.id;
  if (created === undefined) throw new Error("تعذّر إنشاء السائق");
  // التوفُّرُ صفٌّ مستقلٌّ في `driver_availability` لا عمودٌ في `drivers`،
  // والسائقُ المُتاحُ هوَ حالُ الاستقبالِ الطبيعيَّةُ.
  await sql`
    insert into driver_availability (city_id, driver_id, is_available)
    values (${cityId}, ${created}, true)
  `;
  return created as DriverId;
}

function tokenFor(telegramUserId: string): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "driver", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

async function ping(
  body: Record<string, unknown>,
  telegramUserId: string = DRIVER_TELEGRAM,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await app.fetch(
    new Request("http://localhost/v1/driver/location", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokenFor(telegramUserId)}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("F4-01 — استقبالُ الموقعِ من HTTP إلى الصفِّ القانونيِّ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;

    /**
     * التركيبُ **بالمحوّلاتِ الإنتاجيّةِ نفسِها**: دليلٌ حقيقيٌّ على القاعدةِ،
     * وقارئُ حساباتٍ حقيقيٌّ، وقارئُ جلساتٍ حقيقيٌّ. والمُصطنَعُ ههنا شيئانِ
     * مُعلَنانِ: الساعةُ (لتثبيتِ الحكمِ) وغيابُ البثِّ وإعادةِ العرضِ — ولهما
     * اختباراتُهما، وليسا موضوعَ هذا الملفِّ.
     */
    const directory = createDriverDirectory(sql);
    app = createServer({
      health: { now: () => NOW, startedAt: NOW, env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
      driverLocation: {
        viewer: {
          sessions: createMiniAppSessionReader(SESSION_SECRET),
          accounts: createViewerAccountReader(sql),
          now: () => NOW,
        },
        drivers: directory,
        ingest: { drivers: directory, clock: { now: () => NOW } },
      },
    });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    driverId = await seedDriver(DRIVER_TELEGRAM, "سائقُ الاستقبالِ");
    otherDriverId = await seedDriver(OTHER_TELEGRAM, "سائقٌ آخرُ");
  });

  it("١ — نبضةٌ مقبولةٌ تكتبُ الموضعَ والدقّةَ والحكمَ في الصفِّ القانونيِّ", async () => {
    const response = await ping({ ...AT_A, accuracyMeters: 9, recordedAtMs: T_NEW });

    expect(response.status).toBe(200);
    expect(response.json.accepted).toBe(true);
    expect(response.json.recordedAtMs).toBe(T_NEW);

    const row = await stored(driverId);
    expect(row.lat).toBeCloseTo(AT_A.latitude, 5);
    expect(row.recordedAtMs).toBe(T_NEW);
    expect(row.accuracy).toBe(9);
    expect(row.quality).toBe("ACCEPT");
  });

  /**
   * انحدارُ `BUG-001` مقيساً على السطحِ الجديدِ: أربعُ نبضاتٍ **مختلطةِ الترتيبِ**
   * كما تصلُ من شبكةٍ متقطّعةٍ. المطلوبُ أن يستقرَّ الصفُّ على الأحدثِ طابعاً لا
   * على آخرِ واصلٍ، وأن يكونَ الرفضُ **جواباً** لا صمتاً.
   */
  it("٢ — نبضاتٌ مختلطةُ الترتيبِ لا تُرجِعُ الموضعَ إلى الوراءِ", async () => {
    const newest = await ping({ ...AT_B, accuracyMeters: 6, recordedAtMs: T_NEW });
    expect(newest.status).toBe(200);
    expect(newest.json.accepted).toBe(true);

    const late = await ping({ ...AT_A, accuracyMeters: 3, recordedAtMs: T_OLD });
    expect(late.status).toBe(200);
    expect(late.json).toEqual({ ok: true, accepted: false, reason: "STALE" });

    const after = await stored(driverId);
    expect(after.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(after.recordedAtMs).toBe(T_NEW);
    // ولا عمودَ واحداً نجا من الرفضِ: الدقّةُ ما تزالُ دقّةَ المقبولةِ.
    expect(after.accuracy).toBe(6);
  });

  it("٣ — التساوي في الطابعِ يُقبَلُ ولا يُجمَّدُ الموضعُ", async () => {
    await ping({ ...AT_A, accuracyMeters: 9, recordedAtMs: T_NEW });
    const same = await ping({ ...AT_B, accuracyMeters: 9, recordedAtMs: T_NEW });

    expect(same.status).toBe(200);
    expect(same.json.accepted).toBe(true);
    const row = await stored(driverId);
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
  });

  it("٤ — التفويضُ من الرمزِ: معرّفٌ مدسوسٌ لا يكتبُ على صفِّ غيرِه", async () => {
    const response = await ping({
      ...AT_A,
      recordedAtMs: T_NEW,
      driverId: otherDriverId,
      telegramUserId: OTHER_TELEGRAM,
      role: "admin",
    });

    expect(response.status).toBe(200);
    const mine = await stored(driverId);
    const theirs = await stored(otherDriverId);
    expect(mine.recordedAtMs).toBe(T_NEW);
    expect(theirs.recordedAtMs).toBeNull();
    expect(theirs.lat).toBeNull();
  });

  it("٥ — صاحبُ جلسةٍ صحيحةٍ بلا صفِّ سائقٍ: 404 ولا صفَّ يُنشَأُ", async () => {
    await sql`delete from drivers where id = ${otherDriverId}`;
    const response = await ping({ ...AT_A, recordedAtMs: T_NEW }, OTHER_TELEGRAM);

    expect(response.status).toBe(404);
    expect(response.json.error).toBe("DRIVER_NOT_REGISTERED");
    const rows = await sql<{ count: string }[]>`select count(*)::text as count from drivers`;
    expect(rows[0]?.count).toBe("1");
  });

  it("٦ — إصلاحةٌ فاحشةُ القِدَمِ تُرفَضُ بـ422 ولا تمسُّ الصفَّ", async () => {
    await ping({ ...AT_B, accuracyMeters: 6, recordedAtMs: T_NEW });
    const before = await stored(driverId);

    const ancient = await ping({
      ...AT_A,
      accuracyMeters: 6,
      recordedAtMs: NOW.getTime() - 3_600_000,
    });

    expect(ancient.status).toBe(422);
    expect(ancient.json.error).toBe("FIX_REJECTED");
    expect(await stored(driverId)).toEqual(before);
  });
});
