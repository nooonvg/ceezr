/**
 * الغرض: إثباتُ أنّ تحذيرَ قربِ الانتهاء مقصورٌ على مدينةِ المهمّة. الدالّةُ كانت
 *   تُعيد اشتراكاتِ كلّ المدن، والمهمّةُ مسجَّلةٌ لكلّ مدينة وتُطلق مع أخواتها في
 *   نفس النبضة بأقفالٍ مختلفة — فالسائقُ الواحد كان يستقبل تحذيراً بعددِ المدن
 *   النشطة، وبعددِ أيّامٍ مقروءةٍ من إعداداتِ مدينةٍ ليست مدينته.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديل على `subscriptions_expiring_soon`
 *   أو على مهمّة `warn-expiring`.
 * ملاحظات مستقبلية: القاعدةُ العامّة التي يحرسها هذا الملفّ: نطاقُ المهمّة ونطاقُ
 *   استعلامها واحد. أيُّ دالّةٍ تُناديها مهمّةٌ لكلّ مدينة تُرشَّح بالمدينة.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { warnExpiringSubscriptions } from "../../packages/application/subscription/expire-subscriptions.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSubscriptionLifecycleRpc } from "../../packages/infrastructure/subscription/lifecycle-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let jeddah: CityId;
let riyadh: CityId;

async function cityByCode(code: string): Promise<CityId> {
  const rows = await sql<{ id: string }[]>`select id from cities where code = ${code}`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`لم تُبذَر المدينة ${code}`);
  return id as CityId;
}

/** سائقٌ باشتراكٍ ينتهي بعد يومٍ واحد في المدينة المطلوبة. */
async function seedExpiring(cityId: CityId, telegramId: number): Promise<string> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}, ${telegramId}, 'سائق النطاق', '0500000000', 'ar', 'driver')
    returning id
  `;
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${users[0]?.id ?? ""}, 'verified')
    returning id
  `;
  const subs = await sql<{ id: string }[]>`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
    values (${cityId}, ${drivers[0]?.id ?? ""}, 'transport', 'active', now() + interval '20 hours')
    returning id
  `;
  return subs[0]?.id ?? "";
}

describeIf("نطاقُ تحذير قربِ الانتهاء", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    jeddah = await cityByCode("JED");
    riyadh = await cityByCode("RUH");
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table audit_log, subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table audit_log, subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
  });

  it("الدالّةُ تُعيد اشتراكاتِ المدينة المطلوبة وحدَها", async () => {
    const inJeddah = await seedExpiring(jeddah, 610_001);
    await seedExpiring(riyadh, 610_002);

    const rows = await sql<
      { result: { ok: boolean; subscriptions: { subscription_id: string }[] } }[]
    >`
      select subscriptions_expiring_soon(${jeddah}::uuid, 2) as result
    `;
    const payload = rows[0]?.result;
    expect(payload?.ok).toBe(true);
    expect(payload?.subscriptions.map((row) => row.subscription_id)).toEqual([inJeddah]);
  });

  it("مدينةٌ مجهولةٌ تُرفض صريحاً، ولا تُقرأ قائمةً عابرةً للمدن", async () => {
    await seedExpiring(jeddah, 610_003);
    const rows = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select subscriptions_expiring_soon('00000000-0000-0000-0000-000000000000'::uuid, 2) as result
    `;
    expect(rows[0]?.result.ok).toBe(false);
    expect(rows[0]?.result.error).toBe("CITY_NOT_FOUND");
  });

  it("الصيغةُ العابرةُ للمدن محذوفةٌ فعلاً — فلا نداءَ ناسيٍ للمدينة ينجح", async () => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n
        from pg_proc
       where proname = 'subscriptions_expiring_soon'
         and pg_get_function_identity_arguments(oid) = 'integer'
    `;
    expect(rows[0]?.n).toBe("0");
  });

  /**
   * العطبُ الذي كان: مهمّتان لمدينتين تُطلقان في نفس النبضة (`Promise.all` في
   * المشغّل، والقفلُ مفتاحُه اسمُ المهمّة فيختلف بينهما)، وكلتاهما تقرأ القائمةَ
   * قبل أن تكتب الأخرى `subscription.expiry_warned` — فيصل السائقَ تحذيران.
   */
  it("شوطان متزامنان لمدينتين: كلُّ سائقٍ يُحذَّر مرّةً واحدةً لا مرّتين", async () => {
    await seedExpiring(jeddah, 610_004);
    await seedExpiring(riyadh, 610_005);

    const sent: { chatId: string; text: string }[] = [];
    const rpc = createSubscriptionLifecycleRpc(sql);
    const deps = {
      rpc,
      sender: {
        send: async (input: { chatId: string; text: string }) => {
          sent.push({ chatId: input.chatId, text: input.text });
          return ok(undefined);
        },
      },
    };

    const [first, second] = await Promise.all([
      warnExpiringSubscriptions({ cityId: jeddah, days: 2 }, deps),
      warnExpiringSubscriptions({ cityId: riyadh, days: 2 }, deps),
    ]);

    if (!first.ok || !second.ok) throw new Error("تعذّر شوطُ التحذير");
    expect(first.value.warned).toBe(1);
    expect(second.value.warned).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent.map((message) => message.chatId).sort()).toEqual(["610004", "610005"]);
  });
});
