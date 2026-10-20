/**
 * `LOAD-01 · P4` — أثرُ تشخيصٍ لمسارِ البثِّ الفوريِّ (اختياريٌّ، مُعطَّلٌ افتراضيّاً).
 *
 * يُفعَّلُ بـ`DISPATCH_TRACE_FILE=<مسار>` وحدَه، فلا يتغيّرُ سلوكٌ ولا كلفةٌ بغيابِه
 * (الدالّةُ تُعيدُ `null` والمستدعي يمرُّ على الأصلِ حرفيّاً). يكتبُ JSONL:
 *
 * - `pass`: شوطُ مدينةٍ واحدٌ — زمنُ قبولِ أوّلِ إطلاقٍ غذّاه، وبدؤه، وقراءةُ الإعداداتِ
 *   والباحثِ، وعددُ المفحوصِ، ومدّتُه.
 * - `order`: طلبٌ واحدٌ داخلَ الشوطِ بمعرّفِه — كلُّ نداءِ منفذٍ بمدّتِه من جهةِ العميلِ
 *   (`findById`/`settings`/`offers`/`nearby`/`all`/`openRound`) وكلفةُ المطابقةِ في
 *   الذاكرةِ (الباقي من المجموعِ بعدَ النداءاتِ)، والنتيجةُ والدورةُ.
 * - `probe` كلَّ ثانيةٍ: `select 1` على تجمُّعِ البوابةِ (انتظارُ تجمُّعٍ + RTT + تنفيذ)
 *   وعلى اتّصالٍ مخصَّصٍ خارجَ التجمُّعِ (RTT + تنفيذ وحدَهما) — الفرقُ تقديرُ انتظارِ
 *   التجمُّعِ — وتأخُّرُ حلقةِ الأحداثِ (p50/p99/max)، واستهلاكُ CPU للعمليةِ، والذاكرة.
 *
 * لا يلمسُ Redis: مسارُ البثِّ كلُّه على PostgreSQL (المرشَّحونَ من `drivers.last_location`)،
 * فغيابُ Redis عن الأثرِ حقيقةُ المسارِ لا ثغرةُ قياسٍ.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { BroadcastDependencies } from "../../../../packages/application/dispatch/broadcast-offers.ts";
import type { SearchingOrderFinder } from "../../../../packages/application/dispatch/redispatch-searching-orders.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";

type Phase = "findById" | "settings" | "offers" | "nearby" | "all" | "openRound";

interface OrderCtx {
  readonly orderId: string;
  readonly startAt: number;
  readonly phases: Record<string, number>;
  calls: number;
}

export interface DispatchPassTrace {
  readonly finder: SearchingOrderFinder;
  readonly broadcast: BroadcastDependencies;
  /** يلفُّ معالجةَ طلبٍ واحدٍ فتُنسَبُ نداءاتُه إليه ولو تزامنت الطلباتُ داخلَ الشوطِ. */
  readonly aroundOrder: <T>(orderId: string, fn: () => Promise<T>) => Promise<T>;
  end(report: unknown): void;
}

export interface DispatchTrace {
  /** يُسجَّلُ عندَ كلِّ إطلاقٍ يقبلُه المُجدوِلُ (لا المدموجِ). */
  readonly onTrigger: (cityId: string, outcome: "accepted" | "coalesced") => void;
  readonly beginPass: (
    cityId: string,
    finder: SearchingOrderFinder,
    broadcast: BroadcastDependencies,
  ) => DispatchPassTrace;
  readonly stop: () => Promise<void>;
}

