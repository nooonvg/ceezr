/**
 * الغرض: `WR-04` (ADR 0281) — قراءةُ موافقاتِ السائقِ وتسجيلُها عبرَ العقدِ القائمِ نفسِه
 *   (`GET`/`POST /v1/consents`). بلا مسارِ التقديمِ المسبقِ الخاصِّ بترحيبِ الراكب.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/consent
 */
import { apiFetch } from "../../../api/client.ts";
import type { ConsentApiStatus } from "../../rider/welcome/consent-view.ts";

export function fetchDriverConsentStatus(): Promise<ConsentApiStatus> {
  return apiFetch<ConsentApiStatus>("/v1/consents");
}

/** `accepted: true` صريحةٌ: الخادمُ يردُّ `NOT_ACCEPTED` على غيرِها. */
export function submitDriverConsent(kind: string, version: string): Promise<unknown> {
  return apiFetch<unknown>("/v1/consents", {
    method: "POST",
    body: { kind, version, accepted: true },
  });
}
