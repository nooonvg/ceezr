/**
 * الغرض: برهانُ سقوطِ حاجزِ `numInstances` بخرقٍ مزروعٍ، ونجاحِه على المستودعِ
 *    الحقيقيِّ في حالتِه الراهنةِ (`R-17` · ADR 0050).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI — وهي المنفذُ الذي يجعل الحاجزَ
 *    يعمل في CI العامِّ لا في `bun run ci` وحدَه.
 * ملاحظات مستقبلية: يومَ تُضاف خدمةٌ إلى `render.yaml` يسقط الحاجزُ حتّى تُصنَّف،
 *    وهذا مقصودٌ — يُحدَّث `CLASSIFIED_SERVICES` بسببٍ مكتوبٍ لا يُوسَّع النمطُ.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOLEAN_ENV_LITERALS,
  PROCESS_TOPOLOGY_NAMES,
  tryLoadConfig,
} from "../../packages/shared/config/index.ts";
import {
  ADMIN_SERVICE_NAME,
  analyse,
  CLASSIFIED_SERVICES,
  REQUIRED_SERVICES,
  type ServiceDeclaration,
  STATIC_RUNTIME,
  servicesFromManifest,
  VALID_BOOLEAN_LITERALS,
  VALID_PROCESS_TOPOLOGIES,
} from "../../scripts/check-instance-invariant.ts";

const REAL_MANIFEST = readFileSync("render.yaml", "utf8");

const SOUND = [
  "services:",
  "  - type: web",
  "    name: waslah-gateway",
  "    numInstances: 1",
  "    envVars:",
  "      - key: SESSION_STORE",
  "        value: memory",
  "      - key: PROCESS_TOPOLOGY",
  "        value: single-process",
  "      - key: RUN_WORKER_IN_GATEWAY",
  '        value: "false"',
  // موضعُ اللوحةِ في هذه الثوابتِ: **في البوّابةِ** — أي حالُ ما قبلَ `F5-08`،
  // وهي حالٌ مشروعةٌ لأنّ الثوابتَ بلا خدمةِ لوحةٍ (`true` بلا خدمةٍ = إدماجٌ
  // صريحٌ لا خرقٌ). وبـ`"true"` لا `"false"` كي لا يمسَّها `withRunWorker` الذي
  // يُبدِّل كلَّ `value: "false"` في النصِّ — فيبقى كلُّ مُبدِّلٍ على ما سُمِّي به.
  "      - key: RUN_ADMIN_IN_GATEWAY",
  '        value: "true"',
  "  - type: worker",
  "    name: waslah-worker",
  "    numInstances: 1",
  "    envVars:",
  "      - key: SESSION_STORE",
  "        value: memory",
  "      - key: PROCESS_TOPOLOGY",
  "        value: single-process",
  "      - key: RUN_WORKER_IN_GATEWAY",
  '        value: "false"',
  "      - key: RUN_ADMIN_IN_GATEWAY",
  '        value: "true"',
  "",
].join("\n");

/**
 * نفسُ المخطوطةِ السليمةِ بلا خدمةِ عاملٍ — البوّابةُ وحدَها. تُبنى بقطعِ النصِّ
 * عندَ الخدمةِ الثانيةِ لا بكتابةِ نسخةٍ ثانيةٍ: نسختانِ تتباعدانِ بأوّلِ تعديلٍ.
 */
const GATEWAY_ONLY = `${SOUND.slice(0, SOUND.indexOf("  - type: worker"))}`;

/** يُبدِّل قيمةَ الطوبولوجيا في نصِّ المُدخَلِ كلِّه — زرعُ خرقٍ لا تحريرُ ملفٍّ. */
const withTopology = (content: string, value: string): string =>
  content.replaceAll("        value: single-process", `        value: ${value}`);

/** يحذف إعلانَ الطوبولوجيا كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ صامتٌ. */
const withoutTopology = (content: string): string =>
  content.replaceAll("      - key: PROCESS_TOPOLOGY\n        value: single-process\n", "");

/** يُبدِّل قيمةَ `RUN_WORKER_IN_GATEWAY` في النصِّ كلِّه — زرعُ خرقٍ لا تحريرُ ملفٍّ. */
const withRunWorker = (content: string, value: string): string =>
  content.replaceAll('        value: "false"', `        value: ${value}`);

/** يحذف إعلانَ موضعِ المهامِّ كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ. */
const withoutRunWorker = (content: string): string =>
  content.replaceAll('      - key: RUN_WORKER_IN_GATEWAY\n        value: "false"\n', "");

const codes = (content: string): readonly string[] => analyse(content).map((f) => f.code);

/**
 * خدماتُ **العمليّاتِ** وحدَها من ملفِّ النشرِ — لا المواقعُ الساكنةُ (ADR 0165).
 *
 * والحلقاتُ أدناه تقولُ «لكلِّ خدمةٍ» وتعني «لكلِّ عمليّةٍ تُقلِعُ»: `numInstances`
 * و`PROCESS_TOPOLOGY` و`RUN_WORKER_IN_GATEWAY` كلُّها أوصافُ عمليّةٍ تقرأُ
 * `packages/shared/config` عندَ الإقلاعِ. ويومَ دخلَ الموقعُ الساكنُ الملفَّ صارَ
 * نصُّ الحلقةِ يَعِدُ بأكثرَ من معناه، **وتشديدُها عليه ليس تشديداً** بل إلزامٌ
 * بكتابةِ وصفٍ كاذبٍ. فالتضييقُ ههنا تصحيحٌ لنصِّ الحلقةِ إلى مرادِها المكتوبِ،
 * لا إضعافٌ لها — والمواقعُ الساكنةُ محروسةٌ بضوابطَ موجبةٍ معكوسةٍ في الحاجزِ.
 *
 * ولا تمرُّ الحلقةُ فراغاً: `expect(processes.length)` يمنعُ ملفّاً بلا عمليّةٍ
 * من إرضاءِ حلقةٍ لا تدورُ.
 */
