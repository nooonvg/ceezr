/**
 * قياسٌ مقارنٌ لمتوسطِ زمنِ `claim_notification_delivery()` بينَ تعريفَينِ للدالةِ
 * (main مقابلَ المرشَّحِ) على قاعدتَينِ متطابقتَي البذرِ (طابورٌ من أنواعٍ غيرِ `offer` — `rider_trip_notice`/`order_chat_message`؛ كلفةُ الاستبعادِ تقاسُ على مسحِ المرشحينَ لا على معالجةِ عروضٍ محسومةٍ فعليةٍ) — نفسُ منهجيةِ
 * `outbox-claim-index.test.ts` (بذرٌ فعليٌّ ثمّ ANALYZE ثمّ وسيطُ العيناتِ الدافئةِ).
 * تشغيلٌ يدويٌّ واحدٌ لا اختبارٌ: يُطبعُ الوسيطُ ولا يسقطُ.
 * الأمرُ الموثقُ (من أصلِ المستودعِ): DATABASE_URL="postgres://..."
 *   bun run docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/fixAB500b/ab-claim-latency.ts
 */
import { createSql } from "../../../../../../../packages/infrastructure/db/client.ts";

const url = process.env.DATABASE_URL ?? process.argv[2];
if (url === undefined) throw new Error("استعمل: DATABASE_URL=... bun scripts/ab-claim-latency.ts");
const pool = createSql({ connectionString: url });

const SEED_ROWS_PER_GROUP = 5_000;
/** أنواعٌ بلا قيدِ شكلِ العرضِ — نفسُ منهجيةِ `outbox-claim-index.test.ts`. */
const SEED_KINDS = ["rider_trip_notice", "order_chat_message"] as const;

async function countOutbox(): Promise<number> {
  const [row] = await pool<{ n: string }[]>`select count(*)::text as n from notification_outbox`;
  return Number(row?.n ?? 0);
}

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
  for (let r = 0; r < 4; r += 1) {
    const [row] = await pool<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values ((select id from cities where code = 'JED'),
              (select id from riders where user_id in (select id from users where telegram_id = ${900000000001 + r}::bigint)),
              'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography)
      returning id
    `;
    if (row === undefined) continue;
    for (let rr = 0; rr < 4; rr += 1) {
      const [u] = await pool<{ id: string }[]>`
        select id from users where telegram_id = ${900000000001 + rr}::bigint
      `;
      if (u === undefined) continue;
      for (const kind of SEED_KINDS) {
        await pool`
          insert into notification_outbox
                (city_id, kind, status, next_attempt_at, created_at, payload, dedup_key, recipient_user_id, order_id)
          select (select id from cities where code = 'JED'), ${kind}, 'pending', now(),
                 now() - make_interval(secs => ${SEED_ROWS_PER_GROUP} - g),
                 jsonb_build_object('seed', 'ab-claim-latency'),
                 'ab-claim-latency-' || ${row.id} || '-' || ${rr} || '-' || ${kind} || '-' || g,
                 ${u.id}::uuid, ${row.id}::uuid
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

// (٠) إثباتُ اختلافِ التعريفِ بينَ القاعدتَينِ كما هو مقصودٌ — التوقعُ مدخلٌ صريحٌ:
//   AB_EXPECT_SKIP=false للتعريفِ القديمِ (main السابق) و=true للمرشّحِ (هجرةُ التخطي).
//   الأداةُ ترفضُ القياسَ إن خالفَ التعريفُ المُعلَنَ (قياسُ الجانبِ الخطأِ بلا ملاحظةٍ
//   أسوأُ من عدمِ القياسِ).
const expectSkip = (process.env.AB_EXPECT_SKIP ?? "true") === "true";
const [def] = await pool<{ len: string; hasSkip: boolean }[]>`
  select length(prosrc)::text as len, prosrc like '%decided%' as "hasSkip"
  from pg_proc where proname = 'claim_notification_delivery'`;
console.log(`AB_DEF len=${def?.len} hasSkipMarker=${def?.hasSkip} expected=${expectSkip}`);
if (def?.hasSkip !== expectSkip) {
  throw new Error(
    `التعريفُ (${def?.hasSkip}) يخالفُ المتوقعَ (${expectSkip}) — قِستَ الدالةَ على الجانبِ الخطأِ أو القاعدةِ الخطأِ؛ عيّن AB_EXPECT_SKIP.`
  );
}

// (٠.٥) تنظيفُ أيِّ بقايا جولةٍ سابقةٍ (القياسُ قابلٌ للإعادةِ)
await cleanup();
// (١) البذرُ الفعليُّ والتحققُ
await seed();
const seeded = await countOutbox();
console.log(`AB_SEEDED_ROWS=${seeded}`);
if (seeded < 60_000) throw new Error(`البذرُ ناقصٌ: ${seeded}`);

// (٢) القياسُ: كلُّ نداءٍ يُثبَتُ أنه التقاطٌ فعليٌّ (لا خروجًا فارغًا)
const results: number[] = [];
let realClaims = 0;
for (let i = 0; i < 6; i += 1) {
  const started = performance.now();
  const claimed = await pool`select claim_notification_delivery() as c`;
  results.push(performance.now() - started);
  const row = (claimed[0]?.c ?? {}) as { ok?: boolean; delivery?: { delivery_id?: string } | null };
  if (row.ok !== true) throw new Error(`التقاطٌ مرفوضٌ: ${JSON.stringify(row)}`);
  if (row.delivery !== null && row.delivery !== undefined) realClaims += 1;
}
console.log(`AB_REAL_CLAIMS=${realClaims}/6`);
if (realClaims === 0) throw new Error("كلُّ النداءاتِ عادت فارغةً — القياسُ غيرُ صالحٍ");
const warm = results.slice(1).sort((a, b) => a - b);
const median = warm[Math.floor(warm.length / 2)];
console.log(`AB_CLAIM_MEDIAN_MS=${median.toFixed(2)}`);
await cleanup();
await pool.end({ timeout: 5 });
