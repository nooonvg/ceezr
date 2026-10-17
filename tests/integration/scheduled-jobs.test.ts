/**
 * الغرض: إثبات أن مشغّل الجوبات المركزي يعمل فعلاً على قاعدة حقيقية: يبني حاوية
 *   العامل، يجمع مهامّ المدينة المفعَّلة والمهامّ العامّة، ثم يُشغّلها فتتغيّر صفوف
 *   القاعدة كما هو متوقَّع — إنهاء اشتراك مستحقّ، تحذير مشترك يقترب انتهاؤه برسالة
 *   تيليجرام خارجة فعلاً، وإطفاء توفّر بائت — وكل ذلك بلا أثر جانبي في الشوط الثاني.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مهامّ العامل
 * ملاحظات مستقبلية: عند إضافة قفل موزَّع تُضاف حالة تشغيل نسختَي عامل على نفس المدينة.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

/** اختباراتُ هذا الملفِّ تشتغلُ على I/O قاعدةٍ حقيقيّةٍ فتبلغُ تحتَ حملِ
 * الحزمةِ المتسلسلةِ أكثرَ من المهلةِ الافتراضيةِ (5ث). مهلةٌ صريحةٌ لبطءِ
 * العملِ المشروعِ لا لتغطيةِ عطلٍ: الفشلُ يظلُّ فشلًا بعدَ المهلةِ. */
const slowIt = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000);

import { buildWorkerContainer, MAX_JOB_CONCURRENCY } from "../../apps/workers/src/container.ts";
import { createJobRunner, type JobLogger } from "../../apps/workers/src/runner.ts";
import type { ExpiryWarningSender } from "../../packages/application/subscription/expire-subscriptions.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import { testConfig } from "../support/config.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const DRIVER_TELEGRAM = 730_001;
const STALE_DRIVER_TELEGRAM = 730_002;

const config: AppConfig = testConfig({
  port: 3993,
  telegramWebhookSecret: "integration-secret",
});

interface WarningOut {
  readonly chatId: string;
  readonly text: string;
}

/** مُرسِل يجمع بلا شبكة — الغرض إثبات أن الرسالة خرجت وبمن ولأي لغة، لا اختبار تيليجرام. */
function capturingWarningSender(out: WarningOut[]): ExpiryWarningSender {
  return {
    send: async ({ chatId, text }) => {
      out.push({ chatId, text });
      return ok(undefined);
    },
  };
}