const processServices = (manifest: string): readonly ServiceDeclaration[] => {
  const processes = servicesFromManifest(manifest).filter(
    (service) => service.runtime !== STATIC_RUNTIME,
  );
  expect(processes.length).toBeGreaterThan(0);
  return processes;
};

describe("قراءةُ الخدماتِ من ملفِّ النشرِ", () => {
  it("تقرأ الاسمَ وعددَ النسخِ ومخزنَ الجلساتِ لكلِّ خدمةٍ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services.length).toBe(2);
    expect(services[0]?.name).toBe("waslah-gateway");
    expect(services[0]?.numInstances).toBe("1");
    expect(services[0]?.sessionStore).toBe("memory");
    expect(services[0]?.processTopology).toBe("single-process");
    expect(services[1]?.name).toBe("waslah-worker");
    expect(services[1]?.processTopology).toBe("single-process");
  });

  it("تقرأ المستودعَ الحقيقيَّ فتجد الخدمتَين بعددٍ واحدٍ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway).toBeDefined();
    expect(gateway?.numInstances).toBe("1");
    expect(gateway?.processTopology).toBe("single-process");
    for (const service of processServices(REAL_MANIFEST)) {
      expect(service.numInstances).toBe("1");
      expect(service.processTopology).toBe("single-process");
    }
  });

  /** التعليقُ اللاحقُ لا يُفسِد القيمةَ: `autoDeploy: false # …` سطرٌ قائمٌ فعلاً. */
  it("تُجرِّد التعليقَ اللاحقَ من القيمةِ", () => {
    const services = servicesFromManifest(
      ["services:", "  - name: waslah-gateway", "    numInstances: 1 # نسخةٌ واحدةٌ", ""].join("\n"),
    );
    expect(services[0]?.numInstances).toBe("1");
  });
});

