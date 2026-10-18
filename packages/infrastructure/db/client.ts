/**
 * الغرض: الاتصال الحقيقي بقاعدة PostgreSQL (قاعدة Supabase نفسها عبر بروتوكول Postgres المباشر).
 *   اخترنا الاتصال المباشر لا PostgREST لأن كل عملياتنا الحرجة دوالُّ قاعدة، ولأن هذا يجعل
 *   المحوّلات قابلة للاختبار على قاعدة محلية حقيقية بلا أي مفتاح إنتاج.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر في tests/integration.
 * ينتمي إلى: infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: كل محوّل في packages/infrastructure، apps/gateway، apps/workers
 * ملاحظات مستقبلية: في الإنتاج يُستخدم رابط pooler الخاص بـ Supabase. يُشتقّ وضعُ pooler
 *   من الرابط عبر detectDbPoolerMode، فإذا كان transaction pooler يُعطَّل `prepare` تلقائيّاً
 *   لأنّ transaction pooling لا يدعم الجُملَ المُحضَّرة (CAP-004 / ADR 0056).
 *
 * **زيادةُ `F8-01` (2026-09-16)**: ههنا `withRequestContext` — **الموضعُ الوحيدُ**
 * الذي ينقلُ معرّفَ وحدةِ العملِ من التطبيقِ إلى المحرِّكِ (`ADR 0129`)، ومنهُ تملأُ
 * مُشغِّلاتُ `before insert` عمودَ `request_id` في الجداولِ المُعلَنةِ.
 */

import postgres from "postgres";
import { PortFailureError } from "../../application/ports/index.ts";
import { DEFAULT_DB_POOL_MAX } from "../../shared/config/connection-budget.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { currentRequestId } from "../observability/correlation.ts";
import { withQueryDeadline } from "./query-deadline.ts";

export type Sql = postgres.Sql<Record<string, never>>;

export interface DbOptions {
  readonly connectionString: string;
  /**
   * سقفُ التجمُّعِ. إن لم يُمرَّر يُؤخَذ `DEFAULT_DB_POOL_MAX` من نموذجِ ميزانيّةِ
   * الاتّصالاتِ (`F7-04`) — لا رقمٌ مكتوبٌ ههنا: افتراضيٌّ مستقلٌّ عن الميزانيّةِ
   * يعني سقفَ إنتاجٍ لا يُحاسَبُ في مجموعِها.
   */
  readonly max?: number;
  /** إن لم يُمرَّر يُشتقّ من رابط الاتصال عبر resolvePrepare. */
  readonly prepare?: boolean;
  /**
   * **مهلةُ الاستعلامِ من العميلِ** (`F11-04` · `ADR 0197`): استعلامٌ لم يستقرَّ بعدَها
   * يُلغى بـ`query.cancel()` — إن كانَ في الطابورِ أُزيلَ منه، وإن كانَ جارياً بلغَ الإلغاءُ
   * الخادمَ فحرَّرَ الاتّصالَ — ويُرفَضُ بـ`57014`. من العميلِ لا من الخادمِ عمداً: Supavisor
   * يُهمِلُ `statement_timeout` مُعامِلَ إقلاعٍ صامتاً (مقيسٌ)، والإلغاءُ يعبرُه. غيابُها = بلا
   * مهلةٍ؛ والقيمةُ لكلِّ دورٍ من `DB_QUERY_DEADLINE_MS` لا رقمٌ ههنا.
   */
  readonly queryDeadlineMs?: number;
  /** يُنادى مرّةً لكلِّ استعلامٍ أُلغيَ بالمهلةِ — فيصيرُ البطءُ مرصوداً لا صامتاً. */
  readonly onQueryDeadline?: (info: { readonly deadlineMs: number }) => void;
  /** اسمُ التطبيقِ في `pg_stat_activity`؛ غيابُه يُبقي افتراضَ المكتبةِ. */
  readonly applicationName?: string;
  /**
   * `OPS-POOL-01` — ثوانٍ يُغلَقُ بعدَها اتّصالٌ خاملٌ فيعودُ مقعدُه إلى Supavisor. غيابُها ⇒
   * `DEFAULT_DB_IDLE_TIMEOUT_SECONDS`؛ و`null` ⇒ لا إغلاقَ (تجمُّعُ الأقفالِ: القفلُ ملكُ الجلسةِ).
   */
  readonly idleTimeoutSeconds?: number | null;
}

