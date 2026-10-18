/**
 * الغرض: برهانُ سقوطِ حاجزِ ميزانيّةِ الاتّصالاتِ بخرقٍ مزروعٍ، ونجاحِه على
 *    المستودعِ الحقيقيِّ في حالتِه الراهنةِ (`F7-04` · `CAP-004` · ADR 0073).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI — وهي المنفذُ الذي يجعل الحاجزَ
 *    يعمل في CI العامِّ لا في `bun run ci` وحدَه.
 * ملاحظات مستقبلية: يومَ يُضاف دورٌ إلى `DB_POOL_MAX` بلا مُستدعٍ يسقط الحاجزُ
 *    بـ`UNUSED_ROLE` — وهو مقصودٌ: ميزانيّةٌ تحسبُ ما لا يُفتَحُ كذبٌ كذلك.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConnectionTopology,
  DECLARED_TOPOLOGY,
} from "../../packages/shared/config/connection-budget.ts";
import {
  analyseManifest,
  analyseRepo,
  analyseSource,
  extractCallArguments,
  servicesFromManifest,
} from "../../scripts/check-connection-budget.ts";

const REAL_MANIFEST = readFileSync("render.yaml", "utf8");

const codes = (findings: readonly { readonly code: string }[]): readonly string[] =>
  findings.map((finding) => finding.code);

describe("قراءةُ مواضعِ إنشاءِ التجمُّعاتِ", () => {
  it("تلتقط وسائطَ النداءِ بالأقواسِ المتوازنةِ لا بأوّلِ قوسٍ مُغلَقٍ", () => {
    const source = "createSql({ connectionString: url(config), max: DB_POOL_MAX.workerJobs })";
    const args = extractCallArguments(source, "createSql".length);
    expect(args).toContain("url(config)");
    expect(args).toContain("DB_POOL_MAX.workerJobs");
  });

  it("نداءٌ بلا قوسٍ مُغلَقٍ ⇒ سقوطٌ لا تجاهُلٌ", () => {
    expect(extractCallArguments("createSql({ max: 5 ", "createSql".length)).toBeNull();
    expect(codes(analyseSource("x.ts", "createSql({ max: 5 ").findings)).toContain(
      "UNPARSEABLE_CALL",
    );
  });

  it("إغفالُ max ⇒ قبولٌ — الافتراضيُّ مُعلَنٌ في الميزانيّةِ (ومهلتُه من الميزانيّةِ منذُ F11-04)", () => {
    const verdict = analyseSource(
      "x.ts",
      "createSql({ connectionString: url, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest });",
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.calls).toBe(1);
    expect(verdict.roles).toEqual([]);
  });

  it("سقفٌ من الميزانيّةِ ⇒ قبولٌ، ويُسجَّلُ دورُه مُستعمَلاً", () => {
    const verdict = analyseSource("x.ts", "createSql({ max: DB_POOL_MAX.workerLocks });");
    expect(verdict.findings).toEqual([]);
    expect(verdict.roles).toEqual(["workerLocks"]);
  });

  /** الشكلُ الذي كانَ قبلَ `F7-04` حرفاً — وهو المُراد منعُه. */
  it("رقمٌ حرفيٌّ ⇒ سقوطٌ", () => {
    expect(codes(analyseSource("x.ts", "createSql({ max: 5 });").findings)).toEqual([
      "MAX_NOT_FROM_BUDGET",
    ]);
  });

  it("ثابتٌ محلّيٌّ يُخفي رقماً ⇒ سقوطٌ كذلك — الوسيطُ لا الاسمُ", () => {
    expect(codes(analyseSource("x.ts", "createSql({ max: ADMIN_MAX });").findings)).toEqual([
      "MAX_NOT_FROM_BUDGET",
    ]);
  });

  it("حسابٌ على حقلِ الميزانيّةِ ⇒ سقوطٌ — الاشتقاقُ يقع في النموذجِ لا في المُستدعي", () => {
    expect(
      codes(analyseSource("x.ts", "createSql({ max: DB_POOL_MAX.workerJobs + 1 });").findings),
    ).toEqual(["MAX_NOT_FROM_BUDGET"]);
  });

  it("دورٌ غيرُ مُعلَنٍ ⇒ سقوطٌ محدَّدٌ يُميَّزُ عن الرقمِ الحرفيِّ", () => {
    expect(codes(analyseSource("x.ts", "createSql({ max: DB_POOL_MAX.ghost });").findings)).toEqual(
      ["UNKNOWN_ROLE"],
    );
  });

  it("نداءاتٌ عدّةٌ في ملفٍّ واحدٍ تُفحَصُ كلُّها لا أوّلُها", () => {
    const verdict = analyseSource(
      "x.ts",
      "createSql({ max: DB_POOL_MAX.workerJobs });\ncreateSql({ max: 9 });",
    );
    expect(verdict.calls).toBe(2);
    expect(codes(verdict.findings)).toEqual(["MAX_NOT_FROM_BUDGET"]);
  });
});