describe("الحكمُ — قبولٌ ورفضٌ", () => {
  it("numInstances = 1 لكلِّ خدمةٍ مصنَّفةٍ ⇒ قبولٌ", () => {
    expect(analyse(SOUND)).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ في حالتِه الراهنةِ ⇒ قبولٌ", () => {
    expect(analyse(REAL_MANIFEST)).toEqual([]);
  });

  it("numInstances > 1 ⇒ رفضٌ", () => {
    expect(codes(SOUND.replace("numInstances: 1", "numInstances: 2"))).toContain(
      "INSTANCES_ABOVE_ONE",
    );
  });

  /** رفعُ النسخِ مع `memory` خرقٌ مزدوجٌ: شرطُ R-17 وإلزامُ ADR 0011 معاً. */
  it("رفعُ النسخِ مع SESSION_STORE=memory ⇒ خرقانِ لا خرقٌ", () => {
    const found = codes(SOUND.replace("numInstances: 1", "numInstances: 4"));
    expect(found).toContain("INSTANCES_ABOVE_ONE");
    expect(found).toContain("SESSION_STORE_INCOHERENT");
  });

  it("قيمةٌ غيرُ عدديّةٍ ⇒ سقوطٌ محدَّدٌ لا تخطٍّ", () => {
    expect(codes(SOUND.replace("numInstances: 1", 'numInstances: "auto"'))).toContain(
      "INVALID_NUM_INSTANCES",
    );
  });

  it("غيابُ الحقلِ ⇒ سقوطٌ محدَّدٌ — لأنّ الغيابَ افتراضُ منصّةٍ لا واحدةٌ", () => {
    expect(codes(SOUND.replace("    numInstances: 1\n", ""))).toContain("MISSING_NUM_INSTANCES");
  });

  it("ملفٌّ فارغٌ أو بنيةٌ لا تُفهَم ⇒ سقوطٌ لا نجاحٌ صامتٌ", () => {
    expect(codes("")).toEqual(["NO_SERVICES"]);
    expect(codes("services: []\n")).toEqual(["NO_SERVICES"]);
  });

  it("غيابُ الخدمةِ المعنيّةِ ⇒ سقوطٌ — الحاجزُ لا ينجح على ملفٍّ لا يفحص فيه شيئاً", () => {
    const withoutGateway = [
      "services:",
      "  - type: worker",
      "    name: waslah-worker",
      "    numInstances: 1",
      "    envVars:",
      "      - key: PROCESS_TOPOLOGY",
      "        value: single-process",
      // يُعلَن كي يبقى المُختبَرُ **غيابَ البوّابةِ وحدَه**: مخطوطةٌ ناقصةُ إعلانِ
      // موضعِ المهامِّ تُسقِط رمزاً ثانياً فتُخفي المقصودَ (ADR 0063).
      "      - key: RUN_WORKER_IN_GATEWAY",
      '        value: "false"',
      // ولنفسِ السببِ حرفاً: إعلانُ موضعِ اللوحةِ يُضاف كي يبقى المُختبَرُ
      // غيابَ البوّابةِ وحدَه (ADR 0064).
      "      - key: RUN_ADMIN_IN_GATEWAY",
      '        value: "true"',
      "",
    ].join("\n");
    expect(codes(withoutGateway)).toEqual(["MISSING_REQUIRED_SERVICE"]);
  });

  it("خدمةٌ جديدةٌ غيرُ مصنَّفةٍ ⇒ سقوطٌ حتّى تُصنَّف", () => {
    const withNew = `${SOUND}  - type: web\n    name: waslah-something-new\n    numInstances: 3\n`;
    expect(codes(withNew)).toContain("UNCLASSIFIED_SERVICE");
  });

  /**
   * ## الطوبولوجيا (ADR 0051) — التكافؤُ في الاتّجاهَين
   */
  /**
   * **طبقتانِ لهما قاعدتانِ عن قصدٍ** (ADR 0051 §٢-ب مقابلَ §٢-هـ):
   * في **بيئةِ العمليةِ** غيابُ المفتاحِ يُقرأ `single-process` افتراضاً مُعلَناً
   * (مُثبَّتٌ في `config-loading.test.ts` و`single-instance-invariant.test.ts`)،
   * وفي **ملفِّ النشرِ** غيابُ الإعلانِ **خرقٌ** — لأنّ الملفَّ يُقرأ بجانبِ
   * `numInstances`، وسكوتُه يُبطِل التكافؤَ الذي يفرضه هذا الحاجزُ.
   */
  it("غيابُ PROCESS_TOPOLOGY من ملفِّ النشرِ ⇒ سقوطٌ — لا افتراضَ ههنا", () => {
    expect(codes(withoutTopology(SOUND))).toContain("MISSING_PROCESS_TOPOLOGY");
  });

  it("والغيابُ يُميَّز عن البطلانِ برمزَين مختلفَين لا برمزٍ واحدٍ", () => {
    const missing = codes(withoutTopology(SOUND));
    const invalid = codes(withTopology(SOUND, "many"));
    expect(missing).toContain("MISSING_PROCESS_TOPOLOGY");
    expect(missing).not.toContain("INVALID_PROCESS_TOPOLOGY");
    expect(invalid).toContain("INVALID_PROCESS_TOPOLOGY");
    expect(invalid).not.toContain("MISSING_PROCESS_TOPOLOGY");
  });

  it("قيمةُ طوبولوجيا غيرُ صالحةٍ ⇒ سقوطٌ ولا تُردّ إلى الافتراضِ", () => {
    expect(codes(withTopology(SOUND, "many"))).toContain("INVALID_PROCESS_TOPOLOGY");
  });

  it("multi-process مع numInstances = 1 ⇒ تنافرُ إعلانَين", () => {
    const found = codes(withTopology(SOUND, "multi-process"));
    expect(found).toContain("TOPOLOGY_INSTANCES_MISMATCH");
    expect(found).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
  });

  it("رفعُ النسخِ مع بقاءِ single-process ⇒ تنافرُ إعلانَين كذلك", () => {
    const found = codes(SOUND.replace("    numInstances: 1", "    numInstances: 2"));
    expect(found).toContain("TOPOLOGY_INSTANCES_MISMATCH");
    expect(found).toContain("INSTANCES_ABOVE_ONE");
  });

  it("multi-process معلَنةٌ ⇒ سقوطٌ ما دام التوزيعُ داخلَ العمليةِ — أيّاً كان مخزنُ الجلساتِ", () => {
    const raised = withTopology(SOUND, "multi-process").replaceAll(
      "    numInstances: 1",
      "    numInstances: 2",
    );
    const withRedis = raised.replaceAll("        value: memory", "        value: redis");
    expect(codes(raised)).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
    expect(codes(withRedis)).toContain("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
    // وredis يرفع خرقَ ADR 0011 وحدَه، ولا يُسقِط خرقَ التوزيعِ.
    expect(codes(withRedis)).not.toContain("SESSION_STORE_INCOHERENT");
  });

  /**
   * قائمةُ الحاجزِ مكرَّرةٌ عن قصدٍ (أداةُ مستودعٍ لا تستورد شيفرةَ إنتاجٍ)،
   * والتكرارُ نفسُه محروسٌ ههنا كي لا يتباعد الموضعانِ صامتَين.
   */
  it("قائمةُ الطوبولوجيا في الحاجزِ تُطابِق قائمةَ الضبطِ", () => {
    expect([...VALID_PROCESS_TOPOLOGIES]).toEqual([...PROCESS_TOPOLOGY_NAMES]);
  });

  it("الحاجزُ يفحص الخدمةَ الصحيحةَ لا خدمةً غيرَ مرتبطةٍ", () => {
    expect(Object.keys(CLASSIFIED_SERVICES).sort()).toEqual([
      ADMIN_SERVICE_NAME,
      "waslah-gateway",
      "waslah-miniapp",
      "waslah-worker",
    ]);
    expect(REQUIRED_SERVICES).toContain("waslah-gateway");
  });
});

/*
 * المواقعُ الساكنةُ — `F1-10` · ADR 0165.
 *
 * والمقصودُ برهانُ أنَّ الفرعَ الجديدَ **إعفاءٌ مشروطٌ لا ثُقبةٌ**: لا يمرُّ
 * منه موقعٌ غيرُ مصنَّفٍ، ولا تنفلتُ منه خدمةُ Docker تُسمّي نفسَها ساكنةً،
 * ولا يُقبَلُ فيه وصفٌ كاذبٌ كُتِبَ لإرضاءِ حاجزٍ.
 */
describe("المواقعُ الساكنةُ — F1-10 · ADR 0165", () => {
  const staticService = [
    "services:",
    "  - type: web",
    `    runtime: ${STATIC_RUNTIME}`,
    "    name: waslah-miniapp",
    "  - type: web",
    "    runtime: docker",
    "    name: waslah-gateway",
    "    numInstances: 1",
    "    envVars:",
    "      - key: PROCESS_TOPOLOGY",
    "        value: single-process",
    "      - key: RUN_WORKER_IN_GATEWAY",
    "        value: false",
    "      - key: RUN_ADMIN_IN_GATEWAY",
    "        value: false",
    "  - type: worker",
    "    runtime: docker",
    "    name: waslah-worker",
    "    numInstances: 1",
    "    envVars:",
    "      - key: PROCESS_TOPOLOGY",
    "        value: single-process",
    "      - key: RUN_WORKER_IN_GATEWAY",
    "        value: true",
    "      - key: RUN_ADMIN_IN_GATEWAY",
    "        value: false",
    "  - type: web",
    "    runtime: docker",
    `    name: ${ADMIN_SERVICE_NAME}`,
    "    numInstances: 1",
    "    envVars:",
    "      - key: PROCESS_TOPOLOGY",
    "        value: single-process",
    "      - key: RUN_WORKER_IN_GATEWAY",
    "        value: false",
    "      - key: RUN_ADMIN_IN_GATEWAY",
    "        value: true",
  ].join("\n");

  it("يُقرأ حقلُ runtime منَ المانيفستِ", () => {
    const services = servicesFromManifest(staticService);
    const miniapp = services.find((service) => service.name === "waslah-miniapp");
    expect(miniapp?.runtime).toBe(STATIC_RUNTIME);
    expect(services.find((service) => service.name === "waslah-gateway")?.runtime).toBe("docker");
  });

  it("موقعٌ ساكنٌ بلا numInstances ولا طوبولوجيا يمرُّ — لا عمليّةَ تُحاكَمُ", () => {
    const findings = analyse(staticService);
    expect(findings).toEqual([]);
  });

  it("موقعٌ ساكنٌ غيرُ مصنَّفٍ يسقُطُ — الإعفاءُ لا يسبقُ التصنيفَ", () => {
    const codes = analyse(staticService.replace("name: waslah-miniapp", "name: waslah-ghost")).map(
      (finding) => finding.code,
    );
    expect(codes).toContain("UNCLASSIFIED_SERVICE");
  });

  it("موقعٌ ساكنٌ يُعلِنُ numInstances يسقُطُ — وصفٌ كاذبٌ أو خدمةٌ متنكّرةٌ", () => {
    const codes = analyse(
      staticService.replace(
        "    name: waslah-miniapp",
        "    name: waslah-miniapp\n    numInstances: 1",
      ),
    ).map((finding) => finding.code);
    expect(codes).toContain("STATIC_DECLARES_INSTANCES");
  });

  it("موقعٌ ساكنٌ يُعلِنُ PROCESS_TOPOLOGY يسقُطُ — إعلانٌ لا يقرأُه أحدٌ", () => {
    const codes = analyse(
      staticService.replace(
        "    name: waslah-miniapp",
        "    name: waslah-miniapp\n    envVars:\n      - key: PROCESS_TOPOLOGY\n        value: single-process",
      ),
    ).map((finding) => finding.code);
    expect(codes).toContain("STATIC_DECLARES_TOPOLOGY");
  });

  it("موقعٌ ساكنٌ يُعلِنُ SESSION_STORE يسقُطُ — سرُّ خادمٍ في حزمةٍ عامّةٍ", () => {
    const codes = analyse(
      staticService.replace(
        "    name: waslah-miniapp",
        "    name: waslah-miniapp\n    envVars:\n      - key: SESSION_STORE\n        value: redis",
      ),
    ).map((finding) => finding.code);
    expect(codes).toContain("STATIC_DECLARES_SESSION_STORE");
  });

  it("خدمةُ Docker لا تنفلتُ منَ الشرطِ — الحكمُ على runtime لا على الاسمِ", () => {
    const codes = analyse(
      staticService.replace(
        "    runtime: docker\n    name: waslah-gateway",
        "    name: waslah-gateway",
      ),
    ).map((finding) => finding.code);
    expect(codes).toEqual([]);
    const escaped = analyse(
      staticService.replace(
        "    runtime: docker\n    name: waslah-gateway",
        `    runtime: ${STATIC_RUNTIME}\n    name: waslah-gateway`,
      ),
    ).map((finding) => finding.code);
    expect(escaped).toContain("STATIC_DECLARES_INSTANCES");
    expect(escaped).toContain("STATIC_DECLARES_TOPOLOGY");
  });
});

describe("موضعُ المهامِّ الدوريّةِ — F5-04 / SCL-007 · ADR 0063", () => {
  it("تُقرأ قيمةُ RUN_WORKER_IN_GATEWAY ونوعُ الخدمةِ لكلِّ خدمةٍ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.serviceType).toBe("web");
    expect(services[0]?.runWorkerInGateway).toBe("false");
    expect(services[1]?.serviceType).toBe("worker");
  });

  /**
   * برهانُ أنّ الفرزَ الصريحَ في القارئِ يعمل: مفتاحٌ ثالثٌ لا يُلوِّث الطوبولوجيا.
   * ولو أُسنِد بـ`else` جامعٍ لصارت الطوبولوجيا «false» ونجحَ الحاجزُ على ملفٍّ
   * لم يفهمه.
   */
  it("مفتاحُ موضعِ المهامِّ لا يُلوِّث قيمةَ الطوبولوجيا", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.processTopology).toBe("single-process");
  });

  // 2026-10-02: الخطّةُ المجّانيّةُ ⇒ لا خدمةَ عاملٍ، والمهامُّ في البوّابةِ (render.yaml).
  it("المستودعُ الحقيقيُّ يُعلِن الإدماجَ: البوّابةُ true ولا خدمةَ عاملٍ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway?.runWorkerInGateway).toBe("true");
    expect(services.some((service) => service.serviceType === "worker")).toBe(false);
    for (const service of processServices(REAL_MANIFEST)) {
      expect(service.runWorkerInGateway).not.toBeNull();
    }
  });

  it("غيابُ الإعلانِ ⇒ سقوطٌ — لأنّ الإنتاجَ لا يُقلع بلا سطرِه", () => {
    expect(codes(withoutRunWorker(SOUND))).toContain("MISSING_RUN_WORKER_DECLARATION");
  });

  it("قيمةٌ لا تُفهَم ⇒ سقوطٌ ولا تُردُّ إلى الافتراضِ", () => {
    expect(codes(withRunWorker(SOUND, '"fasle"'))).toContain("INVALID_RUN_WORKER_VALUE");
  });

  /** الغيابُ والبطلانُ يُميَّزانِ برمزَين: العلاجُ مختلفٌ فلا يُوحَّد الرمزُ. */
  it("الغيابُ والبطلانُ رمزانِ مختلفانِ لا رمزٌ واحدٌ", () => {
    expect(codes(withoutRunWorker(SOUND))).not.toContain("INVALID_RUN_WORKER_VALUE");
    expect(codes(withRunWorker(SOUND, '"maybe"'))).not.toContain("MISSING_RUN_WORKER_DECLARATION");
  });

  /**
   * الخرقُ الجوهريُّ للمرحلةِ: بوّابةٌ تتخلّى عن المهامِّ ولا حاملَ لها. وهذا هو
   * الحالُ المُشخَّصُ في `docs/directive-item-0-live-diagnosis.md` §0.2 — لكنّه
   * كان يقع في المنصّةِ لا في الملفِّ، والحاجزُ يمنع **تعبيرَ الملفِّ عنه**.
   */
  it("بوّابةٌ بـfalse بلا خدمةِ عاملٍ ⇒ نظامٌ بلا مهامَّ ⇒ سقوطٌ", () => {
    expect(codes(GATEWAY_ONLY)).toContain("JOBS_ORPHANED");
  });

  it("بوّابةٌ بـfalse مع خدمةِ عاملٍ ⇒ قبولٌ — هذا هو الفصلُ", () => {
    expect(analyse(SOUND)).toEqual([]);
  });

  /** الإدماجُ بلا خدمةِ عاملٍ حالٌ مقبولةٌ: المهامُّ تعمل في موضعٍ واحدٍ. */
  it("بوّابةٌ بـtrue بلا خدمةِ عاملٍ ⇒ قبولٌ — لا تُتَّهم الحالُ السابقةُ", () => {
    expect(analyse(withRunWorker(GATEWAY_ONLY, '"true"'))).toEqual([]);
  });

  /**
   * القفلُ الموزَّعُ (ADR 0009) يجعل التكرارَ تخطّياً لا تنفيذاً مزدوجاً، فتشغيلُ
   * الموضعَين معاً ليس خرقاً يُسقِط النشرَ. ولو أُسقِط لصار الرجوعُ عن الفصلِ في
   * حادثةٍ مستعجلةٍ ممنوعاً بحاجزٍ — وهو منعُ علاجٍ لا منعُ عطلٍ.
   */
  it("بوّابةٌ بـtrue مع خدمةِ عاملٍ ⇒ قبولٌ — القفلُ يحمي من التكرارِ", () => {
    expect(analyse(withRunWorker(SOUND, '"true"'))).toEqual([]);
  });

  /**
   * الاسمُ لا يكفي: خدمةٌ تُسمّى `waslah-worker` وتُعلَن `type: web` ليست عاملاً،
   * ولو قُبِلت لصار الحاجزُ يُصدِّق تسميةً لا إعلاناً.
   */
  it("خدمةٌ باسمِ عاملٍ ونوعِ web لا تُعَدُّ حاملاً للمهامِّ", () => {
    expect(codes(SOUND.replace("  - type: worker", "  - type: web"))).toContain("JOBS_ORPHANED");
  });

  it("قائمةُ المنطقيِّ في الحاجزِ تُطابِق قائمةَ الضبطِ", () => {
    expect([...VALID_BOOLEAN_LITERALS]).toEqual([...BOOLEAN_ENV_LITERALS]);
  });
});