function collectingLog(): JobLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message, fields) => lines.push(`${message} ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => lines.push(`ERROR ${message} ${JSON.stringify(fields ?? {})}`),
  };
}

let sql: Sql;
/**
 * تجمّع منفصل للأقفال كما في الإنتاج تماماً. لو تقاسم القفل تجمّع الاستعلامات
 * لاستُنزف التجمّع فور تشغيل ستّ مهامّ متوازية — وهذا ما وقع فعلاً قبل الفصل.
 */
let lockSql: Sql;
let cityId: string;
let container: ReturnType<typeof buildWorkerContainer>;
let warnings: WarningOut[];
let log: ReturnType<typeof collectingLog>;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("مشغّل الجوبات المركزي على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    lockSql = createSql({ connectionString: DATABASE_URL ?? "", max: MAX_JOB_CONCURRENCY + 1 });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers,
                             orders, subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await lockSql.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers,
                             orders, subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = -1401,
             telegram_escalation_group_id = -1402,
             telegram_unsubscribed_drivers_group_id = -1403
       where id = ${cityId}
    `;
    await sql`
      update platform_settings
         set value = case key
                       when 'subscription_expiry_warning_days' then '2'
                       when 'availability_stale_minutes'        then '180'
                       else value
                     end
       where city_id = ${cityId}
         and key in ('subscription_expiry_warning_days', 'availability_stale_minutes')
    `;

    warnings = [];
    log = collectingLog();
    container = buildWorkerContainer(config, {
      sql,
      lockSql,
      warningSender: capturingWarningSender(warnings),
      log,
      // المُرسِلان الحقيقيان يفتحان اتصالاً بتيليجرام. هنا نمنعهما بمزدوجين صامتين:
      // الغرض إثبات جدولة المهامّ وأثرها في القاعدة لا إثبات شبكة تيليجرام.
      driverOut: { send: async () => true },
      riderOut: { send: async () => true },
      identifyingDriver: { sendReturningId: async () => "1" },
    });
  }, 30_000);

  /** سائق حقيقي بصفوف users + drivers، ليست بيانات وهمية بل نفس ما ينشئه البوت. */
  async function makeDriver(
    telegramId: number,
    language: string,
  ): Promise<{ userId: string; driverId: string }> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${telegramId}, 'سائق اختبار', '0500000000', ${language}, 'driver')
      returning id
    `;
    const userId = users[0]?.id ?? "";
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}, ${userId}, 'verified')
      returning id
    `;
    return { userId, driverId: drivers[0]?.id ?? "" };
  }

  async function runAll(): Promise<Map<string, string>> {
    const jobs = await container.jobs();
    const runner = createJobRunner({
      jobs: jobs.map((job) => ({ ...job, runOnStart: true })),
      // القفل الحقيقي لا مُعطَّل: كل شوط في هذا الملفّ يمرّ فعلاً بأخذ القفل
      // وتحريره على اتصال محجوز، فلو تسرَّب قفلٌ بلا تحرير لتوقّف الملفّ كلّه.
      lock: container.lock,
      maxConcurrency: MAX_JOB_CONCURRENCY,
      clock: { now: () => new Date() },
      log,
    });
    const outcomes = await runner.runDue();
    const failures = outcomes.filter((o) => o.status === "failed");
    if (failures.length > 0) {
      throw new Error(`مهامّ فشلت: ${failures.map((f) => `${f.name}=${f.detail}`).join(" | ")}`);
    }
    return new Map(outcomes.map((o) => [o.name, o.detail ?? ""]));
  }

  slowIt("يجمع مهامّ المدينة المفعَّلة والمهامّ العامّة معاً بأسماء ظاهرة", async () => {
    const jobs = await container.jobs();
    const names = jobs.map((job) => job.name);

    expect(names).toContain(`expire-offers:${cityId}`);
    expect(names).toContain(`rotate-negotiations:${cityId}`);
    expect(names).toContain(`cleanup-stale:${cityId}`);
    expect(names).toContain(`warn-expiring:${cityId}`);
    expect(names).toContain("expire-subscriptions");
    expect(names).toContain("recompute-ratings");
    expect(jobs.every((job) => job.everySeconds > 0)).toBe(true);
  });

  slowIt("لا يبني مهامّ مدينة لمدينة غير مفعَّلة، ويبقي المهامّ العامّة", async () => {
    // «لا مدينةَ مفعَّلة» شرطٌ على الجدولِ كلِّه: إطفاءُ مدينةِ السيناريو وحدَها
    // كان يكفي حين كانت مدينةٌ واحدةٌ نشطةً، ولا يكفي في إطلاقِ خمسِ مدن.
    await sql`update cities set is_active = false`;
    const jobs = await container.jobs();
    const names = jobs.map((job) => job.name);

    // وصيانةُ أقسامِ أثرِ الموقعِ (`F7-03`) عامّةٌ لا مدنيّةٌ عن قصدٍ: الجدولُ
    // واحدٌ لكلِّ المدنِ، ونافذةُ أقسامِه تنفَدُ بمرورِ الزمنِ لا بتفعيلِ مدينةٍ،
    // فإطفاءُ المدنِ كلِّها لا يجوزُ أن يوقِفَها وإلاّ سقطَتِ الكتابةُ عندَ العودةِ.
    // وتجديدُ لقطاتِ مقاييسِ الإدارةِ (`F7-08`) عامٌّ لا مدنيٌّ عن قصدٍ كذلكَ:
    // الشوطُ الواحدُ يكتبُ لكلِّ مدينةٍ صفَّها في عبارةٍ ذرِّيّةٍ واحدةٍ، فلا معنىً
    // لمهمّةٍ لكلِّ مدينةٍ؛ وإطفاءُ المدنِ كلِّها لا يوقِفُه لأنَّ لوحةَ الإدارةِ
    // والكنسُ الجملةُ للعروضِ المحسومةِ (`LOAD-01`) عامٌّ لا مدنيٌّ عن قصدٍ:
    // العرضُ المحسومُ لا معنى لإشعارِهِ وأصلُهُ عامٌّ لا مدينةَ له
    // تُقرأُ في حالِ الإطفاءِ نفسِه — وأخطرُ ما فيها أن تُعرِضَ لقطةً شائخةً بلا
    // عُمرٍ. والترتيبُ ههنا ترتيبُ الدفعِ في `container.ts` لا ترتيبٌ أبجديٌّ.
    expect(names).toEqual([
      "sweep-decided-offers",
      "expire-subscriptions",
      "recompute-ratings",
      "refresh-admin-metrics",
      "ensure-location-partitions",
    ]);
    expect(log.lines.some((line) => line.includes("worker.no_active_cities"))).toBe(true);
  });

  slowIt("يُنهي اشتراكاً استحقّ الانتهاء ويكتب سطر تدقيق، ولا يمسّ اشتراكاً سارياً", async () => {
    const due = await makeDriver(DRIVER_TELEGRAM, "ar");
    const live = await makeDriver(STALE_DRIVER_TELEGRAM, "ar");

    await sql`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount)
      values (${cityId}, ${due.driverId}, 'transport', 'active', now() - interval '1 day', 400)
    `;
    await sql`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount)
      values (${cityId}, ${live.driverId}, 'transport', 'active', now() + interval '20 days', 400)
    `;

    const details = await runAll();
    expect(details.get("expire-subscriptions")).toBe("expired=1");

    const rows = await sql<{ driver_id: string; status: string }[]>`
      select driver_id, status from subscriptions order by status
    `;
    const byDriver = new Map(rows.map((row) => [row.driver_id, row.status]));
    expect(byDriver.get(due.driverId)).toBe("expired");
    expect(byDriver.get(live.driverId)).toBe("active");

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where action = 'subscription.expired'
    `;
    expect(audit.length).toBe(1);
  });

  slowIt(
    "يُحذّر سائقاً يقترب انتهاء اشتراكه برسالة بلغته، ولا يكرّر التحذير في الشوط التالي",
    async () => {
      const soon = await makeDriver(DRIVER_TELEGRAM, "ur");
      await sql`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount)
      values (${cityId}, ${soon.driverId}, 'transport', 'active', now() + interval '1 day', 400)
    `;

      const first = await runAll();
      expect(first.get(`warn-expiring:${cityId}`)).toBe("days=2 examined=1 warned=1 failed=0");
      expect(warnings.length).toBe(1);
      expect(warnings[0]?.chatId).toBe(String(DRIVER_TELEGRAM));
      // اللغة المسجَّلة أردية، فالرسالة يجب أن تكون أردية لا عربية.
      expect(warnings[0]?.text).toContain("سبسکرپشن");

      const warned = await sql<{ action: string }[]>`
      select action from audit_log where action = 'subscription.expiry_warned'
    `;
      expect(warned.length).toBe(1);

      const second = await runAll();
      expect(second.get(`warn-expiring:${cityId}`)).toBe("days=2 examined=0 warned=0 failed=0");
      expect(warnings.length).toBe(1);
    },
  );

  slowIt("يُطفئ توفّراً بائتاً ولا يمسّ سائقاً في رحلة قائمة، ثم لا يجد ما يُطفئه", async () => {
    const stale = await makeDriver(DRIVER_TELEGRAM, "ar");
    const busy = await makeDriver(STALE_DRIVER_TELEGRAM, "ar");

    await sql`
      insert into driver_availability (city_id, driver_id, is_available, changed_at)
      values (${cityId}, ${stale.driverId}, true, now() - interval '300 minutes'),
             (${cityId}, ${busy.driverId},  true, now() - interval '400 minutes')
    `;

    const riders = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, 740001, 'عميل اختبار', '0500000001', 'rider')
      returning id
    `;
    const riderRows = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riders[0]?.id ?? ""})
      returning id
    `;
    await sql`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff, assigned_driver_id)
      values (${cityId}, ${riderRows[0]?.id ?? ""}, 'transport', 'in_progress',
              st_setsrid(st_makepoint(39.17, 21.54), 4326)::geography,
              st_setsrid(st_makepoint(39.19, 21.55), 4326)::geography,
              ${busy.driverId})
    `;

    const first = await runAll();
    expect(first.get(`cleanup-stale:${cityId}`)).toBe("deactivated=1 staleMinutes=180");

    const rows = await sql<{ driver_id: string; is_available: boolean }[]>`
      select driver_id, is_available from driver_availability
    `;
    const byDriver = new Map(rows.map((row) => [row.driver_id, row.is_available]));
    expect(byDriver.get(stale.driverId)).toBe(false);
    // السائق في رحلة قائمة يبقى متوفّراً: إطفاؤه كان سيقطع رحلة جارية.
    expect(byDriver.get(busy.driverId)).toBe(true);

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where action = 'driver.availability_expired'
    `;
    expect(audit.length).toBe(1);

    const second = await runAll();
    expect(second.get(`cleanup-stale:${cityId}`)).toBe("deactivated=0 staleMinutes=180");
  });

  slowIt("يقرأ مهلة البياتة من إعدادات المدينة لا من رقم في الكود", async () => {
    const driver = await makeDriver(DRIVER_TELEGRAM, "ar");
    await sql`
      insert into driver_availability (city_id, driver_id, is_available, changed_at)
      values (${cityId}, ${driver.driverId}, true, now() - interval '100 minutes')
    `;

    // بالمهلة الافتراضية (180 دقيقة) لا يُعتبر بائتاً.
    const before = await runAll();
    expect(before.get(`cleanup-stale:${cityId}`)).toBe("deactivated=0 staleMinutes=180");

    await sql`
      update platform_settings set value = '60'
       where city_id = ${cityId} and key = 'availability_stale_minutes'
    `;

    const after = await runAll();
    expect(after.get(`cleanup-stale:${cityId}`)).toBe("deactivated=1 staleMinutes=60");
  });

  slowIt(
    "يقرأ أيام التحذير من إعدادات المدينة: يومان لا يريان اشتراكاً ينتهي بعد خمسة",
    async () => {
      const driver = await makeDriver(DRIVER_TELEGRAM, "ar");
      await sql`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end, price_amount)
      values (${cityId}, ${driver.driverId}, 'transport', 'active', now() + interval '5 days', 400)
    `;

      const before = await runAll();
      expect(before.get(`warn-expiring:${cityId}`)).toBe("days=2 examined=0 warned=0 failed=0");
      expect(warnings.length).toBe(0);

      await sql`
      update platform_settings set value = '7'
       where city_id = ${cityId} and key = 'subscription_expiry_warning_days'
    `;

      const after = await runAll();
      expect(after.get(`warn-expiring:${cityId}`)).toBe("days=7 examined=1 warned=1 failed=0");
      expect(warnings.length).toBe(1);
    },
  );

  slowIt("كل المهامّ تعمل على قاعدة فارغة بلا عطل وبتقارير صفرية", async () => {
    const details = await runAll();

    expect(details.get("expire-subscriptions")).toBe("expired=0");
    expect(details.get("recompute-ratings")).toBe("drivers=0 riders=0");
    expect(details.get(`expire-offers:${cityId}`)).toBe(
      "examined=0 expired=0 cardsClosed=0 cardsFailed=0",
    );
    expect(details.get(`cleanup-stale:${cityId}`)).toBe("deactivated=0 staleMinutes=180");
    expect(details.get(`warn-expiring:${cityId}`)).toBe("days=2 examined=0 warned=0 failed=0");
    expect(details.get(`rotate-negotiations:${cityId}`)).toBe(
      "advanced=0 republished=0 escalated=0 cardsClosed=0 failures=0",
    );
  });
});
