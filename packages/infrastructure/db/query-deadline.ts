/**
 * الغرض: مهلةُ الاستعلامِ من العميلِ على تجمُّعِ مسارِ الطلبِ (`F11-04` · `ADR 0197`) — بطءٌ على
 *   جدولٍ واحدٍ يصيرُ رفضاً مرصوداً (`57014`) عندَ المهلةِ، لا احتجازاً لاتّصالاتِ التجمُّعِ كلِّها.
 * الحالة: منفّذ فعلياً — يُركَّبُ في `createSql` متى مُرِّرَ `queryDeadlineMs`.
 * ينتمي إلى: packages/infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تجمُّعٍ دورُه ذو مهلةٍ في `DB_QUERY_DEADLINE_MS`.
 * ملاحظات مستقبلية: يمسُّ حقولاً داخليّةً في `postgres@3.4.9` (`handle` · `canceller` · `reject`)؛
 *   `tests/integration/pg-brownout.test.ts` يسقطُ إن تغيّرَ شكلُها، وغيابُها يُخفِّضُ إلى `cancel()` العامِّ.
 *
 * ## لماذا بوّابةٌ داخلَ التجمُّعِ لا مؤقِّتٌ وحدَه
 *
 * الإلغاءُ لا يصلُ عبرَ Supavisor استعلاماً **مُخطَّطاً** خلفَ آخرَ على الاتّصالِ نفسِه (مقيسٌ:
 * المُخطَّطُ يُكمِلُ مدّتَه كاملةً رغمَ إلغاءٍ كلَّ 250ms، وفي وضعِ المعاملةِ `6543` يعلقُ)، و`postgres`
 * يُخطِّطُ متى امتلأت الاتّصالاتُ — أي في البطءِ بعينِه. فلا يُسلَّمُ للتجمُّعِ أكثرُ من سقفِه:
 * الزائدُ ينتظرُ ههنا حيثُ رفضُه عندَ المهلةِ مضمونٌ ولا يبلغُ الخادمَ. و`max_pipeline: 0` ليسَ
 * البديلَ: يقطعُ `onexecute` فيسقطُ `sql.begin` بـ`UNSAFE_TRANSACTION` (مقيسٌ).
 */
import type postgres from "postgres";

type AnySql = postgres.Sql<Record<string, never>>;

/** فاصلُ إعادةِ الإلغاءِ ما بقيَ الاستعلامُ معلَّقاً: الإلغاءُ في PostgreSQL نصيحةٌ قد تقعُ في فجوةٍ. */
export const QUERY_CANCEL_RETRY_MS = 250;

export interface QueryDeadlineOptions {
  readonly deadlineMs: number;
  /** ما يُسلَّمُ للتجمُّعِ في آنٍ — سقفُه نفسُه، فلا يُخطَّطُ استعلامٌ خلفَ آخرَ. */
  readonly slots: number;
  readonly onDeadline?: ((info: { readonly deadlineMs: number }) => void) | undefined;
  /** اسمُ التجمُّعِ في أثرِ التوقيتِ التشخيصيِّ (`observeQueryTimings`) وحدَه. */
  readonly label?: string | undefined;
}

/**
 * LOAD-01 (الدفعةُ الحاديةَ عشرةَ) — مراقبُ توقيتٍ تشخيصيٌّ اختياريّ: لكلِّ استعلامٍ انتظارُه مقعدَ
 * البوّابةِ (`waitMs`) وزمنُه من الإرسالِ حتى الحسمِ (`runMs`)، ولكلِّ معاملةٍ/حجزٍ انتظارُه وزمنُ
 * احتجازِه المقعدَ (`holdMs`). بلا مراقبٍ (الافتراض) لا قياسَ ولا كلفة.
 */
export interface QueryTiming {
  readonly label: string;
  readonly kind: "query" | "tx" | "txQuery";
  readonly waitMs: number;
  readonly runMs: number;
  /** أوّلُ 70 حرفًا من نصِّ الاستعلامِ مضغوطَ الفراغ (لا قيمَ: المعاملاتُ لا تدخلُه). */
  readonly sig?: string | undefined;
}

function signatureOf(query: unknown): string | undefined {
  const strings = (query as { strings?: readonly string[] | string }).strings;
  const head =
    typeof strings === "string" ? strings : Array.isArray(strings) ? strings[0] : undefined;
  if (head === undefined) return undefined;
  return String(head).replace(/\s+/g, " ").trim().slice(0, 70);
}
let timingObserver: ((timing: QueryTiming) => void) | null = null;
export function observeQueryTimings(observer: ((timing: QueryTiming) => void) | null): void {
  timingObserver = observer;
}