/**
 * ## موضعُ سطحِ الإدارةِ — F5-08 / ARCH-011 · ADR 0064
 *
 * والمقصودُ إثباتُ **الطرفِ الصامتِ** قبلَ كلِّ شيءٍ: `ADMIN_DUPLICATED`. فهو الحالُ
 * التي لا يُخفِق فيها طلبٌ ولا يشكو فيها سجلٌّ — الخدمتان تُقلعان واللوحةُ تعمل
 * من العنوانَين — ولا يضيع إلّا الغرضُ الذي دُفعت خدمةٌ كاملةٌ ثمناً له. وما لا
 * يُخفِق ظاهراً لا يُحرَسُ إلّا بحاجزٍ واختبارٍ يُثبِت أنّ الحاجزَ يراه.
 */
describe("موضعُ سطحِ الإدارةِ — F5-08 / ARCH-011 · ADR 0064", () => {
  /** خدمةُ اللوحةِ كما في المخطوطةِ الحقيقيةِ: `web`، نسخةٌ واحدةٌ، الإعلاناتُ الأربعةُ. */
  const ADMIN_SERVICE = [
    "  - type: web",
    `    name: ${ADMIN_SERVICE_NAME}`,
    "    numInstances: 1",
    "    envVars:",
    "      - key: SESSION_STORE",
    "        value: redis",
    "      - key: PROCESS_TOPOLOGY",
    "        value: single-process",
    "      - key: RUN_WORKER_IN_GATEWAY",
    '        value: "no"',
    "      - key: RUN_ADMIN_IN_GATEWAY",
    '        value: "no"',
    "",
  ].join("\n");

  /** يُبدِّل قيمةَ موضعِ اللوحةِ وحدَها — الثوابتُ تُعلنها `"true"` فلا تلتبس بغيرِها. */
  const withRunAdmin = (content: string, value: string): string =>
    content.replaceAll('        value: "true"', `        value: ${value}`);

  /** يحذف إعلانَ موضعِ اللوحةِ كلَّه — لإثباتِ أنّ الغيابَ سقوطٌ لا افتراضٌ. */
  const withoutRunAdmin = (content: string): string =>
    content.replaceAll('      - key: RUN_ADMIN_IN_GATEWAY\n        value: "true"\n', "");

  it("تُقرأ قيمةُ RUN_ADMIN_IN_GATEWAY لكلِّ خدمةٍ", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.runAdminInGateway).toBe("true");
    expect(services[1]?.runAdminInGateway).toBe("true");
  });

  /**
   * **الاختبارُ الذي يحرس الخطأَ الذي وقعَ مرّتَين**: القارئُ كان يُسنِد كلَّ ما
   * ليس `SESSION_STORE` ولا `PROCESS_TOPOLOGY` إلى `runWorkerInGateway` بـ`else`
   * جامعٍ. وذلك صحيحٌ بثلاثةِ مفاتيحَ وخطأٌ بأربعةٍ: قيمةُ موضعِ اللوحةِ تُقرأ
   * موضعاً للمهامِّ فينجحُ الحاجزُ على ملفٍّ لم يفهمه. والقيمتانِ ههنا **مختلفتانِ
   * عن قصدٍ** (`false` للمهامِّ و`true` للوحةِ) لأنّ تساويهما يُخفي الاختلاطَ.
   */
  it("مفتاحا الموضعَين لا يختلطان: كلُّ قيمةٍ في حقلِها", () => {
    const services = servicesFromManifest(SOUND);
    expect(services[0]?.runWorkerInGateway).toBe("false");
    expect(services[0]?.runAdminInGateway).toBe("true");
    expect(services[0]?.processTopology).toBe("single-process");
    expect(services[0]?.sessionStore).toBe("memory");
  });

  it("الغيابُ والبطلانُ رمزانِ مختلفانِ لا رمزٌ واحدٌ", () => {
    expect(codes(withoutRunAdmin(SOUND))).toContain("MISSING_RUN_ADMIN_DECLARATION");
    expect(codes(withRunAdmin(SOUND, '"eventually"'))).toContain("INVALID_RUN_ADMIN_VALUE");
  });

  /** كلُّ حروفِ المنطقيِّ تُفهَم ههنا كما تُفهَم في موضعِ المهامِّ — لا قائمةَ ثانيةَ. */
  it("كلُّ حرفٍ صالحٍ يُقبَل، والمجهولُ وحدَه يُرفَض", () => {
    for (const literal of VALID_BOOLEAN_LITERALS) {
      expect(codes(withRunAdmin(SOUND, `"${literal}"`))).not.toContain("INVALID_RUN_ADMIN_VALUE");
    }
  });

  /**
   * الحالُ الصامتةُ: لوحةٌ في موضعَين. لا شيءَ يُخفِق — ولذلك يُرفَض في المخطوطةِ.
   */
  it("بوّابةٌ بـtrue **مع** خدمةِ لوحةٍ ⇒ سقوطٌ — عزلٌ مدفوعٌ ثمنُه وغيرُ قائمٍ", () => {
    expect(codes(SOUND + ADMIN_SERVICE)).toContain("ADMIN_DUPLICATED");
  });

  /** وكلُّ حرفٍ مُثبِتٍ يُقرأ إثباتاً: «yes» ليست حيلةً للإفلاتِ من الحكمِ. */
  it("كلُّ حرفٍ مُثبِتٍ مع خدمةِ لوحةٍ ⇒ سقوطٌ، لا «true» وحدَها", () => {
    for (const literal of ["true", "1", "yes", "on"]) {
      expect(codes(withRunAdmin(SOUND, `"${literal}"`) + ADMIN_SERVICE)).toContain(
        "ADMIN_DUPLICATED",
      );
    }
  });

  it("بوّابةٌ بـfalse بلا خدمةِ لوحةٍ ⇒ سقوطٌ — لا سطحَ إدارةٍ في أيِّ موضعٍ", () => {
    expect(codes(withRunAdmin(SOUND, '"false"'))).toContain("ADMIN_ORPHANED");
  });

  it("بوّابةٌ بـfalse **مع** خدمةِ لوحةٍ ⇒ قبولٌ — هذا هو الفصلُ", () => {
    expect(codes(withRunAdmin(SOUND, '"false"') + ADMIN_SERVICE)).toEqual([]);
  });

  /**
   * الحالُ السابقةُ لا تُتَّهم: `true` بلا خدمةِ لوحةٍ إدماجٌ صريحٌ مكتوبٌ، وهو
   * طريقُ التراجعِ الطارئِ. وحاجزٌ يرفضه كان سيمنع التراجعَ في وقتِ الحاجةِ إليه.
   */
  it("بوّابةٌ بـtrue بلا خدمةِ لوحةٍ ⇒ قبولٌ — التراجعُ الطارئُ يبقى مشروعاً", () => {
    expect(codes(SOUND)).toEqual([]);
  });

  /**
   * خدمةُ اللوحةِ تُميَّز **بالاسمِ** لا بالنوعِ: نوعُها `web` كالبوّابةِ. فخدمةٌ
   * `web` أخرى ليست لوحةً — ولو أُخِذ النوعُ معياراً لصارت البوّابةُ نفسُها
   * «خدمةَ لوحةٍ» فما وقعَ `ADMIN_ORPHANED` قطُّ ولا `ADMIN_DUPLICATED`.
   */
  it("خدمةُ web أخرى ليست خدمةَ لوحةٍ — التمييزُ بالاسمِ", () => {
    const renamed = ADMIN_SERVICE.replace(
      `name: ${ADMIN_SERVICE_NAME}`,
      "name: waslah-gateway-canary",
    );
    const result = codes(withRunAdmin(SOUND, '"false"') + renamed);
    expect(result).toContain("ADMIN_ORPHANED");
    expect(result).toContain("UNCLASSIFIED_SERVICE");
  });

  // 2026-10-02: «التراجعُ الطارئُ» الموثَّقُ في render.yaml — اللوحةُ في البوّابةِ.
  it("المستودعُ الحقيقيُّ يُعلِن الإدماجَ: البوّابةُ true ولا خدمةَ لوحةٍ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway?.runAdminInGateway).toBe("true");
    expect(services.some((service) => service.name === ADMIN_SERVICE_NAME)).toBe(false);
    // والإعلانُ في **كلِّ** خدمةٍ لا في المعنيّةِ وحدَها: الإلزامُ على كلِّ عمليّةٍ.
    // و«كلُّ خدمةٍ» ههنا «كلُّ عمليّةٍ» حرفاً — لا موقعَ ساكناً (ADR 0165).
    for (const service of processServices(REAL_MANIFEST)) {
      expect(service.runAdminInGateway).not.toBeNull();
    }
  });

  it("البوّابةُ الحاملةُ للّوحةِ نسخةٌ واحدةٌ وتُعلِن redis لمجرى الأحداثِ", () => {
    const services = servicesFromManifest(REAL_MANIFEST);
    const gateway = services.find((service) => service.name === "waslah-gateway");
    expect(gateway?.serviceType).toBe("web");
    expect(gateway?.numInstances).toBe("1");
    // ‏`memory` ههنا تعني مجرىً يعمل بلا دلتا لحظيّةٍ واحدةٍ — عطلٌ لا يُخفِق فيه طلبٌ.
    expect(gateway?.sessionStore).toBe("redis");
  });
});

