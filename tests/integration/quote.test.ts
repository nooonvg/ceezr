/**
 * الغرض: قياسُ حكمِ الاقتباسِ على قاعدةٍ حقيقيّةٍ (`F2-04`) — وأهمُّ ما يُقاسُ
 *   ههنا ما **لا يقدرُ حاجزٌ ساكنٌ على قياسِه**: أنَّ الحكمَ نفسَه في القاعدةِ
 *   (القاعدة 0.5) فيفصلُ رفضَ الانطلاقِ عن رفضِ الوجهةِ برمزَينِ، وأنَّ المسافةَ
 *   **جيوديسيّةٌ مقيسةٌ** لا حسبةً مستويّةً، وأنَّ «مَن يخدمُ هذه المدينةَ» يجمعُ
 *   التوثيقَ والاشتراكَ النافذَ والقدرةَ المُفعَّلةَ في حكمٍ واحدٍ — وكلُّ شرطٍ
 *   منها يُنزَعُ وحدَه فيُقاسُ أثرُه.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُنشئُ الطلبَ على الحكمِ نفسِه.
 * ملاحظات مستقبلية: حينَ تُستضافُ خدمةُ توجيهٍ حقيقيّةٌ (عملٌ تشغيليٌّ في
 *   `ADR 0024`) يُضافُ صنفُ مسافةٍ `ROUTE` — وتُضافُ ههنا حالاتُه ولا تُدَّعى قبلَه.
 *
 * ═══ ما لا يُقاسُ ههنا ═══
 * ــ **لا تُقاسُ مدّةٌ**: لا محرِّكَ توجيهٍ في أيِّ بيئةٍ، والمدّةُ امتناعٌ
 *    مُصنَّفٌ `NOT_CONFIGURED` يُقاسُ في `tests/unit/quote-route.test.ts`.
 * ــ **لا تُقاسُ أجرةٌ ولا وسيلةُ دفعٍ**: محجوبتانِ بـ`ADR 0039` §٤ على `DEC-11`،
 *    و`م13-7` يُجمِّدُ حتّى الهياكلَ التمهيديّةَ. وغيابُهما مفروضٌ آليّاً في
 *    `scripts/check-quote-contract.ts` ومُبرهَنُ السقوطِ في اختبارِ حاجزِه.
 * ــ **لا تُقاسُ دِقّةُ الغلافِ**: `jed-envelope-v1` مستطيلٌ تقريبيٌّ مُعلَنٌ
 *    (`ADR 0102` §٦) — فيُقاسُ أنَّ الحكمَ يعملُ لا أنَّه صائبٌ على المترِ.
 * ــ `RLS` يُقاسُ وجوداً لا أثراً: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
 * ــ **لا يُقاسُ أنَّ مستخدماً رأى اقتباساً**: لا نشرَ حيَّ (`ADR 0099`)، وبوّابةُ
 *    `F2` (رحلةٌ على جهازٍ حقيقيٍّ) **غيرُ مُدَّعاةٍ**.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SERVICE_KINDS } from "../../packages/domain/quote/service-offer.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه، ومعرّفٌ غائبٌ عن قصدٍ. */
const RIDER_TELEGRAM_ID = 900_000_941;
const ABSENT_TELEGRAM_ID = 900_000_939;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderId = "";
let driverUserId = "";
let driverId = "";

/** نقطتانِ في غلافِ جدة وثالثةٌ في الرياضِ خارجَه. */
const ORIGIN = { lat: 21.5, lng: 39.15 } as const;
const DESTINATION = { lat: 21.55, lng: 39.2 } as const;
const RIYADH = { lat: 24.7136, lng: 46.6753 } as const;

interface QuotePayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly city_code?: string;
  readonly city_name_ar?: string;
  readonly city_name_en?: string;
  readonly area_version?: string;
  readonly distance_kind?: string;
  readonly distance_m?: number;
  readonly served_services?: readonly string[];
}