/** الشكلُ الأدنى من `Query` في `postgres` الذي تمسُّه المهلةُ. */
interface DeadlineQuery extends Promise<unknown> {
  handle(): unknown;
  cancel(): unknown;
  canceller?: ((query: DeadlineQuery) => Promise<unknown>) | null;
  reject?: (cause: unknown) => void;
}

function isQuery(value: unknown): value is DeadlineQuery {
  return (
    value instanceof Promise &&
    typeof (value as Partial<DeadlineQuery>).handle === "function" &&
    typeof (value as Partial<DeadlineQuery>).cancel === "function"
  );
}

/** خطأُ المهلةِ لما لم يبلغ الخادمَ — بالرمزِ نفسِه الذي يُعيدُه إلغاءُ الخادمِ، فالمستدعي يقرأُ واحداً. */
export function queryDeadlineError(deadlineMs: number): Error {
  return Object.assign(new Error(`canceling statement due to query deadline (${deadlineMs}ms)`), {
    code: "57014",
  });
}

/** بوّابةٌ بسعةٍ: منحٌ فوريٌّ أو انتظارٌ بترتيبِ الوصولِ، ويُسحَبُ المنتظِرُ عندَ مهلتِه. */
interface Gate {
  /** يُنادي `grant` حالاً أو لاحقاً؛ ويُعيدُ دالّةَ سحبٍ تصدقُ إن سُحِبَ قبلَ المنحِ. */
  acquire(grant: () => void): () => boolean;
  release(): void;
}

function createGate(capacity: number): Gate {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    acquire(grant) {
      if (active < capacity) {
        active += 1;
        grant();
        return () => false;
      }
      waiting.push(grant);
      return () => {
        const index = waiting.indexOf(grant);
        if (index === -1) return false;
        waiting.splice(index, 1);
        return true;
      };
    },
    release() {
      active -= 1;
      const next = waiting.shift();
      if (next !== undefined) {
        active += 1;
        next();
      }
    },
  };
}

/**
 * يُسلِّحُ المهلةَ **عندَ التنفيذِ لا عندَ الإنشاءِ**: `postgres` كسولٌ، ينفِّذُ في `handle()` أوّلَ ما
 * يُنتظَرُ الاستعلامُ؛ فالشظيّةُ داخلَ استعلامٍ آخرَ لا تُنفَّذُ ولا تُسلَّحُ. والمتابعةُ بـ`then` الأصليِّ
 * كي لا يُطلِقَ التنفيذَ هوَ نفسُه.
 */
function armOnExecute<T>(
  value: T,
  gate: Gate,
  options: QueryDeadlineOptions,
  kind: "query" | "txQuery" = "query",
): T {
  if (!isQuery(value)) return value;
  const query = value;
  const execute = query.handle.bind(query);
  const canceller = typeof query.canceller === "function" ? query.canceller : null;
  let armed = false;
  query.handle = () => {
    if (armed) return;
    armed = true;
    let dispatched = false;
    let fired = false;
    const observer = timingObserver;
    const t0 = observer === null ? 0 : performance.now();
    let tDispatch = 0;
    let retry: ReturnType<typeof setInterval> | undefined;
    const cancelOnce = () => {
      // `canceller` يُلتقَطُ قبلَ أوّلِ `cancel()` لأنّه يُصفِّرُه — فتصحُّ الإعادةُ.
      const pending = canceller === null ? query.cancel() : canceller(query);
      void Promise.resolve(pending).catch(() => {});
    };
    const withdraw = gate.acquire(() => {
      dispatched = true;
      if (observer !== null) tDispatch = performance.now();
      void execute();
    });
    const timer = setTimeout(() => {
      fired = true;
      if (!dispatched && typeof query.reject === "function" && withdraw()) {
        query.reject(queryDeadlineError(options.deadlineMs));
        return;
      }
      cancelOnce();
      if (canceller !== null) {
        retry = setInterval(cancelOnce, QUERY_CANCEL_RETRY_MS);
        retry.unref?.();
      }
    }, options.deadlineMs);
    timer.unref?.();
    const settle = (cause?: unknown) => {
      clearTimeout(timer);
      if (retry !== undefined) clearInterval(retry);
      if (dispatched) gate.release();
      if (observer !== null && dispatched) {
        observer({
          label: options.label ?? "?",
          kind,
          waitMs: tDispatch - t0,
          runMs: performance.now() - tDispatch,
          sig: signatureOf(query),
        });
      }
      if (fired && (cause as { code?: string } | undefined)?.code === "57014") {
        options.onDeadline?.({ deadlineMs: options.deadlineMs });
      }
    };
    Promise.prototype.then.call(
      query,
      () => settle(),
      (cause: unknown) => settle(cause),
    );
  };
  return value;
}