/** `F11-04` · `ADR 0197` — الفحصُ الرابعُ وسالباتُه المبذورةُ (`ح-7`). */
describe("مهلةُ الاستعلامِ من الميزانيّةِ", () => {
  it("البوّابةُ بإغفالِ max وبلا مهلةٍ ⇒ سقوطٌ — الدورُ الافتراضيُّ لا يُفلِتُ", () => {
    expect(codes(analyseSource("x.ts", "createSql({ connectionString: url });").findings)).toEqual([
      "DEADLINE_NOT_FROM_BUDGET",
    ]);
  });

  it("دورُ اللوحةِ بلا مهلةٍ ⇒ سقوطٌ", () => {
    expect(
      codes(analyseSource("x.ts", "createSql({ max: DB_POOL_MAX.adminRequest });").findings),
    ).toEqual(["DEADLINE_NOT_FROM_BUDGET"]);
  });

  it("رقمٌ حرفيٌّ للمهلةِ ⇒ سقوطٌ", () => {
    expect(
      codes(
        analyseSource("x.ts", "createSql({ connectionString: url, queryDeadlineMs: 5000 });")
          .findings,
      ),
    ).toEqual(["DEADLINE_NOT_FROM_BUDGET"]);
  });

  it("مهلةُ دورٍ آخرَ ⇒ سقوطٌ — المهلةُ تتبعُ دورَ السقفِ", () => {
    const source =
      "createSql({ max: DB_POOL_MAX.adminRequest, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest });";
    expect(codes(analyseSource("x.ts", source).findings)).toEqual(["DEADLINE_NOT_FROM_BUDGET"]);
  });

  it("مهلةٌ على دورٍ بلا مهلةٍ مُعلَنةٍ ⇒ سقوطٌ — العاملُ لا يُلغى عملُه الصحيحُ", () => {
    const source =
      "createSql({ max: DB_POOL_MAX.workerJobs, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest });";
    expect(codes(analyseSource("x.ts", source).findings)).toEqual(["DEADLINE_ON_UNBOUNDED_ROLE"]);
  });

  it("تعريفُ الدالّةِ ليسَ موضعَ إنشاءٍ", () => {
    const verdict = analyseSource("x.ts", "export function createSql(options: DbOptions): Sql {}");
    expect(verdict.calls).toBe(0);
    expect(verdict.findings).toEqual([]);
  });
});

/** طوبولوجيا الفصلِ (قبلَ 2026-10-02) — تُحفَظُ مُدخلاً للسالباتِ المبذورةِ. */
const SEPARATED: ConnectionTopology = Object.freeze({
  gatewayInstances: 1,
  workerInstances: 1,
  adminInstances: 1,
  workerRunsInGateway: false,
  adminRunsInGateway: false,
});