/**
 * `OPS-POOL-01` — بلا هذا لا يُحرَّرُ اتّصالٌ فُتِحَ مرّةً، ومجموعُ تجمُّعاتِ العمليةِ الواحدةِ (20)
 * يفوقُ `pool_size` في Supavisor (15، وضعُ الجلسةِ). فنسخةُ النشرِ الجديدةُ تُقلعُ بجانبِ القديمةِ
 * فلا تجدُ مقعداً (`EMAXCONNSESSION`) وتسقطُ فحوصُها — مرصودٌ: نشرُ 5ecfe94 فشلَ 2026-10-02.
 * 20 ثانيةً تُبقي الاتّصالَ حارّاً بينَ دوراتِ المهامِّ (كلَّ 20–60 ثانيةً) وتحرّرُه في التداخلِ.
 */
export const DEFAULT_DB_IDLE_TIMEOUT_SECONDS = 20;

/** وضعُ pooler المُكتشَف من رابط الاتصال. */
export type DbPoolerMode = "transaction" | "session" | "direct" | "unknown";

/**
 * يكشفُ وضعَ pooler من رابط الاتصال:
 * - `transaction`: Supabase transaction pooler (pooler.supabase…:6543) أو `?pgbouncer=true` —
 *   لا يدعم الجُملَ المُحضَّرة، فيُعطَّل `prepare` آمناً قبلَ أن يفشلَ في وقتِ التشغيلِ.
 * - `session`: Supabase session pooler (pooler.supabase…:5432) — يدعمها فتبقى مُفعَّلة.
 * - `direct`: اتصالٌ مباشرٌ (db.…supabase.co أو مضيفٌ محليٌّ) — يدعمها فتبقى مُفعَّلة.
 * - `unknown`: رابطٌ غيرُ قابلٍ للتحليلِ بصيغةِ URL (مثلَ صيغةِ key=value) — يُحافَظُ على السلوكِ السابقِ.
 */
export function detectDbPoolerMode(connectionString: string): DbPoolerMode {
  if (!connectionString) return "unknown";
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return "unknown";
  }
  const host = url.hostname.toLowerCase();
  const port = url.port;
  const isSupabasePooler = host.includes("pooler.supabase");
  const pgbouncer = url.searchParams.get("pgbouncer") === "true";
  if (pgbouncer || (isSupabasePooler && port === "6543")) return "transaction";
  if (isSupabasePooler) return "session";
  return "direct";
}

/**
 * يقررُ هل تُفعَّلُ الجُملُ المُحضَّرةُ (prepared statements).
 * قاعدةُ السلامةِ: pooler المعاملاتِ (transaction) **يمنعُها تماماً** — حتى لو طُلِبَ `prepare:true`
 * صراحةً، لأنّ pooler المعاملاتِ لا يدعمُها فيعطّلُ الإعدادَ آمناً قبلَ أن يفشلَ في وقتِ التشغيلِ.
 * لغيرِ ذلك يُحترَمُ التمريرُ الصريحُ أو يُرجَعُ الافتراضيُّ `true`.
 */
export function resolvePrepare(options: DbOptions): boolean {
  const mode = detectDbPoolerMode(options.connectionString);
  if (mode === "transaction") return false;
  return options.prepare ?? true;
}

export function createSql(options: DbOptions): Sql {
  const sql = postgres(options.connectionString, {
    max: options.max ?? DEFAULT_DB_POOL_MAX,
    prepare: resolvePrepare(options),
    ...(options.idleTimeoutSeconds === null
      ? {}
      : { idle_timeout: options.idleTimeoutSeconds ?? DEFAULT_DB_IDLE_TIMEOUT_SECONDS }),
    onnotice: () => {},
    transform: { undefined: null },
    ...(options.applicationName === undefined
      ? {}
      : { connection: { application_name: options.applicationName } }),
  }) as Sql;
  const deadlineMs = options.queryDeadlineMs;
  if (deadlineMs === undefined) return sql;
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error(`queryDeadlineMs يجبُ أن يكونَ عدداً صحيحاً موجباً: ${deadlineMs}`);
  }
  return withQueryDeadline(sql, {
    deadlineMs,
    slots: options.max ?? DEFAULT_DB_POOL_MAX,
    onDeadline: options.onQueryDeadline,
    label: options.applicationName,
  });
}

