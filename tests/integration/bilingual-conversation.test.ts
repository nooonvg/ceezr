/**
 * الغرض: محادثة حقيقية بلغتين تكتمل عبر الترجمة، على قاعدة PostgreSQL فعلية ومن خلال
 *   مسار الـ webhook نفسه: سائق يختار الأردية بأمر /language، وعميل يختار الإنجليزية،
 *   ثم يتفاوضان فيصل كلٌّ منهما رسالةَ الآخر بلغته هو مع الأصل مذيَّلاً تحتها.
 *   وتُثبت الحدود: نفس اللغة لا تُترجَم، وسقوط المزوّد لا يقطع المحادثة.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على المرحلة 2.6
 * ملاحظات مستقبلية: المزوّد هنا حتمي بلا شبكة عن قصد؛ التحقّق من مزوّد حقيقي
 *   في scripts/verify-translation.ts لأن CI لا يُضمَن له منفذ إنترنت ولا حصّة مزوّد.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { publishToUnsubscribedGroup } from "../../packages/application/dispatch/publish-to-unsubscribed-group.ts";
import type {
  TranslationProvider,
  TranslationRequest,
} from "../../packages/application/i18n-translation/index.ts";
import { TranslationFailure } from "../../packages/domain/i18n-translation/index.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const UNSUB_GROUP = "-1403";
const ESCALATION_GROUP = "-1402";
const RIDER_CHAT = 610_001;
const DRIVER_CHAT = 620_001;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

/** جملتان من واقع التفاوض، كلٌّ بلغة صاحبها. */
const DRIVER_URDU = "میں پانچ منٹ میں پہنچ رہا ہوں";
const RIDER_ENGLISH = "I am at the pharmacy entrance";
const URDU_TO_ENGLISH = "I am arriving in five minutes";
const ENGLISH_TO_URDU = "میں فارمیسی کے دروازے پر ہوں";

