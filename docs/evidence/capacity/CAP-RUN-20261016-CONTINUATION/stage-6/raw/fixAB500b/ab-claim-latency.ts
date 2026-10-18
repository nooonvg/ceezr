/**
 * قياسٌ مقارنٌ لمتوسطِ زمنِ `claim_notification_delivery()` بينَ تعريفَينِ للدالةِ
 * (main مقابلَ المرشَّحِ) على قاعدتَينِ متطابقتَي البياناتِ — نفسُ منهجيةِ
 * `outbox-claim-index.test.ts` (بذرٌ ثمّ ANALYZE ثمّ وسيطُ العيناتِ الدافئةِ).
 * تشغيلٌ يدويٌّ واحدٌ لا اختبارٌ: يُطبعُ الوسيطُ ولا يسقطُ.
 */
import { createSql } from "../packages/infrastructure/db/client.ts";

const url = process.env.DATABASE_URL ?? process.argv[2];
if (url === undefined) throw new Error("استعمل: bun scripts/ab-claim-latency.ts <DATABASE_URL>");
const pool = createSql({ connectionString: url });

const SEED_ROWS_PER_GROUP = 5_000;
const RIDE_KINDS = ["offer", "rider_trip", "driver_order"];

async function seed(): Promise<void> {
  await pool`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select (select id from cities where code = 'JED'), 900000000001 + g, 'rider', 'قياس', '+966500000001'
    from generate_series(0, 3) g
  `;
  await pool`
    insert into riders (city_id, user_id)
    select (select id from cities where code = 'JED'), u.id from users u
    where u.telegram_id between 900000000001 and 900000000004
  `;
  const orderIds: string[] = [];
  for (let r = 0; r < 4; r += 1) {
    const [row] = await pool<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values ((select id from cities where code = 'JED'),
              (select id from riders where user_id in (select id from users where telegram_id = ${900000000001 + r}::bigint)),
              'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography)
      returning id
    `;
    if (row !== undefined) orderIds.push(row.id);
  }
  for (const orderId of orderIds) {
    for (let r = 0; r < 4; r += 1) {
      const [u] = await pool<{ id: string }[]>`
        select id from users where telegram_id = ${900000000001 + r}::bigint
      `;
      if (u === undefined) continue;
      for (const kind of RIDE_KINDS) {
        await pool`
          insert into notification_outbox
                (city_id, kind, status, next_attempt_at, created_at, payload, dedup_key, recipient_user_id, order_id)
          select (select id from cities where code = 'JED'), ${kind}, 'pending', now(),
                 now() - make_interval(secs => ${SEED_ROWS_PER_GROUP} - g),
                 jsonb_build_object('seed', 'ab-claim-latency'),
                 'ab-claim-latency-' || ${orderId} || '-' || ${r} || '-' || ${kind} || '-' || g,
                 ${u.id}::uuid, ${orderId}::uuid
              from generate_series(1, ${SEED_ROWS_PER_GROUP}) g
        `;
      }
    }
  }
  await pool`analyze notification_outbox`;
}

async function cleanup(): Promise<void> {
  await pool`delete from notification_outbox where dedup_key like 'ab-claim-latency-%'`;
  await pool`delete from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id between 900000000001 and 900000000004))`;
  await pool`delete from riders where user_id in (select id from users where telegram_id between 900000000001 and 900000000004)`;
  await pool`delete from users where telegram_id between 900000000001 and 900000000004`;
}

const results: number[] = [];
for (let i = 0; i < 6; i += 1) {
  const started = performance.now();
  const claimed = await pool`select claim_notification_delivery() as c`;
  results.push(performance.now() - started);
  const row = (claimed[0]?.c ?? {}) as { ok?: boolean; backpressure?: string };
  if (row.ok !== true) throw new Error(`التقاطٌ مرفوضٌ: ${JSON.stringify(row)}`);
}
const warm = results.slice(1).sort((a, b) => a - b);
const median = warm[Math.floor(warm.length / 2)];
console.log(`AB_CLAIM_MEDIAN_MS=${median.toFixed(2)}`);
await cleanup();
await pool.end({ timeout: 5 });