describe("رمزُ خروجِ الحاجزِ لا نصُّه", () => {
  const runBarrier = async (content: string | null): Promise<number> => {
    let path = "/tmp/لا-يوجد-ملفُّ-نشرٍ-قط.yaml";
    if (content !== null) {
      const dir = mkdtempSync(join(tmpdir(), "instance-invariant-"));
      path = join(dir, "render.yaml");
      writeFileSync(path, content);
    }
    const child = Bun.spawn(["bun", "scripts/check-instance-invariant.ts", path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return await child.exited;
  };

  it("خرقٌ مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ، وإزالتُه ⇒ صفرٌ", async () => {
    expect(await runBarrier(SOUND.replace("numInstances: 1", "numInstances: 2"))).toBe(1);
    expect(await runBarrier(SOUND)).toBe(0);
  }, 30_000);

  it("خرقُ طوبولوجيا مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ في كلِّ صورةٍ من صورِه", async () => {
    expect(await runBarrier(withoutTopology(SOUND))).toBe(1);
    expect(await runBarrier(withTopology(SOUND, "many"))).toBe(1);
    expect(await runBarrier(withTopology(SOUND, "multi-process"))).toBe(1);
    expect(await runBarrier(SOUND.replace("    numInstances: 1", "    numInstances: 2"))).toBe(1);
    // وإزالةُ الخرقِ تُعيد الصفرَ — كي لا يكون السقوطُ دائماً.
    expect(await runBarrier(SOUND)).toBe(0);
  }, 60_000);

  it("خرقُ طوبولوجيا مزروعٌ في نسخةٍ من الملفِّ الحقيقيِّ ⇒ سقوطٌ", async () => {
    expect(await runBarrier(withoutTopology(REAL_MANIFEST))).toBe(1);
    expect(await runBarrier(withTopology(REAL_MANIFEST, "multi-process"))).toBe(1);
  }, 60_000);

  /**
   * خرقُ موضعِ اللوحةِ يُقاس **برمزِ خروجٍ** لا برجوعِ دالّةٍ: الحاجزُ في CI أمرٌ
   * يُشغَّل، وحكمٌ صحيحٌ لا يُترجَم إلى رمزٍ غيرِ صفريٍّ لا يمنع دفعةً واحدةً.
   */
  it("خرقُ موضعِ اللوحةِ مزروعٌ ⇒ رمزٌ غيرُ صفريٍّ في صورتَيه", async () => {
    // يتيمٌ: البوّابةُ تنفي ولا خدمةَ لوحةٍ في الثوابتِ.
    expect(
      await runBarrier(SOUND.replaceAll('        value: "true"', '        value: "false"')),
    ).toBe(1);
    // مبطَلٌ: قيمةٌ لا تُفهَم.
    expect(
      await runBarrier(SOUND.replaceAll('        value: "true"', "        value: maybe")),
    ).toBe(1);
    // وغائبٌ.
    expect(
      await runBarrier(
        SOUND.replaceAll('      - key: RUN_ADMIN_IN_GATEWAY\n        value: "true"\n', ""),
      ),
    ).toBe(1);
    expect(await runBarrier(SOUND)).toBe(0);
  }, 60_000);

  it("ملفٌّ غائبٌ أو فارغٌ ⇒ سقوطٌ لا تخطٍّ", async () => {
    expect(await runBarrier(null)).toBe(1);
    expect(await runBarrier("")).toBe(1);
  }, 30_000);

  it("خرقٌ مزروعٌ في نسخةٍ من الملفِّ الحقيقيِّ ⇒ سقوطٌ، والملفُّ الحقيقيُّ ⇒ صفرٌ", async () => {
    expect(await runBarrier(REAL_MANIFEST.replace("numInstances: 1", "numInstances: 3"))).toBe(1);

    const onRealRepo = Bun.spawn(["bun", "scripts/check-instance-invariant.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await onRealRepo.exited).toBe(0);
  }, 30_000);
});

/**
 * عقدُ الإنتاجِ لمخزنِ الجلساتِ — `BUG-016` · `SCL-002` · `BUG-007`.
 *
 * والسالبُ ههنا **مبذورٌ من واقعٍ وقعَ** لا من خيالٍ: `render.yaml` أعلنَ
 * `NODE_ENV=production` مع `SESSION_STORE=memory` لخدمتَي البوّابةِ والعاملِ،
 * فكانَ ملفُّ النشرِ يصفُ إنتاجاً لا يُقلعُ — ومرَّ الحاجزُ عليه أخضرَ لأنَّه
 * كانَ يمتنعُ عن الحكمِ على القيمةِ بذاتِها.
 */
describe("عقدُ الإنتاجِ لمخزنِ الجلساتِ — BUG-016", () => {
  const inProduction = (manifest: string): string =>
    manifest.replaceAll(
      "    envVars:",
      "    envVars:\n      - key: NODE_ENV\n        value: production",
    );

  it("الخرقُ المبذورُ: production + memory ⇒ سقوطٌ", () => {
    expect(codes(inProduction(SOUND))).toContain("SESSION_STORE_MEMORY_IN_PRODUCTION");
  });

  it("الإصلاحُ يرفعُ الخرقَ: production + redis ⇒ لا سقوطَ لهذا السببِ", () => {
    const fixed = inProduction(SOUND).replaceAll("        value: memory", "        value: redis");
    expect(codes(fixed)).not.toContain("SESSION_STORE_MEMORY_IN_PRODUCTION");
  });

  /**
   * أهمُّ فحصٍ في هذا القسمِ: الحكمُ **ليس مستقلّاً بعددِ النسخِ**. فالثُقبةُ
   * التي وقعَت كانَت على نسخةٍ واحدةٍ بالضبطِ — ولو رُبِطَ الحكمُ بالعددِ
   * لعادَت الثُقبةُ نفسُها بحرفِها.
   */
  it("الحكمُ لا يتعلّقُ بعددِ النسخِ: نسخةٌ واحدةٌ تُسقِطُ كذلك", () => {
    const single = inProduction(SOUND);
    expect(single).toContain("numInstances: 1");
    expect(codes(single)).toContain("SESSION_STORE_MEMORY_IN_PRODUCTION");
    // ولا يُنسَبُ السقوطُ إلى حكمِ ADR 0011 الذي يشترطُ رفعَ النسخِ.
    expect(codes(single)).not.toContain("SESSION_STORE_INCOHERENT");
  });

  it("غيرُ الإنتاجِ لا يُحاكَمُ: staging + memory ⇒ لا سقوطَ", () => {
    const staging = inProduction(SOUND).replaceAll(
      "        value: production",
      "        value: staging",
    );
    expect(codes(staging)).not.toContain("SESSION_STORE_MEMORY_IN_PRODUCTION");
  });

  /**
   * **ربطُ المصدرَينِ كي لا يتباعدا صامتَينِ.** الحاجزُ لا يخترعُ حكماً: هو
   * ينقلُ حكمَ `packages/shared/config` حرفاً. فلو خُفِّفَ الضبطُ يوماً وصارَ
   * `memory` مقبولاً في الإنتاجِ، **سقطَ هذا الفحصُ** ونُبِّهَ من يُخفِّفُ إلى
   * أنَّ ههنا حاجزاً يقولُ غيرَ ما يقولُ الضبطُ — لا حاجزاً يكذبُ بصمتٍ.
   */
  it("حكمُ الحاجزِ منقولٌ عن الضبطِ لا مخترعٌ عندَه", () => {
    // بيئةٌ **كاملةٌ** كي يكونَ السببُ الوحيدُ للرفضِ هو مخزنُ الجلساتِ لا نقصُ
    // مفاتيحَ — فالمقيسُ حكمٌ بعينِه لا سقوطٌ لأيِّ سببٍ كانَ.
    const FULL_ENV: Record<string, string> = {
      SUPABASE_URL: "https://project.supabase.co",
      DATABASE_URL: "postgres://user:pass@db.project.supabase.co:5432/postgres",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "redis-token",
      DRIVER_BOT_TOKEN: "driver-token",
      RIDER_BOT_TOKEN: "rider-token",
      RUN_WORKER_IN_GATEWAY: "false",
      RUN_ADMIN_IN_GATEWAY: "false",
      // الإنتاجُ يُلزمُ طولاً أدنى للأسرارِ، فتُستعملُ أسرارٌ صالحةٌ في الإنتاجِ
      // كي لا يسقطَ الضبطُ لسببٍ غيرِ المقيسِ.
      TELEGRAM_WEBHOOK_SECRET: "t".repeat(48),
      SESSION_SECRET: "s".repeat(48),
      BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
      MINIAPP_URL: "https://app.example.com",
      PROCESS_TOPOLOGY: "single-process",
    };

    // الطرفُ المرفوضُ: هو بعينِه ما كانَ `render.yaml` يُعلنُه.
    const rejected = tryLoadConfig({
      ...FULL_ENV,
      NODE_ENV: "production",
      SESSION_STORE: "memory",
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.message).toContain("SESSION_STORE");
    }

    // والطرفُ المقبولُ: هو بعينِه ما صارَ `render.yaml` يُعلنُه بعدَ الإصلاحِ.
    const accepted = tryLoadConfig({
      ...FULL_ENV,
      NODE_ENV: "production",
      SESSION_STORE: "redis",
    });
    expect(accepted.ok).toBe(true);
  });

  /**
   * حراسةُ الانحدارِ على المستودعِ الحقيقيِّ: لا خدمةَ إنتاجيّةً واحدةً في
   * `render.yaml` تُعلِنُ `memory`. وهذا هو الفحصُ الذي كانَ غائباً يومَ وقعَ العطلُ.
   */
  it("المستودعُ الحقيقيُّ: لا خدمةَ إنتاجيّةً بمخزنِ جلساتٍ في الذاكرةِ", () => {
    const offenders = servicesFromManifest(REAL_MANIFEST)
      .filter((service) => service.nodeEnv === "production" && service.sessionStore === "memory")
      .map((service) => service.name);
    expect(offenders).toEqual([]);
    expect(codes(REAL_MANIFEST)).not.toContain("SESSION_STORE_MEMORY_IN_PRODUCTION");
  });

  /**
   * وأنَّ الحاجزَ يقرأُ `NODE_ENV` فعلاً من الملفِّ الحقيقيِّ — كي لا يمرَّ
   * الفحصُ أعلاه لأنَّ القراءةَ `null` دائماً (نجاحٌ على ملفٍّ لم يُفهَم).
   */
  it("الحاجزُ يقرأُ NODE_ENV من الملفِّ الحقيقيِّ لا يتجاهلُه", () => {
    const declared = servicesFromManifest(REAL_MANIFEST).filter(
      (service) => service.nodeEnv === "production",
    );
    // 2026-10-02: عمليّةٌ إنتاجيّةٌ واحدةٌ (البوّابةُ الجامعةُ) — والموقعُ الساكنُ لا يُقلِعُ.
    expect(declared.length).toBeGreaterThanOrEqual(1);
  });
});