const config: AppConfig = testConfig({
  port: 3994,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

/**
 * مزوّد حتمي بلا شبكة: يترجم جملتَي الاختبار وحدهما ويعدّ نداءاته.
 * الحتمية مقصودة — الغرض إثبات أن مسار الترجمة موصول ويسلك الاتجاهين، لا إثبات
 * جودة مزوّد خارجي. جودة المزوّد يُتحقَّق منها بسكربت على شبكة حقيقية.
 */
function stubProvider(): TranslationProvider & { readonly calls: TranslationRequest[] } {
  const calls: TranslationRequest[] = [];
  const table: Record<string, string> = {
    [`ur|en|${DRIVER_URDU}`]: URDU_TO_ENGLISH,
    [`en|ur|${RIDER_ENGLISH}`]: ENGLISH_TO_URDU,
  };

  return {
    calls,
    name: "stub",
    translate: async (request: TranslationRequest) => {
      calls.push(request);
      const hit = table[`${request.pair.from}|${request.pair.to}|${request.text}`];
      if (hit === undefined) {
        return err(new TranslationFailure("unsupported_pair", "stub", "لا مدخل في جدول الاختبار"));
      }
      return ok({ text: hit, provider: "stub" });
    },
  };
}

/** مزوّد يسقط دائماً — لإثبات أن سقوطه لا يقطع المحادثة. */
function failingProvider(): TranslationProvider {
  return {
    name: "failing",
    translate: async () =>
      err(new TranslationFailure("provider_unavailable", "failing", "HTTP 503")),
  };
}

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let provider: ReturnType<typeof stubProvider>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;

async function post(bot: string, update: unknown): Promise<Response> {
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

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: nextUpdateId(),
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const groupCallback = (userId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: userId }, message: { chat: { id: UNSUB_GROUP } } },
});
const privateCallback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const tr = (lang: string, key: string, params: Record<string, string | number> = {}) =>
  translate(lang, key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("محادثة بلغتين عبر الترجمة على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
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

    await container.close();
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  async function boot(translationProvider: TranslationProvider | null): Promise<void> {
    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      translationProvider,
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  }

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers,
                             orders, subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1401, escalation: ESCALATION_GROUP, unsubscribed: UNSUB_GROUP },
      prior: cityHandle,
    });
    /*
     * بعد D-01، يمرّ مسارُ البوتِ لإنشاءِ الطلبِ عبر `request_ride()` التي تتحقَّقُ من
     * قدرةِ المدينةِ. اختباراتُ هذه المجموعةِ تُنشئُ سائقاً غيرَ مشتركٍ (اشتراكُهُ
     * منتهٍ) لتجربةِ التفاوضِ، فلا يُنشأُ الطلبُ بلا سائقٍ قادرٍ. نُبذر سائقاً
     * قادراً غير متاحٍ لتلبيةِ شرطِ القدرةِ دونَ التدخُّلِ في التفاوضِ.
     */
    await seedCapableDriver({
      sql,
      cityId,
      service: "transport",
      telegramId: 140_099,
    });
    await sql`
      update platform_settings
         set value = case key
                       when 'unsubscribed_claim_slots'       then '3'
                       when 'unsubscribed_collect_seconds'   then '120'
                       when 'unsubscribed_negotiate_seconds' then '180'
                       when 'unsubscribed_max_cycles'        then '3'
                       else value
                     end
       where city_id = ${cityId} and key like 'unsubscribed_%'
    `;

    provider = stubProvider();
    await boot(provider);
  });

  /** سائق مسجَّل ومتحقَّق بلا اشتراك سارٍ — شرط دخوله قناة التفاوض. */
  async function unsubscribedDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "بلال أحمد"));
    await post("driver", contact(DRIVER_CHAT, "0501234567"));
    await post("driver", privateCallback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", privateCallback(DRIVER_CHAT, "service:transport"));
    await post("driver", privateCallback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001002"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001002"));

    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await post("driver", text(DRIVER_CHAT, "/available"));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    return driverId;
  }

  async function registeredRider(): Promise<void> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
  }

  async function searchingOrder(): Promise<OrderId> {
    await post("rider", privateCallback(RIDER_CHAT, "svc:transport"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from orders order by created_at desc limit 1
    `;
    const order = rows[0];
    if (order === undefined) throw new Error("لم يُنشأ الطلب");
    expect(order.status).toBe("searching");
    return order.id as OrderId;
  }

  /** يفتح قناة تفاوض فعلية بين السائق والعميل عبر بطاقة القروب. */
  async function openChannel(): Promise<void> {
    const orderId = await searchingOrder();
    const published = await publishToUnsubscribedGroup({ orderId }, container.negotiation.publish);
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("فشل النشر");
    await post(
      "driver",
      groupCallback(DRIVER_CHAT, `unsub:claim:${published.value.negotiationId}`),
    );
    // NEG-SELECT-01: القناةُ تُفتَحُ باختيارِ العميلِ للسائقِ لا بضغطةِ «قبول» وحدَها.
    await post(
      "rider",
      privateCallback(RIDER_CHAT, `unsub:sel:${published.value.negotiationId}:1`),
    );
  }

  const languageOf = async (telegramId: number): Promise<string | undefined> => {
    const rows = await sql<{ language_code: string }[]>`
      select language_code from users where telegram_id = ${telegramId}
    `;
    return rows[0]?.language_code;
  };

  it("أمر /language يعرض اللغات الثلاث، والاختيار يُكتب في القاعدة ويُسجَّل في التدقيق", async () => {
    await unsubscribedDriver();
    expect(await languageOf(DRIVER_CHAT)).toBe("ar");

    await post("driver", text(DRIVER_CHAT, "/language"));
    const menu = driverSent.at(-1);
    expect(menu?.chatId).toBe(String(DRIVER_CHAT));
    expect(menu?.text).toBe(tr("ar", "language.choose"));
    const markup = menu?.markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup.inline_keyboard.map((row) => row[0]?.callback_data)).toEqual([
      "lang:ar",
      "lang:en",
      "lang:ur",
    ]);

    await post("driver", privateCallback(DRIVER_CHAT, "lang:ur"));
    expect(await languageOf(DRIVER_CHAT)).toBe("ur");
    // التأكيد يصل باللغة الجديدة لا القديمة: أصدق دليل على نفاذ الاختيار
    expect(driverSent.at(-1)?.text).toBe(tr("ur", "language.changed", { language: "🇵🇰 اردو" }));

    const audit = await sql<{ payload: { from: string; to: string } }[]>`
      select payload from audit_log where action = 'user.language_changed'
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toEqual({ from: "ar", to: "ur" });
  });

  it("اختيار اللغة نفسها نجاحٌ بلا كتابة ولا سجلّ تدقيق", async () => {
    await unsubscribedDriver();
    await post("driver", privateCallback(DRIVER_CHAT, "lang:ar"));

    expect(driverSent.at(-1)?.text).toBe(
      tr("ar", "language.unchanged", { language: "🇸🇦 العربية" }),
    );
    const audit = await sql`select 1 from audit_log where action = 'user.language_changed'`;
    expect(audit).toHaveLength(0);
  });

  it("لغة غير مدعومة تُرفض بلا مساس بلغة المستخدم", async () => {
    await unsubscribedDriver();
    await post("driver", privateCallback(DRIVER_CHAT, "lang:fr"));

    expect(driverSent.at(-1)?.text).toBe(tr("ar", "language.unsupported"));
    expect(await languageOf(DRIVER_CHAT)).toBe("ar");
  });

  it("محادثة كاملة بلغتين: كلٌّ يقرأ بلغته، والأصل مذيَّل تحت الترجمة في الاتجاهين", async () => {
    await unsubscribedDriver();
    await post("driver", privateCallback(DRIVER_CHAT, "lang:ur"));
    await registeredRider();
    await post("rider", privateCallback(RIDER_CHAT, "lang:en"));

    expect(await languageOf(DRIVER_CHAT)).toBe("ur");
    expect(await languageOf(RIDER_CHAT)).toBe("en");

    await openChannel();

    // ---------- الاتجاه الأول: أردية ← إنجليزية ----------
    await post("driver", text(DRIVER_CHAT, DRIVER_URDU));

    const toRider = riderSent.filter((m) => m.chatId === String(RIDER_CHAT)).at(-1);
    // القالب بلغة القارئ من القاموس اليدوي، والنصّ الحرّ وحده هو المترجَم
    expect(toRider?.text).toContain(
      tr("en", "negotiation.relay_from_driver", { text: URDU_TO_ENGLISH }),
    );
    // الأصل الأردي مذيَّل تحتها موسوماً بلغته
    expect(toRider?.text).toContain(DRIVER_URDU);
    expect(toRider?.text).toContain(tr("en", "translation.language_name.ur"));
    // ولا أثر للعربية: لغة النظام الافتراضية ليست لغة أحد من الطرفين
    expect(toRider?.text).not.toContain(
      tr("ar", "negotiation.relay_from_driver", { text: "" }).slice(0, 12),
    );

    // ---------- الاتجاه الثاني: إنجليزية ← أردية ----------
    await post("rider", text(RIDER_CHAT, RIDER_ENGLISH));

    const toDriver = driverSent.filter((m) => m.chatId === String(DRIVER_CHAT)).at(-1);
    expect(toDriver?.text).toContain(
      tr("ur", "negotiation.relay_from_rider", { text: ENGLISH_TO_URDU }),
    );
    expect(toDriver?.text).toContain(RIDER_ENGLISH);
    expect(toDriver?.text).toContain(tr("ur", "translation.language_name.en"));

    // نداءان بالاتجاهين الصحيحين — لا ترجمة زائدة ولا اتجاه مقلوب
    expect(provider.calls).toEqual([
      { text: DRIVER_URDU, pair: { from: "ur", to: "en" } },
      { text: RIDER_ENGLISH, pair: { from: "en", to: "ur" } },
    ]);
  });

  it("الترجمة الثانية للنصّ نفسه تأتي من الذاكرة بلا نداء مزوّد جديد", async () => {
    await unsubscribedDriver();
    await post("driver", privateCallback(DRIVER_CHAT, "lang:ur"));
    await registeredRider();
    await post("rider", privateCallback(RIDER_CHAT, "lang:en"));
    await openChannel();

    await post("driver", text(DRIVER_CHAT, DRIVER_URDU));
    await post("driver", text(DRIVER_CHAT, DRIVER_URDU));

    expect(provider.calls).toHaveLength(1);
    const messages = riderSent.filter((m) => m.chatId === String(RIDER_CHAT));
    expect(messages.at(-1)?.text).toContain(URDU_TO_ENGLISH);
    expect(messages.at(-2)?.text).toContain(URDU_TO_ENGLISH);
  });

  it("طرفان بلغة واحدة: لا نداء مزوّد ولا تذييل أصل", async () => {
    await unsubscribedDriver();
    await registeredRider();
    await openChannel();

    await post("driver", text(DRIVER_CHAT, "أنا وصلت عند البوابة"));

    const toRider = riderSent.filter((m) => m.chatId === String(RIDER_CHAT)).at(-1);
    expect(toRider?.text).toBe(
      tr("ar", "negotiation.relay_from_driver", { text: "أنا وصلت عند البوابة" }),
    );
    expect(toRider?.text).not.toContain(tr("ar", "translation.language_name.ar"));
    expect(provider.calls).toHaveLength(0);
  });

  it("سقوط المزوّد لا يقطع المحادثة: الرسالة تصل بلغتها الأصلية", async () => {
    await boot(failingProvider());
    await unsubscribedDriver();
    await post("driver", privateCallback(DRIVER_CHAT, "lang:ur"));
    await registeredRider();
    await post("rider", privateCallback(RIDER_CHAT, "lang:en"));
    await openChannel();

    await post("driver", text(DRIVER_CHAT, DRIVER_URDU));

    const toRider = riderSent.filter((m) => m.chatId === String(RIDER_CHAT)).at(-1);
    // القالب بلغة القارئ كما هو، والنصّ داخله بلغته الأصلية بلا تذييل مكرَّر
    expect(toRider?.text).toBe(tr("en", "negotiation.relay_from_driver", { text: DRIVER_URDU }));
    expect(toRider?.text).not.toContain(tr("en", "translation.language_name.ur"));
  });
});
