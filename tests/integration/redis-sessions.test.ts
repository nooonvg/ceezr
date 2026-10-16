/**
 * الغرض: إثبات أن الحاوية حين تُضبط على SESSION_STORE=redis تمضي بحوار حقيقي كاملاً
 *   من الويبهوك إلى القاعدة، وأن حالة الحوار تعيش في Redis لا في ذاكرة العملية —
 *   أي أن التبديل لا يغيّر سلوكاً واحداً في أي حوار.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL. Redis مزدوج في الذاكرة
 *   لأن المطلوب إثباته هو أن الحالة خرجت من العملية إلى المخزن، لا أن Upstash يعمل.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على مخزن الجلسات
 * ملاحظات مستقبلية: عند وصول رابط Upstash حقيقي يُشغَّل نفس الملف بعميل حقيقي
 *   بتبديل المزدوج وحده، بلا تغيير أي توقّع فيه.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { REDIS_SESSION_PREFIX } from "../../apps/gateway/src/bots/shared/redis-session.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 310_001;

const config: AppConfig = testConfig({
  sessionStore: "redis",
  telegramWebhookSecret: WEBHOOK_SECRET,
  port: 3999,
});

/** Redis مزدوج يحترم EX بمنطق مهلة حقيقي، لأن انتهاء المهلة جزء من السلوك المختبَر. */
function fakeRedis(nowMs: () => number): RedisClient & {
  readonly keys: () => string[];
  readonly rawOf: (key: string) => string | undefined;
  readonly setDown: (down: boolean) => void;
} {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  let down = false;
  const live = (key: string): string | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAtMs <= nowMs()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  };
  return {
    keys: () => [...entries.keys()].filter((key) => live(key) !== undefined),
    rawOf: live,
    /** يحاكي انقطاع Upstash: كل أمر يفشل بعطل شبكة، والبيانات تبقى كما هي حتى العودة. */
    setDown: (value: boolean) => {
      down = value;
    },
    command: async (args) => {
      if (down) return { ok: false, error: { kind: "network", detail: "connection refused" } };
      const name = String(args[0]).toUpperCase();
      const key = String(args[1] ?? "");
      if (name === "GET") return { ok: true, value: live(key) ?? null };
      if (name === "SET") {
        const seconds = Number(args[4] ?? 0);
        entries.set(key, { value: String(args[2]), expiresAtMs: nowMs() + seconds * 1000 });
        return { ok: true, value: "OK" };
      }
      if (name === "EVAL") {
        // محاكاةُ سكربتِ CAS الذرّيِّ: ["EVAL", script, numkeys, key, stateJson, expected, ttl]
        const evalKey = String(args[3] ?? "");
        const stateJson = String(args[4] ?? "{}");
        const expected = Number(args[5] ?? 0);
        const ttl = Number(args[6] ?? 0);
        const current = live(evalKey);
        let currentRevision = 0;
        if (current !== undefined) {
          try {
            const parsed = JSON.parse(current) as Record<string, unknown>;
            if (typeof parsed.revision === "number") currentRevision = parsed.revision;
          } catch {
            currentRevision = 0;
          }
        }
        const base = expected === -1 ? currentRevision : expected;
        if (base !== currentRevision) return { ok: true, value: 0 };
        const newRevision = base + 1;
        const envelope = `{"revision":${newRevision},"state":${stateJson}}`;
        entries.set(evalKey, { value: envelope, expiresAtMs: nowMs() + ttl * 1000 });
        return { ok: true, value: newRevision };
      }
      if (name === "DEL") return { ok: true, value: entries.delete(key) ? 1 : 0 };
      return { ok: false, error: { kind: "redis", detail: name } };
    },
  };
}

let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let redis: ReturnType<typeof fakeRedis>;
let driverSent: SentMessage[];
let clockMs: number;

