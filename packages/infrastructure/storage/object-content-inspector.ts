/**
 * الغرض: `WR-21` (ADR 0282) — قراءةُ عيّنةٍ من كائنِ Supabase Storage بطلبَي `Range`: رأسٌ من 16 بايتًا
 *   وذيلٌ من 1024، والحجمُ الكاملُ من `Content-Range`. لا يُنزَّلُ الملفُّ كلُّه.
 * ينتمي إلى: packages/infrastructure/storage
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعيات.
 *
 * المفتاحُ لا يُسجَّلُ ولا يُعاد، ولا يُسجَّلُ من البايتاتِ شيء.
 */

import type {
  ObjectContentInspectionFailure,
  ObjectContentInspector,
} from "../../application/driver/ports.ts";
import {
  DRIVER_DOCUMENT_HEAD_BYTES,
  DRIVER_DOCUMENT_TAIL_BYTES,
} from "../../domain/driver/driver-document-content.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";

export interface ObjectContentInspectorConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly bucket: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** `bytes 0-15/12345` ⇒ 12345. */
export function totalFromContentRange(header: string | null): number | null {
  if (header === null) return null;
  const m = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(header.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

type Range = { readonly bytes: Uint8Array; readonly total: number | null };

export class HttpObjectContentInspector implements ObjectContentInspector {
  readonly #config: ObjectContentInspectorConfig;
  readonly #transport: FetchLike;
  readonly #timeoutMs: number;

  constructor(config: ObjectContentInspectorConfig) {
    this.#config = config;
    this.#transport = config.fetch ?? createGuardedFetch("supabase-object-storage");
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async #range(
    objectPath: string,
    range: string,
    maxBytes: number,
  ): Promise<Result<Range, ObjectContentInspectionFailure>> {
    const target =
      `${this.#config.baseUrl}/storage/v1/object/` +
      `${encodeURIComponent(this.#config.bucket)}/${objectPath}`;
    let response: Response;
    try {
      response = await this.#transport(target, {
        method: "GET",
        headers: { authorization: `Bearer ${this.#config.secretKey}`, range },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err("INSPECTOR_UNAVAILABLE");
    }
    if (response.status === 404 || response.status === 400) {
      await response.body?.cancel();
      return err("OBJECT_NOT_FOUND");
    }
    if (response.status !== 206 && response.status !== 200) {
      await response.body?.cancel();
      return err("INSPECTOR_UNAVAILABLE");
    }
    let buffer: Uint8Array;
    try {
      buffer = new Uint8Array(await response.arrayBuffer());
    } catch {
      return err("INSPECTOR_UNAVAILABLE");
    }
    // مخزنٌ تجاهلَ `Range` فأعادَ 200 بالملفِّ كلِّه: الحجمُ طولُه، والعيّنةُ منه.
    if (response.status === 200) return ok({ bytes: buffer, total: buffer.length });
    if (buffer.length > maxBytes) return err("INSPECTOR_UNAVAILABLE");
    return ok({
      bytes: buffer,
      total: totalFromContentRange(response.headers.get("content-range")),
    });
  }

  async inspect(input: { readonly objectPath: string }) {
    const head = await this.#range(
      input.objectPath,
      `bytes=0-${DRIVER_DOCUMENT_HEAD_BYTES - 1}`,
      DRIVER_DOCUMENT_HEAD_BYTES,
    );
    if (!head.ok) return head;
    if (head.value.total === null)
      return err<ObjectContentInspectionFailure>("INSPECTOR_UNAVAILABLE");
    const total = head.value.total;
    if (head.value.bytes.length === total) {
      // الملفُّ كلُّه في يدِنا (صغيرٌ أو بلا Range).
      const all = head.value.bytes;
      return ok({
        sizeBytes: total,
        head: all.slice(0, DRIVER_DOCUMENT_HEAD_BYTES),
        tail: all.slice(Math.max(0, all.length - DRIVER_DOCUMENT_TAIL_BYTES)),
      });
    }
    const tail = await this.#range(
      input.objectPath,
      `bytes=-${DRIVER_DOCUMENT_TAIL_BYTES}`,
      DRIVER_DOCUMENT_TAIL_BYTES,
    );
    if (!tail.ok) return tail;
    if (tail.value.total !== null && tail.value.total !== total) {
      // تغيّرَ الكائنُ بين النداءين: لا حكمَ على عيّنتين من ملفّين.
      return err<ObjectContentInspectionFailure>("INSPECTOR_UNAVAILABLE");
    }
    const tailBytes =
      tail.value.bytes.length > DRIVER_DOCUMENT_TAIL_BYTES
        ? tail.value.bytes.slice(tail.value.bytes.length - DRIVER_DOCUMENT_TAIL_BYTES)
        : tail.value.bytes;
    return ok({ sizeBytes: total, head: head.value.bytes, tail: tailBytes });
  }
}