async function quote(
  telegramId: number,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<QuotePayload> {
  const [row] = await sql<{ result: QuotePayload }[]>`
    select quote_ride(${telegramId}::bigint,
                      ${origin.lat}::double precision, ${origin.lng}::double precision,
                      ${destination.lat}::double precision,
                      ${destination.lng}::double precision) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * سائقٌ مؤقَّتٌ بحالةٍ مُعيَّنةٍ، ثمَّ يُعادُ إلى حالتِه. والتغييرُ **يُرجَعُ في
 * `finally`** لا بعدَ التأكيدِ: تأكيدٌ ساقطٌ يتركُ القاعدةَ ملوَّثةً فتُخفِقُ
 * بقيّةُ الحالاتِ لسببٍ ليسَ هوَ المقصودَ — وذاكَ أسوأُ من إخفاقٍ واحدٍ.
 */
async function withDriverState(
  state: {
    readonly verification?: string;
    readonly subscriptionStatus?: string;
    readonly capabilityEnabled?: boolean;
    readonly capability?: string;
  },
  assertion: () => Promise<void>,
): Promise<void> {
  const capability = state.capability ?? "transport";
  try {
    if (state.verification !== undefined) {
      await sql`update drivers set verification_status = ${state.verification}::verification_status
                 where id = ${driverId}`;
    }
    if (state.subscriptionStatus !== undefined) {
      await sql`update subscriptions set status = ${state.subscriptionStatus}::subscription_status,
                       current_period_end = case when ${state.subscriptionStatus} = 'expired'
                            then now() - interval '1 day' else now() + interval '30 days' end
                 where driver_id = ${driverId}`;
    }
    if (state.capabilityEnabled !== undefined) {
      await sql`update driver_capabilities set is_enabled = ${state.capabilityEnabled}
                 where driver_id = ${driverId} and service = ${capability}::service_type`;
    }
    await assertion();
  } finally {
    await sql`update drivers set verification_status = 'verified'::verification_status
               where id = ${driverId}`;
    await sql`update subscriptions set status = 'active'::subscription_status,
                     current_period_end = now() + interval '30 days'
               where driver_id = ${driverId}`;
    await sql`update driver_capabilities set is_enabled = (service = 'transport'::service_type)
               where driver_id = ${driverId}`;
  }
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب اختبار الاقتباس', '+966500000941')
    returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID + 1}, 'driver', 'سائق اختبار الاقتباس', '+966500000942')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;

  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status)
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'transport'::service_type, true),
           (${cityId}, ${driverId}, 'delivery'::service_type, false)
  `;
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
    values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status,
            now() + interval '30 days')
  `;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  for (const id of [riderId, driverUserId]) {
    if (id !== "") await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("حكمُ الاقتباسِ في القاعدةِ لا في التطبيقِ", () => {
  it("١) طرفانِ داخلَ الغلافِ: حكمٌ مقبولٌ بمدينةٍ وإصدارِ حدٍّ ومسافةٍ موسومةٍ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    expect(payload.ok).toBe(true);
    expect(payload.error).toBeUndefined();
    expect(typeof payload.city_code).toBe("string");
    expect((payload.city_name_ar ?? "").length).toBeGreaterThan(0);
    expect(typeof payload.area_version).toBe("string");
    expect(payload.distance_kind).toBe("STRAIGHT_LINE");
  });

  it("٢) المسافةُ **جيوديسيّةٌ** لا مستويّةٌ: تُقابَلُ بحسبةِ القاعدةِ نفسِها", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    const [row] = await sql<{ geodesic: number; planar: number }[]>`
      select st_distance(
               st_setsrid(st_makepoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
               st_setsrid(st_makepoint(${DESTINATION.lng}, ${DESTINATION.lat}), 4326)::geography
             ) as geodesic,
             st_distance(
               st_setsrid(st_makepoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326),
               st_setsrid(st_makepoint(${DESTINATION.lng}, ${DESTINATION.lat}), 4326)
             ) as planar
    `;
    expect(row).toBeDefined();
    // فرقُ المترِ الواحدِ: الدالّةُ تستخدمُ `geography` لا `geometry`.
    expect(Math.abs((payload.distance_m ?? 0) - (row?.geodesic ?? 0))).toBeLessThan(1);
    // والمستويّةُ بالدرجاتِ لا بالأمتارِ: رقمٌ آخرُ كُلِّيّاً لو استُخدِمَ سهواً.
    expect(row?.planar ?? 0).toBeLessThan(1);
  });

  it("٣) الوسمُ يُلازِمُ الرقمَ في كلِّ حمولةٍ مقبولةٍ: رقمٌ بلا وسمٍ هوَ الممنوعُ", async () => {
    for (const destination of [DESTINATION, { lat: 21.3, lng: 39.1 }]) {
      const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, destination);
      expect(payload.ok).toBe(true);
      expect(payload.distance_kind).toBe("STRAIGHT_LINE");
      expect(typeof payload.distance_m).toBe("number");
    }
  });

  it("٤) مسافةُ الصفرِ مقبولةٌ لا مرفوضةٌ: طرفانِ متطابقانِ سؤالٌ صحيحٌ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, ORIGIN);
    expect(payload.ok).toBe(true);
    expect(payload.distance_m).toBe(0);
    expect(payload.distance_kind).toBe("STRAIGHT_LINE");
  });
});

describeIf("رفضا منطقةِ الخدمةِ رمزانِ مفصولانِ", () => {
  it("٥) انطلاقٌ خارجَ الغلافِ: `ORIGIN_OUTSIDE_SERVICE_AREA` بلا مسافةٍ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, RIYADH, DESTINATION);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("ORIGIN_OUTSIDE_SERVICE_AREA");
    expect(payload.distance_m).toBeUndefined();
  });

  it("٦) وجهةٌ خارجَ الغلافِ: `DESTINATION_OUTSIDE_SERVICE_AREA` — ولا يُجمَعُ معَ الأوّلِ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, RIYADH);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("DESTINATION_OUTSIDE_SERVICE_AREA");
  });

  it("٧) الطرفانِ خارجَ الغلافِ: يُبلَّغُ الانطلاقُ أوّلاً — أقربُ ما يُصلِحُه الراكبُ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, RIYADH, RIYADH);
    expect(payload.error).toBe("ORIGIN_OUTSIDE_SERVICE_AREA");
  });

  it("٨) الصفرُ قيمةٌ لا غيابٌ: `(0,0)` يُرفَضُ بالحدِّ لا بالشكلِ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, { lat: 0, lng: 0 }, DESTINATION);
    expect(payload.error).toBe("ORIGIN_OUTSIDE_SERVICE_AREA");
  });
});

describeIf("الرفضُ يعودُ رمزاً في حمولةٍ لا استثناءً", () => {
  it("٩) إحداثيّةٌ غيرُ عدديّةٍ أو خارجَ مدى الأرضِ: `INVALID_POINT` قبلَ أيِّ هندسةٍ", async () => {
    for (const bad of [
      { lat: Number.NaN, lng: 39.15 },
      { lat: 91, lng: 39.15 },
      { lat: 21.5, lng: 181 },
    ]) {
      const payload = await quote(RIDER_TELEGRAM_ID, bad, DESTINATION);
      expect(payload.error).toBe("INVALID_POINT");
    }
  });

  it("١٠) وجهةٌ غيرُ صالحةٍ تُرفَضُ كذلكَ: الطرفانِ يُفحَصانِ لا الأوّلُ وحدَه", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, { lat: 21.5, lng: Number.NaN });
    expect(payload.error).toBe("INVALID_POINT");
  });

  it("١١) معرّفٌ لا صفَّ له: `USER_NOT_FOUND` مفصولٌ عن رموزِ الرفضِ ولا يُنشَأُ صفٌّ", async () => {
    const payload = await quote(ABSENT_TELEGRAM_ID, ORIGIN, DESTINATION);
    expect(payload.error).toBe("USER_NOT_FOUND");
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count from users where telegram_id = ${ABSENT_TELEGRAM_ID}
    `;
    expect(row?.count).toBe("0");
  });
});

