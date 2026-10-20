/**
 * الغرض: LOAD-01 (الدفعةُ 21) — قراءتا إقلاعِ الجلسةِ في عبارةٍ واحدة (`bootstrap-account-consents.ts`)
 *   تُطابقانِ القارئَين المستقلَّين حرفًا على قاعدةٍ حقيقيّة، والحظرُ يسري من الطلبِ التالي مباشرةً
 *   (لا تخزينَ عبرَ الطلبات)، وردُّ المبادلةِ (`bootstrapReads`) متطابقٌ بالمسارَين لمستخدمٍ عاديٍّ
 *   ومحظورٍ وغائب.
 * الحالة: اختبارُ تكاملٍ فعليّ — يتطلّبُ `TEST_DATABASE_URL`.
 * الحاكم: docs/adr/0210-session-exchange-embeds-bootstrap-reads.md
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bootstrapReads } from "../../apps/gateway/src/routes/session-telegram.ts";
import type { ConsentDeps } from "../../packages/application/consent/record-consent.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type { ResolveViewerDeps } from "../../packages/application/identity/resolve-viewer.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../../packages/infrastructure/consent/consent-store.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createBootstrapAccountConsents } from "../../packages/infrastructure/identity/bootstrap-account-consents.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";

const USER_TG = 900_002_111;
const BLOCKED_TG = 900_002_112;
const ABSENT_TG = 900_002_113;

/** جلسةٌ صالحةٌ لمعرّفٍ ما — تحقّقُ الجلسةِ نفسِه خارجَ ما يُختبَرُ ههنا (لا يتغيّر). */
function sessionsFor(): MiniAppSessionReader {
  return {
    read: async (token: string) =>
      ok({ telegramUserId: token, bot: "driver", sessionId: `s-${token}`, issuedAtMs: 0 }),
  } as unknown as MiniAppSessionReader;
}

function bootstrapDeps(scoped: boolean) {
  const now = () => new Date();
  const sessions = sessionsFor();
  const viewer: ResolveViewerDeps = {
    sessions,
    accounts: createViewerAccountReader(sql),
    now,
  };
  const consent: ConsentDeps = {
    sessions,
    reader: createConsentRecordReader(sql),
    writer: createConsentRecordWriter(sql),
    now,
  };
  return {
    viewer,
    consent,
    ...(scoped ? { scoped: createBootstrapAccountConsents(sql) } : {}),
  };
}

