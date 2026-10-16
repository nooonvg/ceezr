/**
 * الغرض: إثباتُ أنّ الإطلاق التجاريّ يقوم على **المدنِ الخمسِ معاً** على قاعدةٍ
 *   حقيقية: تفعيلٌ متزامنٌ بالآلية الرسمية، وإعداداتٌ لكلّ مدينة، وعزلُ السائقين
 *   والطلبات والعروض، وامتناعُ المطابقةِ بين مدينتين، وصلاحياتٌ لا تنفتح لأحد،
 *   وقروباتُ إشعارٍ لكلّ مدينة، ومسارُ طلبٍ ← قبولٍ ← تتبّعٍ في كلّ واحدةٍ منها.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL بها الهجرات مطبَّقة.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسّ المدن أو الإرسال أو الإعدادات.
 * ملاحظات مستقبلية: مدينةٌ سادسةٌ تُضاف إلى `LAUNCH_CITY_CODES` فتدخل هذه
 *   الاختباراتُ كلَّها تلقائياً لأنّها مكتوبةٌ دوراناً على القائمة لا نسخاً لكلّ مدينة.
 *
 * لماذا لا يكفي اختبارُ مدينةٍ واحدةٍ: كلُّ استعلامٍ في المشروع يقيّد بـ`city_id`،
 * وقاعدةُ اختبارٍ فيها مدينةٌ واحدةٌ نشطةٌ **تُنجح** استعلاماً نسيَ القيدَ تماماً
 * كما تُنجح استعلاماً ضبطَه — فلا يظهر الفرقُ إلّا بمدينتين فيهما بياناتٌ متزامنة.
 * ولذلك تُفعَّل الخمسُ هنا معاً وتُزرع في كلٍّ منها حركةٌ، لا في واحدةٍ فقط.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createRiderTripNoticeHandler } from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createCityDirectory } from "../../packages/infrastructure/geo/city-directory.ts";
import { createRiderTripFactsReader } from "../../packages/infrastructure/notification/rider-trip-facts.ts";
import { asIdentifyingSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { LAUNCH_CITY_CODES } from "../../scripts/activate-launch-cities.ts";
import { testConfig } from "../support/config.ts";
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "five-cities-secret";
const MINIAPP_URL_IN_TEST = "https://miniapp.five-cities.test";
const ADMIN_TELEGRAM_ID = 977_000_001;

/**
 * إحداثياتٌ حقيقيةٌ داخل كلّ مدينة، والسائقُ على بعدِ مئاتِ الأمتار من نقطةِ
 * الانطلاق. المسافاتُ بين هذه المدن مئاتُ الكيلومترات، فأيُّ عرضٍ يعبُر مدينةً
 * إلى أخرى لا يمكن أن يكون قرباً جغرافياً: هو نسيانُ قيدِ المدينة بعينه.
 */
const CITY_FIXTURES = {
  JED: { nameFragment: "جدة", pickup: { latitude: 21.5433, longitude: 39.1728 } },
  MKK: { nameFragment: "مكة", pickup: { latitude: 21.4225, longitude: 39.8262 } },
  RUH: { nameFragment: "الرياض", pickup: { latitude: 24.7136, longitude: 46.6753 } },
  TIF: { nameFragment: "الطائف", pickup: { latitude: 21.2703, longitude: 40.4158 } },
  MED: { nameFragment: "المدينة", pickup: { latitude: 24.4686, longitude: 39.6142 } },
} as const;

type LaunchCode = (typeof LAUNCH_CITY_CODES)[number];

interface CityFixture {
  readonly code: LaunchCode;
  readonly id: string;
  readonly support: string;
  readonly escalation: string;
  readonly drivers: string;
  readonly driverChat: number;
  readonly riderChat: number;
  /** جوّالٌ سعوديٌّ صحيحٌ لكلّ مدينة: عشرةُ أرقامٍ تبدأ بـ05، والتحقّقُ في الدومين. */
  readonly driverPhone: string;
  readonly pickup: { readonly latitude: number; readonly longitude: number };
  readonly driverAt: { readonly latitude: number; readonly longitude: number };
}