describe("تكافؤُ الطوبولوجيا مع مانيفستِ النشرِ", () => {
  const SOUND = [
    "services:",
    "  - type: web",
    "    name: waslah-gateway",
    "    numInstances: 1",
    "    envVars:",
    "      - key: RUN_WORKER_IN_GATEWAY",
    '        value: "false"',
    "  - type: worker",
    "    name: waslah-worker",
    "    numInstances: 1",
    "  - type: web",
    "    name: waslah-admin",
    "    numInstances: 1",
    "",
  ].join("\n");

  it("تقرأ الاسمَ وعددَ النسخِ وموضعَ المهامِّ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services.length).toBe(3);
    expect(services[0]?.name).toBe("waslah-gateway");
    expect(services[0]?.numInstances).toBe(1);
    expect(services[0]?.runWorkerInGateway).toBe(false);
  });

  it("مخطوطةٌ مكافئةٌ ⇒ قبولٌ", () => {
    expect(analyseManifest(SOUND, SEPARATED)).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ في حالتِه الراهنةِ ⇒ قبولٌ", () => {
    expect(analyseManifest(REAL_MANIFEST)).toEqual([]);
  });

  it("رفعُ النسخِ في المانيفستِ وحدَه ⇒ تنافرُ إعلانَين", () => {
    expect(
      codes(
        analyseManifest(SOUND.replace("    numInstances: 1", "    numInstances: 2"), SEPARATED),
      ),
    ).toContain("INSTANCES_MISMATCH");
  });

  it("خدمةٌ ناقصةٌ من المانيفستِ ⇒ سقوطٌ — والميزانيّةُ تُعلنُ لها نسخاً", () => {
    const withoutAdmin = SOUND.slice(0, SOUND.indexOf("  - type: web\n    name: waslah-admin"));
    expect(codes(analyseManifest(withoutAdmin, SEPARATED))).toContain("MISSING_SERVICE");
  });

  it("غيابُ numInstances ⇒ سقوطٌ — الغيابُ افتراضُ منصّةٍ لا واحدةٌ", () => {
    const withoutCount = SOUND.replace(
      "    name: waslah-worker\n    numInstances: 1\n",
      "    name: waslah-worker\n",
    );
    expect(codes(analyseManifest(withoutCount, SEPARATED))).toContain("MISSING_NUM_INSTANCES");
  });

  it("غيابُ RUN_WORKER_IN_GATEWAY ⇒ سقوطٌ", () => {
    const withoutFlag = SOUND.replace(
      '      - key: RUN_WORKER_IN_GATEWAY\n        value: "false"\n',
      "",
    );
    expect(codes(analyseManifest(withoutFlag, SEPARATED))).toContain("MISSING_RUN_WORKER");
  });

  /**
   * الإدماجُ يُضاعِفُ حِملَ البوّابةِ ثلاثاً، فمانيفستٌ يُعلنه وميزانيّةٌ لا تعرفُه
   * هو حرفُ العيبِ الذي عالجَه `F7-04` — ولذلك تنافرٌ لا تسامُحٌ.
   */
  it("إدماجُ المهامِّ في المانيفستِ بلا تعديلِ الطوبولوجيا ⇒ تنافرٌ", () => {
    expect(
      codes(analyseManifest(SOUND.replace('value: "false"', 'value: "true"'), SEPARATED)),
    ).toContain("RUN_WORKER_MISMATCH");
    expect(SEPARATED.workerRunsInGateway).toBe(false);
  });

  /** 2026-10-02 — المُعلَنُ الآنَ: بوّابةٌ واحدةٌ تحملُ العاملَ واللوحةَ (الخطّةُ المجّانيّةُ). */
  const SINGLE = [
    "services:",
    "  - type: web",
    "    name: waslah-gateway",
    "    numInstances: 1",
    "    envVars:",
    "      - key: RUN_WORKER_IN_GATEWAY",
    '        value: "true"',
    "",
  ].join("\n");

  it("بوّابةٌ واحدةٌ تحملُ الكلَّ ⇒ قبولٌ بالطوبولوجيا المُعلَنةِ", () => {
    expect(DECLARED_TOPOLOGY.workerInstances).toBe(0);
    expect(DECLARED_TOPOLOGY.adminInstances).toBe(0);
    expect(analyseManifest(SINGLE)).toEqual([]);
  });

  it("خدمةٌ مُعلَنةٌ بصفرِ نسخٍ وموجودةٌ في المانيفستِ ⇒ تنافرٌ", () => {
    expect(
      codes(
        analyseManifest(
          `${SINGLE}  - type: worker\n    name: waslah-worker\n    numInstances: 1\n`,
        ),
      ),
    ).toContain("UNDECLARED_SERVICE");
  });

  it("المهامُّ خارجَ البوّابةِ في المانيفستِ والطوبولوجيا تقولُ داخلَها ⇒ تنافرٌ", () => {
    expect(codes(analyseManifest(SINGLE.replace('value: "true"', 'value: "false"')))).toContain(
      "RUN_WORKER_MISMATCH",
    );
  });

  it("مخطوطةٌ فارغةٌ ⇒ سقوطٌ لا نجاحٌ صامتٌ", () => {
    expect(codes(analyseManifest("", SEPARATED))).toContain("MISSING_SERVICE");
  });
});

