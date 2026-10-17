/**
 * الغرض: إثبات أن مجدول المهامّ الدورية يعمل فعلاً داخل عملية البوابة: أن المتغيّر
 *   RUN_WORKER_IN_GATEWAY يُقرأ صحيحاً، وأن الإقلاع المدمج يُسجّل مهامّ المدينة
 *   المفعَّلة والمهامّ العامّة بالأسماء نفسها التي تُسجّلها خدمة العامل المستقلّة،
 *   وأن مهمّة واحدة على الأقل تُنفَّذ فعلاً لا تُسجَّل فقط، وأن الإيقاف يُغلق كل شيء.
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على apps/gateway/src/embedded-worker.ts أو على
 *   قراءة RUN_WORKER_IN_GATEWAY في packages/shared/config
 * ملاحظات مستقبلية: يوم تُنشأ خدمة waslah-worker مستقلّة يبقى هذا الاختبار صالحاً —
 *   فهو يختبر المسار المدمج لا وجودَ الخدمة.
 */

import { describe, expect, it } from "bun:test";
import { startEmbeddedWorker } from "../../apps/gateway/src/embedded-worker.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { OutboundSender } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { type AppConfig, tryLoadConfig } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import { testConfig } from "../support/config.ts";

const CITY_ID = "11111111-2222-3333-4444-555555555555";

const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://unit.test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "unit-test",
  DATABASE_URL: "postgres://unit:test@localhost:5432/unit",
  UPSTASH_REDIS_REST_URL: "http://localhost",
  UPSTASH_REDIS_REST_TOKEN: "unit-test",
  DRIVER_BOT_TOKEN: "driver-token",
  RIDER_BOT_TOKEN: "rider-token",
  TELEGRAM_WEBHOOK_SECRET: "unit-secret",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
  MINIAPP_URL: "https://app.example.com",
};

const config: AppConfig = testConfig({
  port: 3994,
  supabaseUrl: BASE_ENV.SUPABASE_URL as string,
  databaseUrl: BASE_ENV.DATABASE_URL as string,
  supabaseServiceKey: "unit-test",
  redisToken: "unit-test",
  telegramWebhookSecret: "unit-secret",
  runWorkerInGateway: true,
});

interface FakeSqlLog {
  readonly queries: string[];
}

/**
 * قاعدة مزيَّفة على مستوى النصّ لا على مستوى المحوّل: الغرض إثبات أن المهامّ سُجِّلت
 * ونُفِّذت داخل عملية البوابة، لا إعادة اختبار محوّلات القاعدة — تلك لها اختبارات
 * تكامل على قاعدة حقيقية. تُعيد صفّ مدينة واحدة مفعَّلة، وصفوفاً فارغة لما بعدها،
 * فينتهي كل شوط مهمّة بنتيجة صفرية صحيحة لا بخطأ.
 */
function fakeSql(log: FakeSqlLog): Sql {
  const run = (strings: TemplateStringsArray | string): unknown[] => {
    const text = typeof strings === "string" ? strings : strings.join("?");
    log.queries.push(text.replace(/\s+/g, " ").trim());
    if (/from\s+cities/i.test(text) && /is_active\s*=\s*true/i.test(text)) {
      return [{ id: CITY_ID, code: "UNI", name_ar: "مدينة الاختبار", name_en: "Unit City" }];
    }
    return [];
  };

  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(run(strings))) as unknown as Sql;
  // `end` وحده هو ما يستدعيه الإغلاق فعلاً؛ بقية الواجهة غير مطلوبة لهذا المسار.
  (sql as unknown as { end: () => Promise<void> }).end = async () => undefined;
  (sql as unknown as { unsafe: (text: string) => Promise<unknown[]> }).unsafe = async (text) =>
    run(text);
  return sql;
}