async function purge(): Promise<void> {
  const ids = [USER_TG, BLOCKED_TG, ABSENT_TG];
  await sql`delete from user_consents where user_id in (select id from users where telegram_id in ${sql(ids)})`;
  await sql`delete from audit_log where actor_user_id in (select id from users where telegram_id in ${sql(ids)})`;
  await sql`delete from users where telegram_id in ${sql(ids)}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL, max: 4 });
  await purge();
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  for (const [tg, blocked] of [
    [USER_TG, false],
    [BLOCKED_TG, true],
  ] as const) {
    await sql`
      insert into users (city_id, telegram_id, role, full_name, phone, language_code, is_blocked)
      values (${cityId}, ${tg}, 'driver', ${`مستخدمُ ${tg}`}, ${`+966500${tg % 1_000_000}`}, 'ar', ${blocked})`;
  }
  // موافقتانِ بترتيبٍ معروفٍ للمستخدمِ العاديّ (الكاتبُ الحقيقيُّ لا إدراجٌ مباشر).
  const writer = createConsentRecordWriter(sql);
  let at = Date.parse("2026-10-01T08:00:00.123Z");
  for (const kind of ["terms_of_service", "privacy_policy"] as const) {
    at += 1_000;
    const recorded = await writer.record({
      telegramUserId: String(USER_TG),
      kind,
      version: "2026-09-01",
      acceptedAtMs: at,
    });
    if (!recorded.ok) throw new Error(`تعذّر تسجيلُ ${kind}: ${JSON.stringify(recorded.error)}`);
  }
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await purge();
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("قراءتا الإقلاعِ في عبارةٍ واحدة — مطابقةُ القارئَين المستقلَّين (الدفعة 21)", () => {
  it("١) الحسابُ والموافقاتُ بالقيمِ والترتيبِ والختمِ نفسِها لكلِّ مستخدم (عاديّ، محظور، غائب، غيرُ رقميّ)", async () => {
    const accounts = createViewerAccountReader(sql);
    const consents = createConsentRecordReader(sql);
    for (const id of [String(USER_TG), String(BLOCKED_TG), String(ABSENT_TG), "not-a-number"]) {
      const scoped = createBootstrapAccountConsents(sql)();
      expect(await scoped.accounts.findByTelegramUserId(id)).toEqual(
        await accounts.findByTelegramUserId(id),
      );
      expect(await scoped.consents.listForTelegramUser(id)).toEqual(
        await consents.listForTelegramUser(id),
      );
    }
    const mine = await consents.listForTelegramUser(String(USER_TG));
    expect(mine.ok && mine.value.length).toBe(2);
  });

  it("٢) الحظرُ بينَ طلبَين يسري في الطلبِ التالي مباشرةً — لا ذاكرةَ عبرَ الطلبات", async () => {
    const factory = createBootstrapAccountConsents(sql);
    const before = await factory().accounts.findByTelegramUserId(String(USER_TG));
    expect(before.ok && before.value?.isBlocked).toBe(false);
    await sql`update users set is_blocked = true where telegram_id = ${USER_TG}`;
    try {
      const after = await factory().accounts.findByTelegramUserId(String(USER_TG));
      expect(after.ok && after.value?.isBlocked).toBe(true);
      // والعكسُ كذلك: رفعُ الحظرِ يسري فورًا.
      await sql`update users set is_blocked = false where telegram_id = ${USER_TG}`;
      const lifted = await factory().accounts.findByTelegramUserId(String(USER_TG));
      expect(lifted.ok && lifted.value?.isBlocked).toBe(false);
    } finally {
      await sql`update users set is_blocked = false where telegram_id = ${USER_TG}`;
    }
  });

  it("٣) تغيّرُ الدورِ بينَ طلبَين يُقرأُ طازجًا في الطلبِ التالي", async () => {
    const factory = createBootstrapAccountConsents(sql);
    const first = await factory().accounts.findByTelegramUserId(String(USER_TG));
    expect(first.ok && first.value?.role).toBe("driver");
    await sql`update users set role = 'rider' where telegram_id = ${USER_TG}`;
    try {
      const second = await factory().accounts.findByTelegramUserId(String(USER_TG));
      expect(second.ok && second.value?.role).toBe("rider");
    } finally {
      await sql`update users set role = 'driver' where telegram_id = ${USER_TG}`;
    }
  });

  it("٤) ردُّ المبادلةِ متطابقٌ بالمسارَين: عاديّ، ومحظور (حالتُه تصلُ كما هي)، وغائب", async () => {
    for (const id of [String(USER_TG), String(BLOCKED_TG), String(ABSENT_TG)]) {
      const plain = await bootstrapReads(bootstrapDeps(false), id);
      const combined = await bootstrapReads(bootstrapDeps(true), id);
      expect(combined).toEqual(plain);
    }
    const blocked = await bootstrapReads(bootstrapDeps(true), String(BLOCKED_TG));
    const plainBlocked = await bootstrapReads(bootstrapDeps(false), String(BLOCKED_TG));
    expect(blocked.viewer).toEqual(plainBlocked.viewer);
  });

  it("٥) نطاقٌ واحدٌ = عبارةٌ واحدة، ونطاقانِ = عبارتان (لا مشاركةَ بينَ طلبَين)", async () => {
    let calls = 0;
    const counting = {
      unsafe: (...args: Parameters<Sql["unsafe"]>) => {
        calls += 1;
        return sql.unsafe(...args);
      },
    } as unknown as Sql;
    const factory = createBootstrapAccountConsents(counting);
    const scoped = factory();
    const [a, c] = await Promise.all([
      scoped.accounts.findByTelegramUserId(String(USER_TG)),
      scoped.consents.listForTelegramUser(String(USER_TG)),
    ]);
    expect(a.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(calls).toBe(1);
    await factory().accounts.findByTelegramUserId(String(USER_TG));
    expect(calls).toBe(2);
  });

  it("٦) فشلُ العبارة = فشلُ القراءتَين معًا بسببٍ مصنَّف — والمبادلةُ تحذفُهما ولا تسقط", async () => {
    const failing = {
      unsafe: () => Promise.reject(new Error("db down")),
    } as unknown as Sql;
    const scoped = createBootstrapAccountConsents(failing)();
    const a = await scoped.accounts.findByTelegramUserId(String(USER_TG));
    const c = await scoped.consents.listForTelegramUser(String(USER_TG));
    expect(a.ok).toBe(false);
    expect(c.ok).toBe(false);
    const deps = { ...bootstrapDeps(false), scoped: createBootstrapAccountConsents(failing) };
    expect(await bootstrapReads(deps, String(USER_TG))).toEqual({});
  });
});
