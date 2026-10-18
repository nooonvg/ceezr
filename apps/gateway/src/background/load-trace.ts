/**
 * `LOAD-01` (الدفعةُ الحاديةَ عشرةَ) — أثرُ كلفةِ السيناريو: تشخيصيٌّ اختياريٌّ، مُعطَّلٌ افتراضيّاً.
 *
 * يُفعَّلُ بـ`DISPATCH_TRACE_FILE=<مسار>` وحدَه (المفتاحُ نفسُه لأثرِ البثِّ)، ويكتبُ JSONL إلى
 * `<مسار>.load.jsonl`. بغيابِه تُعيدُ الدالّةُ `null` فلا يتغيّرُ سلوكٌ ولا كلفة:
 *
 * - `job`: وظيفةُ تحديثِ تيليجرامَ واحدةٌ بمعرّفِها — لحظةُ التقاطِها، وبدءُ معالجتِها (بعدَ
 *   انتظارِ مسارِ المستخدمِ)، ونهايتُها، وأطوارُ المسارِ الدائم (فحصُ الأثرِ، والتحضير، والختم).
 *   والإيداعُ (`created_at`) يُقرَأُ من القاعدةِ بعدَ الموجةِ فيُفصَلُ انتظارُ الطابورِ عن التنفيذ.
 * - `sweep`: شوطُ الدرينر — بدؤه وآخرُ التقاطٍ فيه ونهايتُه (الفرقُ = انتظارُ آخرِ الوظائفِ
 *   والمساراتُ فارغةٌ)، ورحلاتُ الالتقاطِ وزمنُها.
 * - `http`: كلَّ 5ث لكلِّ مسارٍ مُطبَّعٍ: العدد، والمجموع، وp50/p95/max لزمنِ المعالجةِ في الخادم
 *   (من دخولِ `fetch` حتى الردّ) — لا زمنُ العميلِ.
 */
import { appendFile } from "node:fs/promises";
import type { DrainerTiming } from "./telegram-update-drainer.ts";

export interface LoadTrace {
  readonly drainer: DrainerTiming;
  readonly onHttp: (pathname: string, method: string, ms: number, status: number) => void;
  readonly stop: () => Promise<void>;
}

/** يُطبِّعُ المسارَ: المعرّفاتُ (UUID/أرقامٌ طويلة) تصيرُ `:id` فلا ينفجرُ عددُ المفاتيح. */
export function normaliseRoute(method: string, pathname: string): string {
  const path = pathname
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
      /^\d{3,}$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
  return `${method} ${path}`;
}

function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

export function createLoadTrace(file: string | undefined): LoadTrace | null {
  if (file === undefined || file === "") return null;
  const out = `${file}.load.jsonl`;
  let buffer: string[] = [];
  const emit = (row: Record<string, unknown>): void => {
    buffer.push(JSON.stringify(row));
  };
  let window = new Map<string, { ms: number[]; errors: number }>();
  const flush = async (): Promise<void> => {
    if (window.size > 0) {
      const at = Date.now();
      for (const [route, w] of window) {
        const sorted = [...w.ms].sort((a, b) => a - b);
        emit({
          k: "http",
          at,
          route,
          n: sorted.length,
          sumMs: Math.round(sorted.reduce((s, x) => s + x, 0) * 100) / 100,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
          maxMs: sorted[sorted.length - 1] ?? null,
          errors: w.errors,
        });
      }
      window = new Map();
    }
    if (buffer.length === 0) return;
    const text = `${buffer.join("\n")}\n`;
    buffer = [];
    await appendFile(out, text).catch(() => {});
  };
  const timer = setInterval(() => void flush(), 5_000);
  timer.unref?.();
  return {
    drainer: {
      onJob: (t) => emit({ k: "job", ...t }),
      onSweep: (t) => emit({ k: "sweep", ...t }),
    },
    onHttp: (pathname, method, ms, status) => {
      const route = normaliseRoute(method, pathname);
      let w = window.get(route);
      if (w === undefined) {
        w = { ms: [], errors: 0 };
        window.set(route, w);
      }
      w.ms.push(ms);
      if (status >= 500) w.errors += 1;
    },
    stop: async () => {
      clearInterval(timer);
      await flush();
    },
  };
}