/** مُرسِل يجمع بلا شبكة — لا تُفتح أي اتصال بتيليجرام في اختبار وحدة. */
function capturingSender(sent: string[]): OutboundSender {
  return {
    send: async (target: unknown, text: unknown) => {
      sent.push(`${String(target)}:${String(text)}`);
      return ok(undefined);
    },
  } as unknown as OutboundSender;
}

describe("قراءة RUN_WORKER_IN_GATEWAY", () => {
  it("الغياب يعني التفعيل — بوابةٌ بلا مهامّ دورية أسوأ من مهمّةٍ تتكرر تحت قفل", () => {
    const result = tryLoadConfig({ ...BASE_ENV });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(true);
  });

  it("الإطفاء يُعلَن صراحةً، والقيمة غير المفهومة ترجع للافتراض لا للإطفاء", () => {
    for (const raw of ["true", "TRUE", " 1 ", "yes", "on"]) {
      const result = tryLoadConfig({ ...BASE_ENV, RUN_WORKER_IN_GATEWAY: raw });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.runWorkerInGateway).toBe(true);
    }
    for (const raw of ["false", "FALSE", " 0 ", "no", "off"]) {
      const result = tryLoadConfig({ ...BASE_ENV, RUN_WORKER_IN_GATEWAY: raw });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.runWorkerInGateway).toBe(false);
    }
    // إملاءةٌ مثل `maybe` لا تُطفئ المهامّ الدورية كلّها: من كتب قيمةً فقد أراد
    // إعداداً لا صمتاً، وأقربُ ما يقارب مرادَه هو الحال الأسلم لا التعطيل الأقسى.
    for (const raw of ["maybe", ""]) {
      const result = tryLoadConfig({ ...BASE_ENV, RUN_WORKER_IN_GATEWAY: raw });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.runWorkerInGateway).toBe(true);
    }
  });
});