describeIf("قدرةُ المدينةِ تجمعُ التوثيقَ والاشتراكَ والقدرةَ في حكمٍ واحدٍ", () => {
  it("١٢) سائقٌ موثَّقٌ مشترِكٌ قدرتُه مُفعَّلةٌ: خدمتُه تُعَدُّ مخدومةً", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    expect(payload.served_services).toContain("transport");
  });

  it("١٣) قدرةٌ مُعطَّلةٌ لا تُعَدُّ: القدرةُ إعلانُ السائقِ لا افتراضُ النظامِ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    // تشخيصُ التلوثِ لحظةَ الإخفاقِ: مَن أعلنَ التوصيلَ في مدينةِ هذا
    // الاختبارِ؟ (هويةٌ ومدىً ومدينةُ القدرةِ) — لا بعدَ نهايةِ الحزمةِ حيث
    // يتغيّرُ المشهدُ. المدينةُ الفعليةُ لا المفترضةُ، وdc.city_id لا
    // مدينةِ السائقِ.
    if ((payload.served_services ?? []).includes("delivery")) {
      const polluters = await sql`
        select u.telegram_id::text as tg, u.full_name, dc.city_id::text as cap_city,
               dc.service, dc.is_enabled, d.verification_status::text as verif,
               s.status::text as sub
          from driver_capabilities dc
          join drivers d on d.id = dc.driver_id
          join users u on u.id = d.user_id
          left join subscriptions s on s.driver_id = d.id
         where dc.service = 'delivery'::service_type and dc.is_enabled
           and d.verification_status = 'verified'::verification_status
           and s.status in ('trialing', 'active')`;
      console.error(`QUOTE_POLLUTERS city=${String(cityId)} rows=${JSON.stringify(polluters)}`);
    }
    expect(payload.served_services).not.toContain("delivery");
  });

  it("١٤) اشتراكٌ منتهٍ يُخرِجُ السائقَ: الإيرادُ اشتراكٌ (`ADR 0027`) لا نيّةٌ", async () => {
    await withDriverState({ subscriptionStatus: "expired" }, async () => {
      const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
      expect(payload.served_services).toEqual([]);
    });
  });

  it("١٥) سائقٌ موقوفٌ يُخرَجُ ولو كانَ مشترِكاً: التوثيقُ شرطٌ مستقلٌّ", async () => {
    await withDriverState({ verification: "suspended" }, async () => {
      const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
      expect(payload.served_services).toEqual([]);
    });
  });

  it("١٦) قدرةُ التوصيلِ إذا فُعِّلَت عُدَّت: الحكمُ يُقرأُ من الصفوفِ لا من قائمةٍ", async () => {
    await withDriverState({ capability: "delivery", capabilityEnabled: true }, async () => {
      const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
      expect(payload.served_services).toContain("delivery");
    });
  });

  it("١٧) الرفضُ لا يحملُ خدماتٍ: لا قدرةَ تُعلَنُ لِرحلةٍ مرفوضةٍ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, RIYADH, DESTINATION);
    expect(payload.served_services).toBeUndefined();
  });

  it("١٨) كلُّ خدمةٍ تُعيدُها القاعدةُ معروفةٌ في النطاقِ: لا رمزَ يتيمٌ في شاشةٍ", async () => {
    const payload = await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    for (const service of payload.served_services ?? []) {
      expect(SERVICE_KINDS as readonly string[]).toContain(service);
    }
  });
});

