/**
 * الغرض: SEC-19 بندُ الترتيبِ ٣ — التحقُّقُ من أنَّ `trip_tracking_tokens.created_by_user_id`
 *   يُكتبُ ويُستعمَلُ بدلاً من `created_by` (bigint) في الإلغاءِ والحذفِ.
 *
 *   (١) **العمودُ موجودٌ** والربطُ الخارجيُّ إلى `users(id)` قائمٌ.
 *   (٢) **الإصدارُ يكتبُ العمودينِ**: `created_by_user_id` لا `null`، و`created_by`
 *       يَساوي `p_telegram_id`.
 *   (٣) **الإلغاءُ يطابقُ بـ`created_by_user_id`**: رمزٌ صادرٌ من راكبٍ يُلغى
 *       برقمِ تيليجرامِ ذلك الراكبِ، ورمزٌ من راكبٍ آخرَ لا يُلغى.
 *   (٤) **التجهيلُ يَحذُفُ بـ`created_by_user_id`**: بعدَ التجهيلِ لا يبقى رمزٌ
 *       لذلك المستخدمِ — لا بـ`telegram_id` الذي صارَ سالبًا ولا بغيره.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL. أُضيف في 2026-09-22.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createTrackingTokenMint,
  createTrackingTokenRpc,
} from "../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import type { OrderId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM = 260_819;
const OTHER_TELEGRAM = 260_820;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let tokens: ReturnType<typeof createTrackingTokenRpc>;
const mint = createTrackingTokenMint();

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

async function seedRiderAndOrder(
  sql: Sql,
  telegramId: number,
  cityId: string,
): Promise<{ riderId: string; userId: string; orderId: string }> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, language_code, full_name)
    values (${cityId}, ${telegramId}::bigint, 'rider', 'ar', 'اختبار')
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");

  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${userId}::uuid) returning id
  `;
  const riderId = riders[0]?.id;
  if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff)
    values (${cityId}, ${riderId}::uuid, 'transport', 'searching',
      st_point(39.1751, 21.5471)::geography,
      st_point(39.1901, 21.5601)::geography)
    returning id
  `;
  const orderId = orders[0]?.id;
  if (orderId === undefined) throw new Error("تعذّر إنشاء الطلب");

  return { riderId, userId, orderId };
}

describeIf("SEC-19 بندُ ٣ — ربطُ `created_by` بـ`users.id`", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    tokens = createTrackingTokenRpc(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table trip_tracking_tokens, tracking_sessions, audit_log, attendance_log,
                             order_offers, orders, driver_availability, driver_capabilities,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table trip_tracking_tokens, tracking_sessions, audit_log, attendance_log,
                             order_offers, orders, driver_availability, driver_capabilities,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  });

  it("العمودُ والربطُ الخارجيُّ موجودانِ", async () => {
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_name = 'trip_tracking_tokens' and column_name = 'created_by_user_id'
    `;
    expect(cols.length).toBe(1);

    const fks = await sql<{ constraint_name: string }[]>`
      select constraint_name from information_schema.table_constraints
       where table_name = 'trip_tracking_tokens'
         and constraint_type = 'FOREIGN KEY'
         and constraint_name = 'trip_tracking_tokens_created_by_user_id_fkey'
    `;
    expect(fks.length).toBe(1);
  });

  it("الإصدارُ يكتبُ `created_by_user_id` معَ `created_by`", async () => {
    const { orderId } = await seedRiderAndOrder(sql, RIDER_TELEGRAM, cityId);
    const token = mint.mint();
    const result = await tokens.issue(orderId as OrderId, RIDER_TELEGRAM, token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);

    const rows = await sql<{ created_by: string; created_by_user_id: string }[]>`
      select created_by, created_by_user_id from trip_tracking_tokens where token = ${token}
    `;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]?.created_by)).toBe(RIDER_TELEGRAM);
    expect(rows[0]?.created_by_user_id).not.toBeNull();
  });

  it("الإلغاءُ يطابقُ بـ`created_by_user_id` — المالكُ يُلغي، وغيرُه لا", async () => {
    const { orderId } = await seedRiderAndOrder(sql, RIDER_TELEGRAM, cityId);
    const { orderId: otherOrderId } = await seedRiderAndOrder(sql, OTHER_TELEGRAM, cityId);

    const token1 = mint.mint();
    const token2 = mint.mint();
    const issue1 = await tokens.issue(orderId as OrderId, RIDER_TELEGRAM, token1);
    expect(issue1.ok).toBe(true);
    if (!issue1.ok) return;
    expect(issue1.value.ok).toBe(true);
    const issue2 = await tokens.issue(otherOrderId as OrderId, OTHER_TELEGRAM, token2);
    expect(issue2.ok).toBe(true);
    if (!issue2.ok) return;
    expect(issue2.value.ok).toBe(true);

    // المالكُ يُلغي رمزَه
    const revokeOk = await tokens.revoke(token1, RIDER_TELEGRAM);
    expect(revokeOk.ok).toBe(true);
    if (!revokeOk.ok) return;
    expect(revokeOk.value).toBe(true);

    // غيرُ المالكِ لا يُلغي رمزَ غيره
    const revokeFail = await tokens.revoke(token2, RIDER_TELEGRAM);
    expect(revokeFail.ok).toBe(true);
    if (!revokeFail.ok) return;
    expect(revokeFail.value).toBe(false);

    // رمزُ المالكِ مُلغى، ورمزُ غيره لم يُمسَّ
    const rows = await sql<{ token: string; revoked_at: string | null }[]>`
      select token, revoked_at from trip_tracking_tokens order by token
    `;
    const t1 = rows.find((r) => r.token === token1);
    const t2 = rows.find((r) => r.token === token2);
    expect(t1?.revoked_at).not.toBeNull();
    expect(t2?.revoked_at).toBeNull();
  });

  it("التجهيلُ يَحذُفُ رموزَ التتبُّعِ بـ`created_by_user_id`", async () => {
    const { orderId, userId } = await seedRiderAndOrder(sql, RIDER_TELEGRAM, cityId);
    const token = mint.mint();
    const issueResult = await tokens.issue(orderId as OrderId, RIDER_TELEGRAM, token);
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) return;
    expect(issueResult.value.ok).toBe(true);

    // قبلَ التجهيلِ: الرمزُ موجودٌ
    const before = await sql<{ count: number }[]>`
      select count(*)::int as count from trip_tracking_tokens where created_by_user_id = ${userId}
    `;
    expect(before[0]?.count).toBe(1);

    // إنهاءُ الطلبِ قبلَ التجهيلِ: `erase_my_account` يرفضُ الطلباتِ الجاريةَ
    // `cancelled` لا يلزمُ سائقًا (`orders_matched_requires_driver`)
    await sql`update orders set status = 'cancelled' where id = ${orderId}::uuid`;

    // التجهيلُ
    const eraseResult = await sql`select erase_my_account(${RIDER_TELEGRAM}::bigint) as result`;
    const envelope = eraseResult[0]?.result as { ok?: boolean; reason?: string } | null;
    expect(envelope?.ok).toBe(true);

    // بعدَ التجهيلِ: لا رمزَ لذلك المستخدمِ
    const after = await sql<{ count: number }[]>`
      select count(*)::int as count from trip_tracking_tokens where created_by_user_id = ${userId}
    `;
    expect(after[0]?.count).toBe(0);
  });

  // ------------------------------------------------------------------
  // SEC-19 بندُ ٤ (متابعة): `erase_my_account` يكتبُ `null` لا السالبَ
  // ------------------------------------------------------------------
  it("التجهيلُ يكتبُ `telegram_id = null` و`erased_at` ويُحصِّنُ القيدَ", async () => {
    const { orderId, userId } = await seedRiderAndOrder(sql, RIDER_TELEGRAM, cityId);
    const token = mint.mint();
    const issueResult = await tokens.issue(orderId as OrderId, RIDER_TELEGRAM, token);
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) return;
    expect(issueResult.value.ok).toBe(true);

    // إنهاءُ الطلبِ قبلَ التجهيلِ
    await sql`update orders set status = 'cancelled' where id = ${orderId}::uuid`;

    // التجهيلُ
    const eraseResult = await sql`select erase_my_account(${RIDER_TELEGRAM}::bigint) as result`;
    const envelope = eraseResult[0]?.result as { ok?: boolean; reason?: string } | null;
    expect(envelope?.ok).toBe(true);

    // ١. `telegram_id` صارَ `null` لا سالبًا
    const rows = await sql<
      {
        telegram_id: string | null;
        erased_at: string | null;
        full_name: string | null;
        phone: string | null;
        telegram_username: string | null;
      }[]
    >`
      select telegram_id, erased_at, full_name, phone, telegram_username
        from users where id = ${userId}::uuid`;
    expect(rows[0]?.telegram_id).toBeNull();
    expect(rows[0]?.erased_at).not.toBeNull();
    expect(rows[0]?.full_name).toBeNull();
    expect(rows[0]?.phone).toBeNull();
    expect(rows[0]?.telegram_username).toBeNull();

    // ٢. `trip_tracking_tokens` لذلك `user_id` = 0
    const tokensAfter = await sql<{ count: number }[]>`
      select count(*)::int as count from trip_tracking_tokens where created_by_user_id = ${userId}::uuid
    `;
    expect(tokensAfter[0]?.count).toBe(0);

    // ٣. القيدُ `users_erased_rows_carry_no_identity` يَقبَلُ `null`: صفٌّ
    // مُجهَّلٌ بلا هويّةٍ. لكنَّ صفًّ غيرَ مُجهَّلٍ بلا مُعرِّفٍ يُرفَضُ.
    const constraint = await sql<{ conname: string }[]>`
      select conname from pg_constraint
       where conname = 'users_erased_rows_carry_no_identity'`;
    expect(constraint.length).toBe(1);

    // ٤. مُحاوَلةُ إدخالِ صفٍّ مُجهَّلٍ يحملُ اسمًا — يُرفَضُ بالقيدِ
    let rejected = false;
    try {
      await sql`
        insert into users (city_id, telegram_id, role, full_name, phone,
                           telegram_username, is_blocked, erased_at)
        values (${cityId}::uuid, null, 'rider',
                'متبقٍ', null, null, true, now())
      `;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