/** يحجزُ مقعداً من البوّابةِ لعملٍ يحتجزُ اتّصالاً (`begin` · `reserve`)؛ وانتظارُه محدودٌ بالمهلةِ. */
function acquireSlot(gate: Gate, options: QueryDeadlineOptions): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let released = false;
    const observer = timingObserver;
    const t0 = observer === null ? 0 : performance.now();
    let tGrant = 0;
    const release = () => {
      if (released) return;
      released = true;
      gate.release();
      if (observer !== null) {
        observer({
          label: options.label ?? "?",
          kind: "tx",
          waitMs: tGrant - t0,
          runMs: performance.now() - tGrant,
        });
      }
    };
    let granted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const withdraw = gate.acquire(() => {
      granted = true;
      if (observer !== null) tGrant = performance.now();
      if (timer !== undefined) clearTimeout(timer);
      resolve(release);
    });
    if (granted) return;
    timer = setTimeout(() => {
      if (withdraw()) {
        options.onDeadline?.({ deadlineMs: options.deadlineMs });
        reject(queryDeadlineError(options.deadlineMs));
      }
    }, options.deadlineMs);
    timer.unref?.();
  });
}

/**
 * يلفُّ `sql` وكلَّ نطاقٍ يُشتقُّ منه (`begin` · `savepoint` · `reserve`) فيمرُّ **كلُّ** استعلامٍ
 * بالمهلةِ — لا ما تذكَّرَ مستدعٍ أن يلفَّه. والمعاملةُ تحتجزُ مقعداً من بوّابةِ التجمُّعِ طولَها،
 * ولها بوّابةٌ بسعةِ واحدٍ لاستعلاماتِها (اتّصالٌ واحدٌ لا يُخطَّطُ عليه). وبقيّةُ الخصائصِ تمرُّ كما هيَ.
 */
export function withQueryDeadline(sql: AnySql, options: QueryDeadlineOptions): AnySql {
  const wrap = <S extends object>(scope: S, gate: Gate, root: boolean): S =>
    new Proxy(scope, {
      apply(target, thisArg, args) {
        return armOnExecute(
          Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args),
          gate,
          options,
          root ? "query" : "txQuery",
        );
      },
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver) as unknown;
        if (typeof member !== "function") return member;
        const bound = (member as (...a: unknown[]) => unknown).bind(target);
        if (property === "unsafe" || property === "file") {
          return (...args: unknown[]) =>
            armOnExecute(bound(...args), gate, options, root ? "query" : "txQuery");
        }
        if (property === "begin" || property === "savepoint") {
          // داخلَ المعاملةِ تتشاركُ نقاطُ الحفظِ بوّابتَها: الاتّصالُ واحدٌ.
          const inner = root ? createGate(1) : gate;
          const run = (...args: unknown[]) =>
            bound(
              ...args.map((arg) =>
                typeof arg === "function"
                  ? (scoped: object) => (arg as (s: object) => unknown)(wrap(scoped, inner, false))
                  : arg,
              ),
            );
          if (!root) return run;
          return async (...args: unknown[]) => {
            const release = await acquireSlot(gate, options);
            try {
              return await run(...args);
            } finally {
              release();
            }
          };
        }
        if (property === "reserve") {
          return async (...args: unknown[]) => {
            const release = root ? await acquireSlot(gate, options) : () => {};
            try {
              const reserved = (await bound(...args)) as AnySql & { release(): void };
              const wrapped = wrap(reserved, createGate(1), false);
              const original = reserved.release.bind(reserved);
              reserved.release = () => {
                original();
                release();
              };
              return wrapped;
            } catch (cause) {
              release();
              throw cause;
            }
          };
        }
        return bound;
      },
    });
  return wrap(sql, createGate(options.slots), true);
}