describe("العامل المدمج داخل عملية البوابة", () => {
  it("يُسجّل مهامّ المدينة المفعَّلة والمهامّ العامّة ثم يتوقّف نظيفاً", async () => {
    const log: FakeSqlLog = { queries: [] };
    const sql = fakeSql(log);
    const lines: string[] = [];
    const sent: string[] = [];

    const handle = await startEmbeddedWorker(
      config,
      {
        info: (message, fields) => lines.push(`${message} ${JSON.stringify(fields ?? {})}`),
        error: (message, fields) => lines.push(`ERROR ${message} ${JSON.stringify(fields ?? {})}`),
      },
      {
        sql,
        lockSql: sql,
        lock: createNoopLock(),
        driverOut: capturingSender(sent),
        riderOut: capturingSender(sent),
        warningSender: { send: async () => ok(undefined) },
      },
    );

    try {
      // المهامّ المدنية الستّ + العامّتان. الرقم مثبَّت عن قصد: نقصانه يعني مهمّة
      // اختفت من الإنتاج بلا أن يلاحظها أحد، وهو بالضبط العطب الذي جاء البند ليُصلحه.
      // صار تسعاً بإضافة outbox SOS العامّة: غيابها لا يخفي فشلاً في تيليجرام،
      // والحارس المثبّت يكشف حذف المهمة من إنتاج العامل.
      // ثم عشراً بإضافة تسليم البثّ الجماعي لكلّ مدينة: حملةٌ تُكتب في القاعدة ولا
      // مهمّةَ تسليمٍ مسجّلة تعني صفوفاً `pending` إلى الأبد ولوحةً تقول «جارٍ الإرسال».
      // ثم إحدى عشرة بإضافة تسليم إشعارات الاشتراك: صندوقٌ يُكتب فيه عند التفعيل
      // والانتهاء، وبلا مهمّةٍ تسلّمه يُقطع السائق عن الطلبات بصمتٍ تامّ.
      // ثم اثنتي عشرة بإضافة انقضاء روابط التتبّع (§4.2): رابطٌ يُصدَر ولا مهمّةَ
      // تسحب انقضاءه يبقى حيّاً إلى سقف عمره المطلق بعد أن انتهت الرحلة بساعات.
      // ثم ثلاث عشرة بإضافة تسليم إشعارات العروض من outbox (BUG-004): عرضٌ يُكتَبُ
      // ذرّيًّا في معاملته ولا مهمّةَ تسلّمه تعني سائقًا لا يعرف أنّه عُرِضَ عليه أبدًا.
      // ثمَّ أربعَ عشرةَ بإضافةِ تقديمِ أقسامِ أثرِ الموقعِ (`F7-03` / ADR-0074):
      // نافذةُ الأقسامِ تنفَدُ بمرورِ الزمنِ، وغيابُ المهمّةِ يعني يوماً
      // تسقطُ فيه كتابةُ كلِّ موقعٍ لأنَّ لا قِسمَ لليومِ الجاري.
      // ثمَّ خمسَ عشرةَ بإضافةِ تجديدِ لقطاتِ مقاييسِ الإدارةِ (`F7-08` / ADR-0128):
      // وغيابُ المهمّةِ يعني لوحةً تُعرِضُ لقطةً تشيخُ بلا حدٍّ، فيُقرأُ
      // رقمُ أمسِ رقمَ اليومِ — والرقمُ السابقُ يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ ستَّ عشرةَ بإضافةِ كاشفِ الحالاتِ العالقةِ (`F12-04`): وغيابُ المهمّةِ
      // يعني رحلةً تَعلَقُ فلا يراها أحدٌ حتّى يشتكيَ راكبٌ — والرقمُ السابقُ
      // يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ سبعَ عشرةَ بإضافةِ كاشفِ تجاوزِ السقفِ (`F12-20` · `ADR 0216`): وغيابُها
      // يعني رحلةً فوقَ `tracking_link_max_lifetime_minutes` لا يقفُ أمامَ عينِ
      // المُشغِّلِ أحدٌ — والمهمّةُ كانت مبنيةً وغيرَ مسجَّلةٍ، وهذا الحارسُ عينُ ما
      // يمنعُ عودتَها. والرقمُ السابقُ يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ ثمانيَ عشرةَ بإضافةِ إشعارِ انتهاءِ الوثائقِ (`DEC-27` · `ADR 0224`): وغيابُها
      // يعني سائقًا تنتهي رخصتُهُ ولا يُنبَّهُ — والمهمّةُ مبنيةٌ ومسجَّلةٌ، والحارسُ
      // يمنعُ تراجعَ الرقمِ. والرقمُ السابقُ يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ تسعَ عشرةَ بإضافةِ تحريرِ المرشَّحِ الفائتِ (`WR-09` · `ADR 0266`): وغيابُها
      // يعني سائقاً ينتظرُ قراراً فاتَ ولا يُخطَرُ حتّى يأتيَ قبولٌ آخر. والرقمُ السابقُ
      // يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ عشرين بإضافةِ إيداعِ تذكيرِ الموقعِ (`WR-12` · `ADR 0268`): وغيابُها يعني سائقاً
      // «متوفّراً» بموقعٍ قديمٍ لا يُذكَّر. والرقمُ السابقُ يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ إحدى وعشرين بإضافةِ نقلِ مدينةِ السائقِ حسبَ موقعِه (`WR-13` · `ADR 0269`): وغيابُها
      // يعني سائقاً انتقلَ إلى مدينةٍ ولا تصلُه طلباتُها. والرقمُ السابقُ يبقى مذكوراً أعلاهُ (`ح-8`).
      // ثمَّ ثلاثٌ وعشرون بإضافةِ إطلاقِ المجدولِ لكلِّ مدينةٍ وتذكيراتِه (`WR-06` · `ADR 0273`):
      // وغيابُ الأوّلِ يعني طلباتٍ مجدولةً لا يُبحَثُ لها عن سائقٍ أبدًا.
      // ثمَّ أربعٌ وعشرون بإضافةِ انتهاءِ البحثِ لكلِّ مدينة (`WR-22` · `ADR 0276`): وغيابُها
      // يعني طلبًا يبحثُ إلى الأبدِ بعدَ أن استنفدَ كلَّ مسار. والرقمُ السابقُ يبقى مذكوراً أعلاهُ.
      // ثمَّ ستٌّ وعشرون بإضافةِ كنسِّ العروضِ المحسومةِ من طابورِ الإشعاراتِ جملةً
      // (`LOAD-01`): عرضٌ حُسمَ لا معنى لإشعارِهِ، وبقاؤُهُ معلّقًا يكسرُ بوابةَ أقدمِ
      // معلّقٍ في قبولِ الحملِ. عالميٌّ لا مدنيٌّ لأنَّ أصلَ العرضِ عامٌّ.
      expect(handle.jobCount).toBe(26);

      const started = lines.find((line) => line.startsWith("embedded_worker.started"));
      expect(started).toBeDefined();
      for (const name of [
        `expire-offers:${CITY_ID}`,
        `redispatch-searching:${CITY_ID}`,
        `expire-searching:${CITY_ID}`,
        `close-escalation-cards:${CITY_ID}`,
        `sweep-unmatched:${CITY_ID}`,
        `rotate-negotiations:${CITY_ID}`,
        `cleanup-stale:${CITY_ID}`,
        `warn-expiring:${CITY_ID}`,
        `deliver-broadcasts:${CITY_ID}`,
        `deliver-subscription-notices:${CITY_ID}`,
        "deliver-safety-incidents",
        "deliver-notifications",
        // `LOAD-01`: الاسمُ مثبَّتٌ لا العددُ وحدهُ — كنسُّ العروضِ المحسومةِ جوبٌ
        // مسجَّلٌ في الحاويةِ، فحذفُهُ من هذه القائمةِ يبقى أحمرَ كما سابقيهِ.
        "sweep-decided-offers",
        "expire-subscriptions",
        "recompute-ratings",
        // `F7-03`: الاسمُ مثبَّتٌ لا العددُ وحدَه — عددٌ يبقى أربعةَ عشرَ
        // بإسقاطِ مهمّةٍ وإضافةِ أخرى لا يكشفُ شيئاً.
        "ensure-location-partitions",
        // `F12-20`: الاسمُ مثبَّتٌ للعلّةِ نفسِها — والكاشفُ كان مبنىً بلا اسمٍ
        // مسجَّلٍ في هذه القائمةِ ولا في الحاويةِ، فمثبَّتٌ هنا ليعودَ حذفُه أحمراً.
        `detect-ceiling-exceeded:${CITY_ID}`,
        // `DEC-27`: الاسمُ مثبَّتٌ للعلّةِ نفسِها — إشعارُ انتهاءِ الوثائقِ مهمّةٌ
        // مسجَّلةٌ، فحذفُها من هذه القائمةِ يبقى أحمراً.
        `warn-expiring-documents:${CITY_ID}`,
      ]) {
        expect(started).toContain(name);
      }

      // التسجيل ليس تنفيذاً: المشغّل يُطلق نبضة فورية عند start()، فمهامّ runOnStart
      // يجب أن تكون قد لمست القاعدة فعلاً — وإلّا كان الاختبار يثبت قائمةً لا عملاً.
      await Bun.sleep(50);
      expect(lines.some((line) => line.startsWith("job.ran"))).toBe(true);
      expect(log.queries.length).toBeGreaterThan(1);
    } finally {
      await handle.stop();
    }

    expect(lines.some((line) => line.startsWith("runner.stopped"))).toBe(true);
    expect(lines.some((line) => line.startsWith("embedded_worker.stopped"))).toBe(true);

    // الإيقاف يجب أن يكون فعلاً لا إعلاناً: نبضة بعد الإيقاف لا تُنتج استعلاماً جديداً.
    const afterStop = log.queries.length;
    await Bun.sleep(60);
    expect(log.queries.length).toBe(afterStop);
  });
});
