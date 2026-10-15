/**
 * الغرض: تصريحاتُ الأنواعِ لوحدتَي postgres الداخليّتَينِ اللتينِ يمسُّهما اختبارُ
 *   حارسِ `nextWrite` (D7) مباشرةً — `src/connection.js` و`src/query.js` — فهما
 *   شيفرةٌ صرفةٌ بلا تصريحاتٍ، والاختبارُ يتعاملُ معهما بعقدِهما الأدنىّ.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: tests/unit
 */

declare module "*postgres/src/connection.js" {
  /** وحدةُ الاتصالِ: تُبنى بلا مقبسٍ فيُختبرَ حارسُ الكتابةِ على المقبسِ الميتِ. */
  export default function Connection(
    options: Record<string, unknown>,
    queues: Record<string, unknown>,
    hooks: Record<string, unknown>,
  ): {
    execute: (query: unknown) => boolean | undefined;
    connect: (query: unknown) => void;
    terminate: () => void;
    end: () => Promise<void>;
    cancel: () => void;
    count: number;
    id: number;
    queue: unknown;
  };
}

declare module "*postgres/src/query.js" {
  /** استعلامٌ صحيحٌ من المكتبةِ نفسِها — لا تُختلَقُ حقولُه يدويًّا. */
  export class Query extends Promise<unknown> {
    constructor(
      strings: readonly string[],
      args: readonly unknown[],
      handler: (query: { rows?: unknown[] }) => unknown,
      canceller: ((query: unknown) => void) | undefined,
      options: Record<string, unknown>,
    );
    readonly tagged: boolean;
    readonly strings: readonly string[];
    readonly args: readonly unknown[];
    readonly options: Record<string, unknown>;
    readonly active: boolean;
    readonly cancelled: null | boolean;
    readonly executed: boolean;
    readonly signature: string;
    reject: (error: unknown) => void;
    resolve: (value: unknown) => void;
    cancel(): void;
    simple(): Query;
  }
  export const CLOSE: unique symbol;
}