export function createDispatchTrace(options: {
  readonly file: string | undefined;
  readonly sql: Sql;
  readonly probeSql?: Sql | null;
}): DispatchTrace | null {
  const file = options.file;
  if (file === undefined || file === "") return null;

  let buffer: string[] = [];
  const emit = (row: Record<string, unknown>): void => {
    buffer.push(JSON.stringify(row));
  };
  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const out = `${buffer.join("\n")}\n`;
    buffer = [];
    await appendFile(file, out).catch(() => {});
  };

  let passSeq = 0;
  const firstAcceptedAt = new Map<string, number>();
  const triggerCounts = { accepted: 0, coalesced: 0 };

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let cpuPrev = process.cpuUsage();
  let wallPrev = performance.now();
  let probing = false;
  const probeTimer = setInterval(() => {
    if (probing) return;
    probing = true;
    void (async () => {
      const t0 = performance.now();
      let poolMs: number | null = null;
      let directMs: number | null = null;
      try {
        await options.sql`select 1`;
        poolMs = performance.now() - t0;
      } catch {}
      if (options.probeSql) {
        const t1 = performance.now();
        try {
          await options.probeSql`select 1`;
          directMs = performance.now() - t1;
        } catch {}
      }
      const cpu = process.cpuUsage(cpuPrev);
      const wall = performance.now() - wallPrev;
      cpuPrev = process.cpuUsage();
      wallPrev = performance.now();
      const mem = process.memoryUsage();
      emit({
        k: "probe",
        at: Date.now(),
        poolMs,
        directMs,
        loopP50Ms: loop.percentile(50) / 1e6,
        loopP99Ms: loop.percentile(99) / 1e6,
        loopMaxMs: loop.max / 1e6,
        cpuPct: wall > 0 ? ((cpu.user + cpu.system) / 1000 / wall) * 100 : null,
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        triggers: { ...triggerCounts },
      });
      loop.reset();
      triggerCounts.accepted = 0;
      triggerCounts.coalesced = 0;
      probing = false;
      await flush();
    })();
  }, 1000);
  (probeTimer as { unref?: () => void }).unref?.();

  return {
    onTrigger(cityId, outcome) {
      triggerCounts[outcome] += 1;
      if (outcome === "accepted" && !firstAcceptedAt.has(cityId)) {
        firstAcceptedAt.set(cityId, Date.now());
      }
    },
    beginPass(cityId, finder, broadcast) {
      const passId = ++passSeq;
      const triggeredAt = firstAcceptedAt.get(cityId) ?? null;
      firstAcceptedAt.delete(cityId);
      const startAt = Date.now();
      const passPhases: Record<string, number> = {};
      const als = new AsyncLocalStorage<OrderCtx>();
      let idx = 0;
      let picked = 0;
      let oldestWaitSec: number | null = null;
      let newestWaitSec: number | null = null;

      const closeOrder = (ctx: OrderCtx): void => {
        const total = Date.now() - ctx.startAt;
        const io = Object.values(ctx.phases).reduce((a, b) => a + b, 0);
        emit({
          k: "order",
          passId,
          cityId,
          idx: idx++,
          orderId: ctx.orderId,
          startAt: ctx.startAt,
          totalMs: total,
          ioMs: io,
          // ليس زمنَ معالجٍ: ما تبقّى من زمنِ الطلبِ بعدَ أطوارِ الإدخال/الإخراجِ المسجّلةِ
          // (انتظارُ جدولةٍ وحسابٌ في الذاكرةِ وفراغاتٌ بينَ الأطوارِ) — لا يُنسبُ لهُ حكمُ CPU.
          residualMs: Math.max(0, total - io),
          calls: ctx.calls,
          phases: ctx.phases,
        });
      };

      const timed =
        <A extends unknown[], R>(phase: Phase, fn: (...args: A) => Promise<R>) =>
        async (...args: A): Promise<R> => {
          const t0 = performance.now();
          try {
            return await fn(...args);
          } finally {
            const ms = performance.now() - t0;
            const ctx = als.getStore();
            const target: Record<string, number> = ctx?.phases ?? passPhases;
            target[phase] = (target[phase] ?? 0) + ms;
            if (ctx) ctx.calls += 1;
          }
        };

      const b = broadcast;
      const wrapped: BroadcastDependencies = {
        ...b,
        orders: {
          ...b.orders,
          findById: timed("findById", b.orders.findById.bind(b.orders)),
        },
        settings: {
          ...b.settings,
          findByCity: timed("settings", b.settings.findByCity.bind(b.settings)),
        },
        offers: { ...b.offers, findByOrder: timed("offers", b.offers.findByOrder.bind(b.offers)) },
        candidates: {
          ...b.candidates,
          findNearbyAvailableForDispatch: timed(
            "nearby",
            b.candidates.findNearbyAvailableForDispatch.bind(b.candidates),
          ),
          findAvailableInCity: timed("all", b.candidates.findAvailableInCity.bind(b.candidates)),
        },
        offerWriter: {
          ...b.offerWriter,
          openRound: timed("openRound", b.offerWriter.openRound.bind(b.offerWriter)),
        },
      } as BroadcastDependencies;

      let finderMs = 0;
      const wrappedFinder: SearchingOrderFinder = {
        findSearching: async (c, limit, opts) => {
          const t0 = performance.now();
          const r = await finder.findSearching(c, limit, opts);
          finderMs += performance.now() - t0;
          if (r.ok) {
            picked = r.value.length;
            const waits = r.value.map((o) => o.waitingSeconds);
            if (waits.length > 0) {
              oldestWaitSec = Math.max(...waits);
              newestWaitSec = Math.min(...waits);
            }
          }
          return r;
        },
      };

      return {
        finder: wrappedFinder,
        broadcast: wrapped,
        aroundOrder: async (orderId, fn) => {
          const ctx: OrderCtx = { orderId, startAt: Date.now(), phases: {}, calls: 0 };
          try {
            return await als.run(ctx, fn);
          } finally {
            closeOrder(ctx);
          }
        },
        end(report) {
          const r = report as {
            ok?: boolean;
            value?: {
              examined: number;
              rebroadcast: readonly string[];
              stillNoDriver: readonly string[];
              exhausted: readonly string[];
              raced: readonly string[];
              failed: number;
            };
          };
          emit({
            k: "pass",
            passId,
            cityId,
            triggeredAt,
            startAt,
            endAt: Date.now(),
            passMs: Date.now() - startAt,
            finderMs,
            passSettingsMs: passPhases.settings ?? 0,
            picked,
            oldestWaitSec,
            newestWaitSec,
            rebroadcast: r.value?.rebroadcast.length ?? null,
            stillNoDriver: r.value?.stillNoDriver.length ?? null,
            exhausted: r.value?.exhausted.length ?? null,
            raced: r.value?.raced.length ?? null,
            failed: r.value?.failed ?? null,
            rebroadcastIds: r.value?.rebroadcast ?? [],
          });
        },
      };
    },
    async stop() {
      clearInterval(probeTimer);
      loop.disable();
      await flush();
    },
  };
}