/**
 * يلفّ أي استعلام: خطأ القاعدة عطلٌ تقني يُعاد كـ Result، ولا يُرمى استثناءً (القسم 2.5).
 */
export async function guard<T>(
  port: string,
  run: () => Promise<T>,
): Promise<Result<T, PortFailureError>> {
  try {
    return ok(await run());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(new PortFailureError(port, detail));
  }
}

/**
 * اسمُ متغيرِ الجلسةِ (`GUC`) الذي يحملُ معرّفَ وحدةِ العملِ إلى المحرِّكِ (`F8-01`).
 * **موضعُ حقيقةٍ واحدٌ للاسمِ في شِفرةِ TypeScript**، ونسختُه الأخرى الوحيدةُ
 * في دالّةِ `current_request_id()` في الهجرةِ — يحرسُ الاثنتَينِ `check-request-correlation`.
 */
export const REQUEST_ID_SETTING = "app.request_id";

/**
 * يُشغِّلُ عملاً قاعديّاً **داخلَ معاملةٍ واحدةٍ يُعرَّفُ في أوّلِها معرّفُ وحدةِ
 * العملِ**، فتحملُ كلُّ كتابةٍ فيها (سجلُ تدقيقٍ · صندوقٌ صادرٌ) المعرّفَ نفسَه بلا
 * أن يُمرَّرَ وسيطاً إلى مائةِ دالّةٍ.
 *
 * وثلاثةُ قراراتٍ مكتوبةٍ ههنا لا مسكوتٍ عنها:
 *   ــ **`set_config(…, true)` أي: محليٌّ للمعاملةِ لا للجلسةِ**. وسببُه أنَّ
 *      الإنتاجَ يمرُّ بـ`pooler` معاملاتٍ (`CAP-004` · `ADR 0056`): قيمةٌ تبقى في
 *      الجلسةِ تُورَّثُ لطلبٍ أجنبيٍّ يأخذُ الاتّصالَ بعدَك، **فيُنسَبُ عملُه إليك**.
 *      وذاكَ أخطرُ من لا ارتباطٍ ألبتّةَ: أثرٌ يكذِبُ.
 *   ــ **المعاملةُ تُفتَحُ ولو لا سياقَ** فلا تختلفُ ذرّيةُ العملِ باختلافِ وجودِ
 *      معرّفٍ: دالّةٌ تكونُ ذرّيّةً في طلبٍ وغيرَ ذرّيّةٍ في مهمّةٍ عطبٌ مُستترٌ.
 *   ــ **لا توليدَ معرّفٍ ههنا**: غيابُ السياقِ يُترَكُ غياباً، فيكتبُ المُشغِّلُ
 *      `null` في العمودِ — «لم يُقَسْ» لا معرّفٌ يُوهِمُ ربطاً.
 *
 * ومواضعُ النداءِ التي تلفُّ بهذه الدالّةِ **مجموعةٌ مُعلَنةٌ** في
 * `scripts/lib/request-correlation-contract.ts` يحرسُها حاجزٌ، وما لم يُلفَّ بعدُ
 * **دَينٌ مُعلَنٌ لا مُخضَّرٌ**.
 */
export async function withRequestContext<T>(sql: Sql, run: (tx: Sql) => Promise<T>): Promise<T> {
  const requestId = currentRequestId();
  return (await sql.begin(async (tx) => {
    const scoped = tx as unknown as Sql;
    if (requestId !== undefined) {
      await scoped`select set_config(${REQUEST_ID_SETTING}, ${requestId}, true)`;
    }
    return run(scoped);
  })) as T;
}

/** شكل ردّ كل دوال RPC عندنا: jsonb فيه ok وerror. */
export interface RpcEnvelope {
  readonly ok: boolean;
  readonly error?: string | null;
  readonly [key: string]: unknown;
}

export function readEnvelope(value: unknown): RpcEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") return null;
  return candidate as unknown as RpcEnvelope;
}
