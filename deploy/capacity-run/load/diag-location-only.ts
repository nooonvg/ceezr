/**
 * الغرض: تجربةُ عزلٍ لمسارِ `POST /v1/driver/location` وحدهُ (`LOAD-01` — الدفعةُ
 *   الرابعةُ): تحميلٌ مضبوطُ المعدّلِ بلا دورةِ رحلةٍ ولا لوحِ عروضٍ ولا إشعاراتٍ،
 *   ليُفصلَ أثرُ المسارِ نفسِهِ عنِ تداخلِ بقيةِ الطبقاتِ. الجولاتُ السابقةُ
 *   (`r2-wave-50b` ثمّ `r2-wave-50c`) أخفقتْ بمهلاتِ عميلٍ (status 0) متزايدةٍ
 *   عبرَ الجولاتِ على مقعدٍ واحدٍ — وهذهِ الأداةُ تجيبُ: هل يفشلُ المسارُ وحدهُ
 *   أم يفشلُ بالتداخلِ فقط؟
 * الحالة: أداةُ تشخيصٍ للبيئةِ المعزولةِ لا اختبارُ قبولٍ — نتائجُها تُربطُ
 *   بالالتزامِ الدقيقِ وبأطوارِ الخادمِ من `driver_location.served` في سجلِ
 *   البوابةِ (معرّفُ الطلبِ يربطُ الطبقتينِ).
 * ينتمي إلى: deploy/capacity-run/load
 * يستخدمه: يدويًا في تشخيصِ `LOAD-01` — ليسَ جزءًا من موجاتِ القبولِ الرسميةِ.
 */

import { onboardDriverViaApp } from "./driver-onboarding.ts";
import { type HttpResult, http, signedInitData } from "./lib.ts";

/** مدينةُ السيناريو — كما في مولّدِ الموجاتِ نفسِها. */
const DIAG_CITY_CODE = "JED";

export interface DiagLocationOnlyOptions {
  /** عددُ السائقينَ المُهيَّئينَ مسبقًا (الهويةُ نطاقٌ تشخيصيٌّ مميّز). */
  readonly driverCount: number;
  /** مدةُ التحميلِ بالثواني. */
  readonly durationSeconds: number;
  /** فاصلُ تحديثِ الموقعِ لكلِّ سائقٍ بالثواني (كالعميلِ الحقيقيِّ). */
  readonly updateIntervalSeconds: number;
  /** بدايةُ نطاقِ هوياتِ تلغرام التشخيصيةِ — لا تلامسُ نطاقاتِ الموجاتِ. */
  readonly telegramIdBase: number;
  /** رمزُ البوت للجلساتِ (من أسرارِ المقعدِ). */
  readonly botToken: string;
}

export interface LocationCallRecord {
  readonly t: string;
  readonly driverIndex: number;
  readonly status: number;
  readonly elapsedMs: number;
  readonly networkError: string | null;
  readonly requestId: string | null;
}

export interface DiagLocationOnlyReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly options: DiagLocationOnlyOptions;
  readonly onboardingFailures: number;
  readonly totalUpdates: number;
  readonly failures: number;
  readonly timeoutFailures: number;
  readonly failuresByNetworkError: Record<string, number>;
  readonly latency: {
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maxMs: number;
  };
  readonly records: readonly LocationCallRecord[];
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return Math.round(sorted[index]);
}

/**
 * تجربةٌ واحدةٌ: تهيئةٌ ثمَّ تحميلٌ مضبوطٌ. كلُّ سائقٍ يُحدِّثُ موقعَهُ على فاصلِهِ
 * المستقلِّ (لا صمتَ جماعيًّا ولا انفجارًا متزامنًا) — فالمعدّلُ الفعليُّ يقاسُ
 * منَ السجلِّ لا منَ النيةِ.
 */
