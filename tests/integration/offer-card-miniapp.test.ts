import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { asIdentifyingSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { DriverId, OfferId } from "../../packages/shared/kernel/index.ts";
import { ensureActiveCity, restoreCityBaseline } from "../support/active-city.ts";
import { asOrderId } from "../support/in-memory-ports.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const asOfferId = (value: string): OfferId => value as OfferId;
const asDriverId = (value: string): DriverId => value as DriverId;

/**
 * `ADR 0286` — البطاقةُ الإيجابيّةُ لوضعِ المنتجِ: بطاقةُ العرضِ في `BOT_SURFACE_MODE=miniapp`
 * زرُّ تطبيقٍ (`web_app`) لا زرَّ عملٍ. اختبارا `trial-lifecycle` و`wr-19` يثبتان
 * جانبَ التوافقِ (`legacy` بلا زرٍّ)؛ وهذا الملفُ يثبتُ الوجهَ المقصودَ للمنتجِ:
 *
 * - زرُّ تفاصيلِ العرضِ يحملُ `open=offer_<offerId>` — العرضُ المعيّنُ لا كلَّ معلَّقٍ.
 * - زرُّ لوحِ العروضِ يحملُ `open=offers`.
 * - ولا زرَّ قرارٍ (`offer:`) في البطاقةِ أصلًا — القبولُ منَ التطبيقِ لا المحادثةِ.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const DRIVER_TELEGRAM_ID = 900_600_001;
const MINIAPP_BASE = "https://miniapp.cap-test.local";

let sql: Sql;
let driverId = "";
let driverUserId = "";
let cityHandle: Awaited<ReturnType<typeof ensureActiveCity>> | null = null;

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql);
  const cityId = cityHandle.cityId;
  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ البطاقةِ', '+966500600001', 'ar')
    returning id`;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر ط ب 6001')
    returning id`;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (cityHandle !== null) await restoreCityBaseline(sql, cityHandle);
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  if (driverUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${driverUserId}`;
    await sql`delete from users where id = ${driverUserId}`;
  }
  await sql.end();
});

describeIf("ADR 0286 — بطاقةُ العرضِ في وضعِ المنتجِ: زرُّ تطبيقٍ لا زرَّ عملٍ", () => {
  it("miniapp: زرّا التطبيقِ بالهدفينِ الصحيحينِ ولا زرَّ قرارٍ", async () => {
    const sent: SentMessage[] = [];
    const publisher = createOfferPublisher(sql, asIdentifyingSender(capturing(sent)), {
      miniAppUrl: MINIAPP_BASE,
    });
    const offerId = asOfferId("11111111-2222-3333-4444-555555555555");
    await publisher.publishOffer({
      orderId: asOrderId("99999999-8888-7777-6666-555555555555"),
      offerId,
      driverId: asDriverId(driverId),
      distanceKm: 3.5,
      expiresInSeconds: 300,
      service: "transport",
      pickupLabel: "البلد",
      dropoffLabel: "الروضة",
      notes: null,
    });
    expect(sent).toHaveLength(1);
    const markup = JSON.stringify(sent[0]?.markup ?? {});
    // (أ) زرُّ التفاصيلِ: هدفُ العرضِ المعيّنِ — العرضُ واحدٌ لا كلَّ معلَّقٍ (BUG-003).
    expect(markup).toContain("web_app");
    expect(markup).toContain(`open=offer_${offerId}`);
    // (ب) زرُّ اللوحِ: شاشةُ العروضِ.
    expect(markup).toContain("open=offers");
    // (ج) ولا زرَّ قرارٍ في البطاقةِ: لا `offer:` أصلًا.
    expect(markup).not.toContain("offer:");
    // (د) والرسالةُ للسائقِ نفسِهِ بلغتِهِ.
    expect(sent[0]?.chatId).toBe(String(DRIVER_TELEGRAM_ID));
  });

  it("legacy (توافقٌ معزولٌ): بلا miniAppUrl فالبطاقةُ بلا زرٍّ أصلًا", async () => {
    const sent: SentMessage[] = [];
    const publisher = createOfferPublisher(sql, asIdentifyingSender(capturing(sent)), {});
    await publisher.publishOffer({
      orderId: asOrderId("99999999-8888-7777-6666-555555555555"),
      offerId: asOfferId("11111111-2222-3333-4444-666666666666"),
      driverId: asDriverId(driverId),
      distanceKm: 3.5,
      expiresInSeconds: 300,
      service: "transport",
      pickupLabel: "البلد",
      dropoffLabel: "الروضة",
      notes: null,
    });
    expect(sent).toHaveLength(1);
    const markup = JSON.stringify(sent[0]?.markup ?? {});
    expect(markup).not.toContain("offer:");
    expect(markup).not.toContain("web_app");
  });
});