const config: AppConfig = testConfig({
  port: 3988,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN_TELEGRAM_ID),
  trackingTokenBaseUrl: "https://track.five-cities.test/t",
});

let sql: Sql;
let cities: CityFixture[];
let container: ReturnType<typeof buildContainer> | undefined;
let app: ReturnType<typeof createServer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: nextUpdateId(),
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

async function post(bot: "driver" | "rider", update: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

/** يُفعّل المدنَ الخمسَ بقروباتها في نفس العبارة — القيدُ يمنع غيرَ ذلك. */
async function activateAllFive(): Promise<void> {
  for (const city of cities) {
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = ${city.support}::bigint,
             telegram_escalation_group_id = ${city.escalation}::bigint,
             telegram_unsubscribed_drivers_group_id = ${city.drivers}::bigint
       where id = ${city.id}::uuid
    `;
    /*
     * D-01 وحَّد مسارَ البوتِ لإنشاءِ الطلبِ عبر `request_ride()` التي تتحقَّقُ من
     * منطقةِ الخدمةِ المُفعَّلةِ قبلَ القدرةِ. البذرةُ تُنشئُ منطقةَ خدمةٍ لـJED
     * وحدَها، فالمدنُ الأربعُ الباقيةُ تُرفَضُ بـ`CITY_HAS_NO_SERVICE_AREA`.
     * نُنشئُ مستطيلاً محيطاً حولَ نقطةِ الانتفاعِ لكلِّ مدينةٍ تفتقرُ إلى منطقةٍ.
     */
    await sql`
      insert into city_service_areas (city_id, area, area_version, source, is_active)
      select ${city.id}::uuid,
             st_multi(st_makeenvelope(
               ${city.pickup.longitude - 0.3}, ${city.pickup.latitude - 0.3},
               ${city.pickup.longitude + 0.3}, ${city.pickup.latitude + 0.3},
               4326
             ))::geography,
             ${`${city.code}-test-envelope-v1`},
             'منطقةُ اختبارٍ مُنشأةٌ بواسطةِ activateAllFive — مستطيلٌ محيطٌ حولَ نقطةِ الانتفاعِ لا حدٌّ بلديٌّ رسميٌّ',
             true
      where not exists (
        select 1 from city_service_areas a
         where a.city_id = ${city.id}::uuid and a.is_active
      )
    `;
  }
}

async function registerDriver(city: CityFixture): Promise<string> {
  await post("driver", text(city.driverChat, "/start"));
  await post("driver", text(city.driverChat, `سائق ${city.code}`));
  await post("driver", contact(city.driverChat, city.driverPhone));
  await post("driver", callback(city.driverChat, `city:${city.id}`));
  await post("driver", callback(city.driverChat, "service:transport"));
  await post("driver", callback(city.driverChat, "vehicle:sedan"));
  await post("driver", text(city.driverChat, `أ ب ج ${String(city.driverChat).slice(-4)}`));
  await post("driver", text(city.driverChat, String(1_000_000_000 + city.driverChat)));
  await post("driver", photo(city.driverChat, `vphoto_${city.code}`));
  const rows = await sql<{ id: string }[]>`
    select d.id from drivers d
      join users u on u.id = d.user_id
     where u.telegram_id = ${city.driverChat}::bigint
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`لم يُسجَّل سائقُ ${city.code}`);
  return id;
}

async function makeDriverAvailable(city: CityFixture, driverId: string): Promise<void> {
  await sql`update drivers set verification_status = 'verified' where id = ${driverId}::uuid`;
  // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
  await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
  await post("driver", text(city.driverChat, "/available"));
  await post("driver", location(city.driverChat, city.driverAt));
}

async function registerRider(city: CityFixture): Promise<void> {
  await post("rider", text(city.riderChat, "/start"));
  await post("rider", text(city.riderChat, `راكب ${city.code}`));
  await post("rider", callback(city.riderChat, `city:${city.id}`));
}

async function requestRide(city: CityFixture): Promise<string> {
  await post("rider", text(city.riderChat, "/ride"));
  await post("rider", location(city.riderChat, city.pickup));
  await post("rider", text(city.riderChat, "/skip"));
  const rows = await sql<{ id: string }[]>`
    select o.id from orders o
      join riders r on r.id = o.rider_id
      join users u on u.id = r.user_id
     where u.telegram_id = ${city.riderChat}::bigint
     order by o.created_at desc
     limit 1
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`لم يُنشأ طلبُ ${city.code}`);
  return id;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("إطلاقُ المدنِ الخمسِ معاً على قاعدةٍ حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    cities = [];
    for (const [index, code] of LAUNCH_CITY_CODES.entries()) {
      const rows = await sql<{ id: string }[]>`select id from cities where code = ${code}`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`المدينةُ ${code} غيرُ مزروعةٍ في قاعدة الاختبار`);
      const fixture = CITY_FIXTURES[code];
      const base = -1_009_100_000_000 - index * 100;
      cities.push({
        code,
        id,
        support: String(base - 1),
        escalation: String(base - 2),
        drivers: String(base - 3),
        driverChat: 940_100 + index * 10 + 1,
        riderChat: 940_100 + index * 10 + 2,
        driverPhone: `05${String(51_000_000 + index)}`,
        pickup: fixture.pickup,
        driverAt: {
          latitude: fixture.pickup.latitude + 0.003,
          longitude: fixture.pickup.longitude + 0.003,
        },
      });
    }
    expect(cities).toHaveLength(5);
  });

  afterEach(async () => {
    await container?.close();
    container = undefined;
  });

  afterAll(async () => {
    // نردُّ القاعدةَ إلى خطِّ الأساسِ المبذور: مدنٌ معطّلةٌ بلا قروبات. تركُ
    // خمسِ مدنٍ نشطةٍ يُورِّث ملفّاتِ اختبارٍ أخرى حالاً لم تطلُبها، فتنجحُ أو
    // تفشلُ بترتيبِ التشغيل لا بسلوكِ المنتَج — وقد وقع ذلك فعلاً في جولةٍ سابقة.
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where code = any(${[...LAUNCH_CITY_CODES]}::text[])
    `;
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             trip_tracking_tokens, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             trip_tracking_tokens, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    await activateAllFive();
    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("الآليةُ الرسميةُ تُفعّل الخمسَ معاً ولا يُطفئ تفعيلُ مدينةٍ غيرَها", async () => {
    // نبدأ من الصفر: الخمسُ معطَّلةٌ بلا قروبات، ثمّ تُفتح واحدةً واحدةً بالـRPC.
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where code = any(${[...LAUNCH_CITY_CODES]}::text[])
    `;
    const admin = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, role)
      values (${cities[0]?.id ?? null}::uuid, ${ADMIN_TELEGRAM_ID}::bigint, 'مسؤولُ الإطلاق', 'admin')
      returning id
    `;
    const actor = admin[0]?.id;
    expect(actor).toBeDefined();

    const activeAfterEach: number[] = [];
    for (const city of cities) {
      const result = await sql<{ result: { ok: boolean; is_active: boolean } }[]>`
        select admin_update_city_group_ids(
                 ${actor ?? null}::uuid, ${city.id}::uuid,
                 ${city.support}::bigint, ${city.escalation}::bigint, ${city.drivers}::bigint
               ) as result
      `;
      expect(result[0]?.result.ok).toBe(true);
      expect(result[0]?.result.is_active).toBe(true);
      const count = await sql<{ n: string }[]>`
        select count(*)::text as n from cities
         where is_active = true and code = any(${[...LAUNCH_CITY_CODES]}::text[])
      `;
      activeAfterEach.push(Number(count[0]?.n));
    }
    // العددُ يتزايد ولا يعود إلى ١: هذا هو الفرقُ بين إطلاقٍ متزامنٍ وإطلاقٍ مرحليّ.
    expect(activeAfterEach).toEqual([1, 2, 3, 4, 5]);

    const active = await createCityDirectory(sql).listActive();
    expect(active.ok).toBe(true);
    const codes = (active.ok ? (active.value ?? []) : []).map((city) => city.code).sort();
    expect(codes).toEqual([...LAUNCH_CITY_CODES].sort());
  });

  it("قروباتُ كلِّ مدينةٍ محفوظةٌ لها وحدَها ولا تتقاطع مع مدينةٍ أخرى", async () => {
    const rows = await sql<
      { code: string; support: string; escalation: string; drivers: string }[]
    >`
      select code,
             telegram_support_group_id::text as support,
             telegram_escalation_group_id::text as escalation,
             telegram_unsubscribed_drivers_group_id::text as drivers
        from cities
       where code = any(${[...LAUNCH_CITY_CODES]}::text[])
    `;
    expect(rows).toHaveLength(5);
    const seen = new Set<string>();
    for (const row of rows) {
      const expected = cities.find((city) => city.code === row.code);
      expect(expected).toBeDefined();
      expect(row.support).toBe(expected?.support ?? "");
      expect(row.escalation).toBe(expected?.escalation ?? "");
      expect(row.drivers).toBe(expected?.drivers ?? "");
      for (const group of [row.support, row.escalation, row.drivers]) {
        expect(seen.has(group)).toBe(false);
        seen.add(group);
      }
    }
    // خمسَ عشرةَ مجموعةً متمايزةً: ثلاثٌ لكلّ مدينةٍ من المدنِ الخمس.
    expect(seen.size).toBe(15);
  });

  it("لكلِّ مدينةٍ إعداداتُها كاملةً، وتغييرُ إعدادِ مدينةٍ لا يمسّ غيرَها", async () => {
    const counts = await sql<{ code: string; n: string }[]>`
      select c.code, count(p.id)::text as n
        from cities c join platform_settings p on p.city_id = c.id
       where c.code = any(${[...LAUNCH_CITY_CODES]}::text[])
       group by c.code order by c.code
    `;
    expect(counts).toHaveLength(5);
    const first = Number(counts[0]?.n);
    expect(first).toBeGreaterThan(30);
    for (const row of counts) {
      // العددُ نفسُه في الخمس: مدينةٌ ناقصةُ الإعدادات تسقط في وقتِ التشغيل لا هنا.
      expect(Number(row.n)).toBe(first);
    }

    const keys = ["trial_days", "subscription_price_transport", "max_broadcast_rounds"] as const;
    for (const city of cities) {
      for (const key of keys) {
        const value = await sql<{ v: string | null }[]>`
          select get_setting_number(${city.id}::uuid, ${key})::text as v
        `;
        expect(value[0]?.v).not.toBeNull();
      }
    }

    const target = cities[2];
    const others = cities.filter((city) => city.code !== target?.code);
    const before = await sql<{ v: string }[]>`
      select get_setting_number(${others[0]?.id ?? null}::uuid, 'subscription_price_transport')::text as v
    `;
    // قيمةُ المدينةِ المقصودةِ تُقرأ لها وحدها: قياسُ الفرقِ بقيمةِ مدينةٍ أخرى
    // يفترض تساويَ الأسعار، وهو ما لا يجوز لاختبارِ عزلٍ أن يتّكل عليه.
    const targetBefore = await sql<{ v: string }[]>`
      select get_setting_number(${target?.id ?? null}::uuid, 'subscription_price_transport')::text as v
    `;
    await sql`
      update platform_settings
         set value = to_jsonb(((value)::numeric + 77))
       where city_id = ${target?.id ?? null}::uuid and key = 'subscription_price_transport'
    `;
    const changed = await sql<{ v: string }[]>`
      select get_setting_number(${target?.id ?? null}::uuid, 'subscription_price_transport')::text as v
    `;
    expect(Number(changed[0]?.v)).toBe(Number(targetBefore[0]?.v) + 77);
    const after = await sql<{ v: string }[]>`
      select get_setting_number(${others[0]?.id ?? null}::uuid, 'subscription_price_transport')::text as v
    `;
    expect(after[0]?.v).toBe(before[0]?.v);
    await sql`
      update platform_settings
         set value = to_jsonb(((value)::numeric - 77))
       where city_id = ${target?.id ?? null}::uuid and key = 'subscription_price_transport'
    `;
  });

  it("مدينةٌ جديدةٌ ترث إعداداتَها كاملةً لحظةَ إدخالها", async () => {
    const created = await sql<{ id: string }[]>`
      insert into cities (code, name_ar, name_en)
      values ('ZZTEST', 'مدينةُ وراثةٍ', 'Inheritance City')
      returning id
    `;
    const newId = created[0]?.id;
    expect(newId).toBeDefined();
    try {
      const inherited = await sql<{ n: string }[]>`
        select count(*)::text as n from platform_settings where city_id = ${newId ?? null}::uuid
      `;
      const reference = await sql<{ n: string }[]>`
        select count(*)::text as n from platform_settings where city_id = ${cities[0]?.id ?? null}::uuid
      `;
      expect(Number(inherited[0]?.n)).toBe(Number(reference[0]?.n));
      // ولا تكون المدينةُ الجديدةُ نشطةً بمجرّد الإدخال: القروباتُ شرطٌ.
      const state = await sql<{ is_active: boolean }[]>`
        select is_active from cities where id = ${newId ?? null}::uuid
      `;
      expect(state[0]?.is_active).toBe(false);
    } finally {
      await sql`delete from platform_settings where city_id = ${newId ?? null}::uuid`;
      await sql`delete from cities where id = ${newId ?? null}::uuid`;
    }
  });

  it("سائقو المدنِ الخمسِ وطلباتُهم معزولةٌ: كلُّ طلبٍ في مدينتِه وحدَها", async () => {
    const driverIds = new Map<string, string>();
    for (const city of cities) {
      driverIds.set(city.code, await registerDriver(city));
      await registerRider(city);
    }
    const rows = await sql<{ code: string; drivers: string; riders: string }[]>`
      select c.code,
             (select count(*) from drivers d join users u on u.id = d.user_id
               where u.city_id = c.id)::text as drivers,
             (select count(*) from riders r join users u on u.id = r.user_id
               where u.city_id = c.id)::text as riders
        from cities c
       where c.code = any(${[...LAUNCH_CITY_CODES]}::text[])
       order by c.code
    `;
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(Number(row.drivers)).toBe(1);
      expect(Number(row.riders)).toBe(1);
    }
    // ولا سائقَ بلا مدينةٍ ولا سائقان في مدينةٍ واحدة: المجموعُ خمسةٌ لا أكثر.
    const total = await sql<{ n: string }[]>`select count(*)::text as n from drivers`;
    expect(Number(total[0]?.n)).toBe(5);
  });

  it("لا مطابقةَ بين مدينتين: طلبُ كلِّ مدينةٍ يُعرض على سائقِها وحدَه", async () => {
    const driverIds = new Map<string, string>();
    for (const city of cities) {
      const driverId = await registerDriver(city);
      driverIds.set(city.code, driverId);
      await makeDriverAvailable(city, driverId);
      await registerRider(city);
    }

    const orderIds = new Map<string, string>();
    for (const city of cities) {
      orderIds.set(city.code, await requestRide(city));
    }

    for (const city of cities) {
      const offers = await sql<{ driver_id: string; city_id: string; status: string }[]>`
        select oo.driver_id, o.city_id, oo.status
          from order_offers oo join orders o on o.id = oo.order_id
         where oo.order_id = ${orderIds.get(city.code) ?? null}::uuid
      `;
      // عرضٌ واحدٌ لسائقِ المدينةِ نفسِها: أيُّ عرضٍ زائدٍ هنا سائقُ مدينةٍ أخرى.
      expect(offers).toHaveLength(1);
      expect(offers[0]?.driver_id).toBe(driverIds.get(city.code) ?? "");
      expect(offers[0]?.city_id).toBe(city.id);
    }

    const crossing = await sql<{ n: string }[]>`
      select count(*)::text as n
        from order_offers oo
        join orders o on o.id = oo.order_id
        join drivers d on d.id = oo.driver_id
        join users u on u.id = d.user_id
       where u.city_id <> o.city_id
    `;
    expect(Number(crossing[0]?.n)).toBe(0);

    // منذ BUG-004 يُكتَبُ صفُّ إشعارِ كلِّ عرضٍ في معاملةِ open_offer_round ويُسلَّمُ من
    // عاملٍ، لا متزامنًا من broadcastOffers. نُفرّغُ كلَّ الصفوفِ كما يفعلُ العاملُ قبل
    // التحقّقِ من أنّ كلَّ سائقٍ أُخطرَ بطلبِ مدينتِه وحدَه لا بطلبِ مدينةٍ أخرى.
    await drainNotificationOutbox(sql, capturing(driverSent));

    // وكلُّ سائقٍ أُخطر بطلبِ مدينتِه لا بطلبِ مدينةٍ أخرى.
    for (const city of cities) {
      const foreign = cities.filter((other) => other.code !== city.code).map((other) => other.code);
      const mine = driverSent.filter((sent) => sent.chatId === String(city.driverChat));
      const payload = JSON.stringify(mine);
      // `ADR 0286` — البطاقةُ إشعارٌ بلا زرِّ قبولٍ؛ ما يُميّزُ بطاقةَ مدينةٍ
      // إحداثيّةُ التقاطِها في رابطِ الموقعِ، فالمسافَةُ حاضرٌ لا زرَّ قرارٍ.
      expect(payload).toContain(
        `q=${CITY_FIXTURES[city.code].pickup.latitude},${CITY_FIXTURES[city.code].pickup.longitude}`,
      );
      for (const code of foreign) {
        expect(payload).not.toContain(
          `q=${CITY_FIXTURES[code].pickup.latitude},${CITY_FIXTURES[code].pickup.longitude}`,
        );
      }
      expect(payload).not.toContain("offer:");
    }
  });

  it("قروباتُ الإشعارِ تُختار بمدينةِ الطلبِ: تصعيدٌ وقروبُ سائقين لكلّ مدينة", async () => {
    for (const city of cities) {
      const driverId = await registerDriver(city);
      await makeDriverAvailable(city, driverId);
      await registerRider(city);
      const orderId = await requestRide(city);

      const cycle = await sql<{ result: { group_id: string | null } }[]>`
        select open_unsubscribed_cycle(${orderId}::uuid) as result
      `;
      expect(String(cycle[0]?.result.group_id)).toBe(city.drivers);

      const escalated = await sql<{ result: { group_id: string | null } }[]>`
        select escalate_order(${orderId}::uuid, 'no_driver_at_all') as result
      `;
      expect(String(escalated[0]?.result.group_id)).toBe(city.escalation);
    }
  });

  it("الطلبُ والقبولُ والتتبّعُ يعملون في كلٍّ من المدنِ الخمس", async () => {
    const issued = new Map<string, string>();
    for (const city of cities) {
      const driverId = await registerDriver(city);
      await makeDriverAvailable(city, driverId);
      await registerRider(city);
      const orderId = await requestRide(city);

      riderSent.length = 0;
      // القبولُ عبرَ القلبِ الذرّيِّ في القاعدةِ (`claim_ride`) — عينُ ما تستدعيه
      // بوابةُ التطبيقِ من مسارِ القبولِ، بلا زرِّ بوتٍ (ADR 0286).
      await sql`select claim_ride(${orderId}::uuid, ${driverId}::uuid)`;
      // إشعارُ الراكبِ بالإسنادِ كما يودعُهُ مسارُ قبولِ التطبيقِ (ADR 0286:
      // البوتُ قناةُ إشعاراتٍ) ثمّ تسليمُهُ عبرَ معالجِ الصادرِ الحقيقيِّ.
      await sql`select enqueue_rider_trip_notice(${orderId}::uuid, 'MATCHED')`;
      await drainNotificationOutbox(sql, capturing(riderSent), {
        rider_trip_notice: createRiderTripNoticeHandler({
          facts: createRiderTripFactsReader(sql),
          sender: asIdentifyingSender(capturing(riderSent)),
          miniAppUrl: MINIAPP_URL_IN_TEST,
        }),
      });

      const order = await sql<
        { status: string; assigned_driver_id: string | null; city_id: string }[]
      >`
        select status, assigned_driver_id, city_id from orders where id = ${orderId}::uuid
      `;
      expect(order[0]?.status).toBe("matched");
      expect(order[0]?.assigned_driver_id).toBe(driverId);
      expect(order[0]?.city_id).toBe(city.id);

      const offer = await sql<{ status: string }[]>`
        select status from order_offers where order_id = ${orderId}::uuid
      `;
      expect(offer[0]?.status).toBe("accepted");

      // §4.2 كما صارَ في المنتجِ (ADR 0286): الراكبُ أُخطر بلغتِهِ، وتابعُ موقعِ
      // سائقِهِ منَ التطبيقِ — زرُّ `web_app` على شاشةِ الرحلةِ (open=ride_<id>)
      // بديلَ رابطِ التتبّعِ القديمِ الذي كانَ يُلصقُ بنصِّ رسالةِ البوتِ.
      const toRider = riderSent.filter((sent) => sent.chatId === String(city.riderChat));
      expect(toRider.length).toBeGreaterThan(0);
      expect(toRider.map((sent) => JSON.stringify(sent.markup ?? null)).join("\n")).toContain(
        `open=ride_${orderId}`,
      );

      // إصدارُ رمزِ التتبّعِ كما يُصدرُهُ حوارُ الراكبِ (ADR 0286: الرمزُ آليةُ
      // رابطِ التتبّعِ القابلِ للمشاركةِ — إصدارُهُ لم يعُدْ أثرًا جانبيًّا لرسالةِ
      // البوتِ بل خطوةً صريحةً).
      const tokenIssued = await sql<{ result: { ok: boolean; error?: string } }[]>`
        select issue_tracking_token(${orderId}::uuid, ${city.riderChat}::bigint, ${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}) as result
      `;
      expect(tokenIssued[0]?.result?.ok).toBe(true);
      // والرمزُ محفوظٌ بمدينةِ الطلبِ لا بمدينةٍ سواها.
      const token = await sql<{ city_id: string; created_by: string; revoked_at: Date | null }[]>`
        select city_id, created_by::text as created_by, revoked_at
          from trip_tracking_tokens where order_id = ${orderId}::uuid
      `;
      expect(token).toHaveLength(1);
      expect(token[0]?.city_id).toBe(city.id);
      expect(token[0]?.created_by).toBe(String(city.riderChat));
      expect(token[0]?.revoked_at).toBeNull();

      // والرمزُ يفتح صفحةَ التتبُّع فعلاً: `TOKEN_NOT_FOUND` هو ما تردُّه الدالّةُ لرمزٍ
      // ملغيٍ أو منتهٍ، فتمريرُ `toBeDefined()` وحدَه كان سيُقرأ نجاحاً لرمزٍ لا يعمل.
      const position = await sql<{ result: { ok: boolean; error?: string } }[]>`
        select get_tracking_position(
                 (select token from trip_tracking_tokens where order_id = ${orderId}::uuid)
               ) as result
      `;
      expect(position[0]?.result.ok).toBe(true);
      expect(position[0]?.result.error).toBeUndefined();

      issued.set(city.code, orderId);
    }

    // خمسةُ رموزٍ حيّةٌ، واحدٌ لكلّ مدينة.
    expect(issued.size).toBe(5);
    const live = await sql<{ n: string }[]>`
      select count(*)::text as n from trip_tracking_tokens where revoked_at is null
    `;
    expect(Number(live[0]?.n)).toBe(5);

    // وإلغاءُ رمزِ مدينةٍ يُلغيه وحدَه: إلغاءٌ عريضٌ كان سيقطع تتبُّعَ ركّابِ
    // أربعِ مدنٍ في رحلاتِهم ولا يُظهر خطأً لأحد.
    const first = cities[0];
    const revoked = await sql<{ result: { ok: boolean } }[]>`
      select revoke_order_tracking_tokens(
               ${issued.get(first?.code ?? "") ?? null}::uuid, ${first?.riderChat ?? null}::bigint
             ) as result
    `;
    expect(revoked[0]?.result.ok).toBe(true);
    const remaining = await sql<{ code: string; revoked: boolean }[]>`
      select c.code, (t.revoked_at is not null) as revoked
        from trip_tracking_tokens t join cities c on c.id = t.city_id
       order by c.code
    `;
    expect(remaining).toHaveLength(5);
    for (const row of remaining) {
      expect(row.revoked).toBe(row.code === first?.code);
    }
  });

  it("الصلاحياتُ مغلقةٌ للمدنِ الخمسِ جميعاً: لا anon ولا authenticated يقرأ صفّاً", async () => {
    const tables = ["cities", "orders", "drivers", "riders", "platform_settings"] as const;
    for (const table of tables) {
      const grants = await sql<{ grantee: string; privilege_type: string }[]>`
        select grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = ${table}
           and grantee in ('anon', 'authenticated', 'PUBLIC')
      `;
      expect(grants.map((row) => `${row.grantee}:${row.privilege_type}`)).toEqual([]);
      const rls = await sql<{ relrowsecurity: boolean }[]>`
        select relrowsecurity from pg_class
         where relnamespace = 'public'::regnamespace and relname = ${table}
      `;
      expect(rls[0]?.relrowsecurity).toBe(true);
    }
    // ولا usage على المخطّط: بدونها لا تُرى المدنُ الخمسُ ولو انفتحت سياسةٌ يوماً.
    const usage = await sql<{ n: string }[]>`
      select count(*)::text as n
        from information_schema.usage_privileges
       where object_schema = 'public' and grantee in ('anon', 'authenticated')
    `;
    expect(Number(usage[0]?.n)).toBe(0);
  });

  it("قراءةُ الإعداداتِ والسائقين تلتزم بالمدينةِ المطلوبةِ لا بأوّلِ مدينةٍ نشطة", async () => {
    for (const city of cities) {
      const driverId = await registerDriver(city);
      await makeDriverAvailable(city, driverId);
    }
    for (const city of cities) {
      const nearby = await sql<{ code: string; n: string }[]>`
        select c.code, count(*)::text as n
          from drivers d
          join users u on u.id = d.user_id
          join cities c on c.id = u.city_id
         where u.city_id = ${city.id}::uuid
         group by c.code
      `;
      expect(nearby).toHaveLength(1);
      expect(nearby[0]?.code).toBe(city.code);
      expect(Number(nearby[0]?.n)).toBe(1);
    }
  });
});