describeIf("سلامةُ الدالّتَينِ نفسِهما", () => {
  it("١٩) الدالّتانِ `stable` لا `volatile`: قراءةٌ لا كتابةٌ", async () => {
    const rows = await sql<{ proname: string; provolatile: string }[]>`
      select proname, provolatile from pg_proc
       where proname in ('quote_ride', 'city_served_services')
         and pronamespace = 'public'::regnamespace
    `;
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.provolatile).toBe("s");
  });

  it("٢٠) `execute` مسحوبٌ عن `public` و`anon` و`authenticated` فعلاً لا نصّاً", async () => {
    for (const name of ["quote_ride", "city_served_services"]) {
      for (const role of ["public", "anon", "authenticated"]) {
        const [row] = await sql<{ allowed: boolean | null }[]>`
          select has_function_privilege(
                   case when ${role} = 'public' then 'public' else ${role} end,
                   p.oid, 'execute') as allowed
            from pg_proc p
           where p.proname = ${name} and p.pronamespace = 'public'::regnamespace
        `;
        // دورٌ غيرُ موجودٍ في قاعدةٍ محلّيّةٍ يُعيدُ `null`؛ والمقصودُ ألّا يكونَ `true`.
        expect(row?.allowed ?? false).toBe(false);
      }
    }
  });

  it("٢١) الاقتباسُ قراءةٌ لا يكتبُ صفّاً: عددُ الصفوفِ قبلَه وبعدَه واحدٌ", async () => {
    const countAll = async () => {
      const [row] = await sql<{ count: string }[]>`
        select (select count(*) from users) + (select count(*) from drivers)
               + (select count(*) from subscriptions) as count
      `;
      return row?.count ?? "";
    };
    const before = await countAll();
    await quote(RIDER_TELEGRAM_ID, ORIGIN, DESTINATION);
    await quote(RIDER_TELEGRAM_ID, RIYADH, DESTINATION);
    await quote(ABSENT_TELEGRAM_ID, ORIGIN, DESTINATION);
    expect(await countAll()).toBe(before);
  });
});