describe("الحكمُ على مستودعٍ كاملٍ", () => {
  it("المستودعُ الحقيقيُّ في حالتِه الراهنةِ ⇒ قبولٌ، وقد فحصَ مواضعَ فعلاً", () => {
    const verdict = analyseRepo(process.cwd());
    expect(verdict.findings).toEqual([]);
    expect(verdict.inspectedCalls).toBeGreaterThan(0);
  });

  /** حاجزٌ لا يرى شيئاً ليس حاجزاً: شجرةٌ غائبةٌ أو خاليةٌ سقوطٌ لا نجاحٌ. */
  it("جذرٌ بلا شجرةِ إنتاجٍ ⇒ سقوطٌ لا نجاحٌ فارغٌ", () => {
    const empty = mkdtempSync(join(tmpdir(), "connection-budget-"));
    const found = codes(analyseRepo(empty).findings);
    expect(found).toContain("MISSING_TREE");
    expect(found).toContain("NO_CALLS");
    expect(found).toContain("MISSING_MANIFEST");
  });
});

describe("رمزُ خروجِ الحاجزِ لا نصُّه", () => {
  /** يبني جذراً صغيراً: شجرتانِ ومانيفستٌ — ثمّ يُشغَّلُ الحاجزُ عليه أمراً. */
  const plant = (call: string, manifest: string): string => {
    const root = mkdtempSync(join(tmpdir(), "connection-budget-root-"));
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "packages"), { recursive: true });
    writeFileSync(
      join(root, "apps", "container.ts"),
      [
        "createSql({ max: DB_POOL_MAX.workerJobs });",
        "createSql({ max: DB_POOL_MAX.workerLocks });",
        "createSql({ max: DB_POOL_MAX.adminRequest, queryDeadlineMs: DB_QUERY_DEADLINE_MS.adminRequest });",
        "createSql({ max: DB_POOL_MAX.restoreVerifier });",
        // `ADR 0289` — دورُ شوطِ البثِّ الفوريِّ مُعلَنٌ فلا بدَّ له من مُستدعٍ في الجذرِ المزروعِ.
        "createSql({ max: DB_POOL_MAX.gatewayDispatch, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayDispatch });",
        call,
        "",
      ].join("\n"),
    );
    writeFileSync(join(root, "render.yaml"), manifest);
    return root;
  };

  // 2026-10-02: المانيفستُ السليمُ هو ما تُعلنُه الطوبولوجيا الآنَ — بوّابةٌ جامعةٌ وحدَها.
  const SOUND_MANIFEST = [
    "services:",
    "  - type: web",
    "    name: waslah-gateway",
    "    numInstances: 1",
    "    envVars:",
    "      - key: RUN_WORKER_IN_GATEWAY",
    '        value: "true"',
    "",
  ].join("\n");

  const runBarrier = async (root: string): Promise<number> => {
    const child = Bun.spawn(["bun", "scripts/check-connection-budget.ts", root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return await child.exited;
  };

  it("خرقٌ مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ، وإزالتُه ⇒ صفرٌ", async () => {
    expect(await runBarrier(plant("createSql({ max: 12 });", SOUND_MANIFEST))).toBe(1);
    expect(
      await runBarrier(
        plant(
          "createSql({ connectionString: url, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest });",
          SOUND_MANIFEST,
        ),
      ),
    ).toBe(0);
  }, 60_000);

  it("بوّابةٌ بلا مهلةٍ مزروعةً ⇒ رمزٌ غيرُ صفريٍّ (F11-04)", async () => {
    expect(await runBarrier(plant("createSql({ connectionString: url });", SOUND_MANIFEST))).toBe(
      1,
    );
  }, 60_000);

  it("تنافرُ المانيفستِ مزروعاً ⇒ رمزٌ غيرُ صفريٍّ", async () => {
    const drifted = SOUND_MANIFEST.replace(
      "    name: waslah-gateway\n    numInstances: 1",
      "    name: waslah-gateway\n    numInstances: 4",
    );
    expect(
      await runBarrier(
        plant(
          "createSql({ connectionString: url, queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest });",
          drifted,
        ),
      ),
    ).toBe(1);
  }, 60_000);

  it("المستودعُ الحقيقيُّ ⇒ صفرٌ", async () => {
    const child = Bun.spawn(["bun", "scripts/check-connection-budget.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
  }, 30_000);
});