async function post(update: unknown): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/webhook/telegram/driver", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const text = (value: string) => ({
  update_id: nextUpdateId(),
  message: {
    chat: { id: DRIVER_CHAT },
    from: { id: DRIVER_CHAT, language_code: "ar" },
    text: value,
  },
});
const photo = (fileId: string) => ({
  update_id: nextUpdateId(),
  message: {
    chat: { id: DRIVER_CHAT },
    from: { id: DRIVER_CHAT, language_code: "ar" },
    photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }],
  },
});
const callback = (data: string) => ({
  update_id: nextUpdateId(),
  callback_query: {
    data,
    from: { id: DRIVER_CHAT },
    message: { chat: { id: DRIVER_CHAT } },
  },
});
const contact = (phone: string) => ({
  update_id: nextUpdateId(),
  message: {
    chat: { id: DRIVER_CHAT },
    from: { id: DRIVER_CHAT, language_code: "ar" },
    contact: { user_id: DRIVER_CHAT, phone_number: phone },
  },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("جلسات الحوار على Redis بحاوية حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  /**
   * إغلاقُ حاويةِ السيناريو عقب كلِّ اختبار لا مرّةً واحدةً في النهاية: الحاويةُ
   * تُنشئ حوضَ اتّصالاتٍ خاصّاً بها، وبناؤها في `beforeEach` مع إغلاقٍ وحيدٍ في
   * `afterAll` يُراكم أحواضاً بعددِ اختباراتِ الملفّ. القاعدةُ المحلّية كانت تحتمل
   * التراكمَ بسعتها الأوسع، أمّا خدمةُ PostgreSQL في آلةِ التكامل فتقف عند حدّها
   * الافتراضيّ فتردّ «sorry, too many clients already» — فيُخفق سربٌ من اختباراتٍ
   * سليمةٍ لا علاقةَ لها بالعيب، ويُحوّل الحمرةَ إلى ضجيجٍ يُخفي الأعطالَ الحقيقية.
   */
  afterEach(async () => {
    // إن أخفقَ التهيئةُ لم تُبنَ الحاويةُ أصلاً، وطرحُ خطأٍ ثانٍ في التفكيك يطمس الأوّل.
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    clockMs = Date.now();
    redis = fakeRedis(() => clockMs);
    driverSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing([]),
      redis,
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("خطوة الحوار تُكتب في Redis لا في ذاكرة العملية", async () => {
    await post(text("/start"));

    const keys = redis.keys();
    expect(keys).toEqual([`${REDIS_SESSION_PREFIX}:driver:${DRIVER_CHAT}`]);
    const raw = redis.rawOf(keys[0] ?? "");
    expect(JSON.parse(raw ?? "{}").state?.step).toBe("awaiting_name");
  });

  it("حوار تسجيل كامل يمضي عبر Redis وينتهي بصفّ سائق حقيقي في القاعدة", async () => {
    await post(text("/start"));
    await post(text("عبدالله الحربي"));
    await post(contact("+966500000111"));

    await post(callback(`city:${cityId}`));
    await post(callback("service:transport"));
    await post(callback("vehicle:sedan"));
    await post(text("أ ب ج 1234"));
    await post(text("1000310001"));
    await post(photo("vphoto_310001"));

    const rows = await sql<{ full_name: string; phone: string }[]>`
      select full_name, phone from users where telegram_id = ${DRIVER_CHAT}
    `;
    expect(rows[0]).toEqual({ full_name: "عبدالله الحربي", phone: "+966500000111" });
  });

  it("انتهاء مهلة المفتاح في Redis يُعيد الحوار إلى بدايته لا إلى خطوة معلَّقة", async () => {
    await post(text("/start"));
    await post(text("عبدالله الحربي"));
    expect(redis.keys()).toHaveLength(1);

    // نصف ساعة وثانية: المهلة نفسها التي كتبها المخزن مع الأمر SET
    clockMs += 1801 * 1000;
    expect(redis.keys()).toHaveLength(0);

    driverSent.length = 0;
    await post(text("رقم جوالي 0500000111"));

    // بلا جلسة يبدأ الحوار من أوله، ولا يُفسَّر النصّ على أنه إجابة خطوة الهاتف
    const usersAfter = await sql<{ count: string }[]>`
      select count(*)::text as count from users where telegram_id = ${DRIVER_CHAT}
    `;
    expect(usersAfter[0]?.count).toBe("0");
    expect(driverSent.length).toBeGreaterThan(0);
  });

  /**
   * سلوك المنصّة حين ينقطع Redis أثناء التشغيل، لا سلوك المخزن وحده.
   *
   * المطلوب إثباته أن الانقطاع **يُضعف ولا يُفسِد**: الويبهوك يبقى 200 حتى لا
   * تُعيد تلغرام إرسال نفس التحديث بلا نهاية، والمستخدم يُبلَّغ بعطل بدل الصمت،
   * والقاعدة لا تكتسب صفوفاً ناقصة، والخدمة تتعافى وحدها عند عودة Redis بلا
   * إعادة تشغيل. هذا هو المبرّر السلوكي لتصنيف Redis `critical: false` في /ready.
   */
  describe("انقطاع Redis أثناء التشغيل", () => {
    const ERROR_AR = "حدث عطل تقني مؤقّت. حاول بعد قليل.";

    it("الويبهوك يبقى 200 والانقطاع لا يُسقط الطلب", async () => {
      redis.setDown(true);

      const res = await post(text("/start"));

      // 200 مقصود: رمز خطأ هنا يجعل تلغرام تُعيد إرسال نفس التحديث مراراً،
      // فيتحوّل عطل Redis إلى عاصفة إعادة إرسال فوق عطل قائم.
      expect(res.status).toBe(200);
    });

    it("المستخدم يُبلَّغ بعطل صريح بدل الصمت حين تفشل الكتابة", async () => {
      redis.setDown(true);
      driverSent.length = 0;

      await post(text("/start"));

      expect(driverSent.length).toBeGreaterThan(0);
      expect(driverSent.at(-1)?.text).toBe(ERROR_AR);
    });

    it("لا يكتب صفّاً ناقصاً في القاعدة طوال الانقطاع", async () => {
      redis.setDown(true);

      await post(text("/start"));
      await post(text("عبدالله الحربي"));
      await post(contact("+966500000111"));
      await post(callback(`city:${cityId}`));
      await post(callback("service:transport"));

      const users = await sql<{ count: string }[]>`
        select count(*)::text as count from users where telegram_id = ${DRIVER_CHAT}
      `;
      const drivers = await sql<{ count: string }[]>`
        select count(*)::text as count from drivers
      `;
      expect(users[0]?.count).toBe("0");
      expect(drivers[0]?.count).toBe("0");
    });

    it("لا يُفسَّر ردّ المستخدم على أنه إجابة خطوةٍ لم تُحفظ", async () => {
      redis.setDown(true);
      await post(text("/start"));

      // لو ظنّ الحوار أن الخطوة awaiting_name حُفظت لسجّل هذا نصّاً اسماً.
      driverSent.length = 0;
      await post(text("عبدالله الحربي"));

      // فشل القراءة يعني «لا جلسة»، فالحوار عند بدايته لا عند awaiting_name.
      // النتيجة أن النصّ يقع خارج أي خطوة فيُردّ بإرشاد لا بقبولٍ صامت — وهذا
      // أفضل من رسالة عطل تقني: المستخدم يُوجَّه بدل أن يُترك أمام خطأ مبهم.
      //
      // زيادةٌ 2026-09-25 (`ح-8` · `D-36` · `ADR 0194` يُعدِّلُ `ADR 0011` §6): الإرشادُ
      // كانَ «لم أفهم… /help»، وهوَ ردٌّ يُحمِّلُ المستخدمَ عطلَنا، و`/help` ثمَّ `/start`
      // تسقطانِ معَ Redis نفسِه. وقُرِئَ في `F11-03` على الراكبِ وسطَ خطوةِ النقطةِ. فالإخفاقُ
      // الآنَ يُفرَّقُ من الغيابِ: نصٌّ حرٌّ والطورُ مجهولٌ ⇒ عطلٌ صادقٌ. وما يحميه الاختبارُ
      // باقٍ حرفاً: النصُّ لا يُقبَلُ اسماً، ولا صفَّ يُولَدُ.
      expect(driverSent.at(-1)?.text).toBe(translate("ar", "common.error_try_again"));
      expect(driverSent.at(-1)?.text).not.toContain("عبدالله");
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count from users where telegram_id = ${DRIVER_CHAT}
      `;
      expect(rows[0]?.count).toBe("0");
    });

    it("تتعافى الخدمة وحدها عند عودة Redis بلا إعادة تشغيل", async () => {
      redis.setDown(true);
      await post(text("/start"));
      await post(text("عبدالله الحربي"));
      expect(redis.keys()).toHaveLength(0);

      redis.setDown(false);

      await post(text("/start"));
      await post(text("عبدالله الحربي"));
      await post(contact("+966500000111"));
      await post(callback(`city:${cityId}`));
      await post(callback("service:transport"));
      await post(callback("vehicle:sedan"));
      await post(text("أ ب ج 1234"));
      await post(text("1000310001"));
      await post(photo("vphoto_310001"));

      const rows = await sql<{ full_name: string; phone: string }[]>`
        select full_name, phone from users where telegram_id = ${DRIVER_CHAT}
      `;
      expect(rows[0]).toEqual({ full_name: "عبدالله الحربي", phone: "+966500000111" });
    });

    it("انقطاع وسط حوار لا يُتلف جلسةً محفوظة: تعود الخطوة كما كانت", async () => {
      await post(text("/start"));
      await post(text("عبدالله الحربي"));
      const keyBefore = redis.keys();
      expect(keyBefore).toHaveLength(1);
      const rawBefore = redis.rawOf(keyBefore[0] ?? "");

      redis.setDown(true);
      await post(contact("+966500000111"));
      redis.setDown(false);

      // الحالة المحفوظة سليمة كما تُركت — الانقطاع منع التقدّم ولم يُتلف شيئاً
      expect(redis.rawOf(keyBefore[0] ?? "")).toBe(rawBefore);
      expect(JSON.parse(rawBefore ?? "{}").state?.step).toBe("awaiting_phone");
    });
  });
});