export async function runLocationOnlyDiag(
  options: DiagLocationOnlyOptions,
): Promise<DiagLocationOnlyReport> {
  const startedAt = new Date();
  const records: LocationCallRecord[] = [];
  const sessionTokens: (string | null)[] = [];
  let onboardingFailures = 0;

  // ١) التهيئةُ: تسجيلٌ ثمّ مبادلةُ جلسةٍ لكلّ سائقٍ — كما في مولّدِ الموجاتِ
  //    نفسِهِ لا اختصارًا يفصلَ عنِ السلوكِ المقصودِ.
  for (let i = 0; i < options.driverCount; i++) {
    const telegramId = options.telegramIdBase + i;
    let token: string | null = null;
    try {
      const record = await onboardDriverViaApp({
        telegramId,
        cityCode: DIAG_CITY_CODE,
      });
      if (record.driverId !== null) {
        const session = await http("/v1/session/telegram", {
          method: "POST",
          body: {
            initData: signedInitData({
              botToken: options.botToken,
              telegramId,
            }),
          },
          timeoutMs: 15_000,
        });
        const body = session.body as { accessToken?: unknown } | null;
        token =
          session.ok && body !== null && typeof body.accessToken === "string"
            ? body.accessToken
            : null;
      }
      if (token === null) onboardingFailures++;
    } catch {
      onboardingFailures++;
    }
    sessionTokens.push(token);
  }

  // ٢) التحميلُ: كلُّ سائقٍ حلقةُ تحديثٍ مستقلةٌ على فاصلِهِ.
  const deadline = Date.now() + options.durationSeconds * 1_000;
  const loops = sessionTokens.map(async (token, index) => {
    if (token === null) return;
    for (;;) {
      const now = Date.now();
      if (now >= deadline) return;
      const result: HttpResult = await http("/v1/driver/location", {
        method: "POST",
        token,
        body: {
          latitude: 21.42 + (index % 17) * 0.001,
          longitude: 39.82 + (index % 13) * 0.001,
          accuracyMeters: 10,
        },
        timeoutMs: 15_000,
      });
      records.push({
        t: new Date().toISOString(),
        driverIndex: index,
        status: result.status,
        elapsedMs: Math.round(result.elapsedMs),
        networkError: result.networkError,
        requestId: result.requestId,
      });
      const sleepMs = Math.max(250, options.updateIntervalSeconds * 1_000 - (Date.now() - now));
      if (Date.now() + sleepMs >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  });
  await Promise.all(loops);

  const elapsed = records.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const failures = records.filter((r) => r.status === 0);
  const failuresByNetworkError: Record<string, number> = {};
  for (const f of failures) {
    const key = f.networkError ?? "?";
    failuresByNetworkError[key] = (failuresByNetworkError[key] ?? 0) + 1;
  }
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    options,
    onboardingFailures,
    totalUpdates: records.length,
    failures: failures.length,
    timeoutFailures: failures.filter((f) => f.networkError === "TimeoutError").length,
    failuresByNetworkError,
    latency: {
      p50Ms: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      p99Ms: percentile(elapsed, 0.99),
      maxMs: elapsed.length > 0 ? elapsed[elapsed.length - 1] : 0,
    },
    records,
  };
}

/**
 * مدخلُ سطرِ الأوامرِ: `bun run diag-location-only.ts <drivers> <seconds>
 * <interval> <telegramBase> <botToken>` — يُكتبُ التقريرُ إلى stdout ليُحفظَ في
 * دليلِ الجولةِ التشخيصيةِ كما بقيةُ الأدلةِ.
 */
if (import.meta.main) {
  const [driverCount, durationSeconds, updateIntervalSeconds, telegramIdBase, botToken] =
    process.argv.slice(2);
  if (
    driverCount === undefined ||
    durationSeconds === undefined ||
    updateIntervalSeconds === undefined ||
    telegramIdBase === undefined ||
    botToken === undefined
  ) {
    console.error(
      "الاستعمال: bun run diag-location-only.ts <عدد السائقين> <الثواني> <الفاصل بالثواني> <بداية الهويات> <botToken>",
    );
    process.exit(2);
  }
  const report = await runLocationOnlyDiag({
    driverCount: Number(driverCount),
    durationSeconds: Number(durationSeconds),
    updateIntervalSeconds: Number(updateIntervalSeconds),
    telegramIdBase: Number(telegramIdBase),
    botToken,
  });
  const { records: _records, ...summary } = report;
  console.error(JSON.stringify(summary, null, 2));
  for (const r of report.records) {
    console.log(JSON.stringify(r));
  }
}
