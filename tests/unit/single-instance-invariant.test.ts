/**
 * الغرض: إثباتُ أنّ شرطَ صحّةِ النسخةِ الواحدةِ (`R-17` · ADR 0050 · **ADR 0051**)
 *    يُفشِل الإقلاعَ فعلاً لا في تعليقٍ، وأنّه **يُفشِله على الطوبولوجيا لا على مخزنِ
 *    الجلساتِ**، وأنّ رسالتَه لا تكشف سرّاً.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI (`bun run test`).
 * ملاحظات مستقبلية: يومَ تُقرَّر آليةُ توزيعٍ تعبر العمليةَ يُضاف لها فرعٌ ههنا،
 *    ولا يُحذَف الفرعُ القائمُ إلّا بـADR ناسخٍ.
 *
 * ## ما تغيّر بـADR 0051
 *
 * الصيغةُ الأولى من هذا الملفِّ كانت **تُثبِّت العيبَ**: تُؤكِّد أنّ `SESSION_STORE=redis`
 * يُسقِط الإقلاعَ. وذلك استدلالٌ معكوسٌ (`multi-process ⇒ redis` لا عكسُه)، فصار
 * الاختبارُ يُثبِت النقيضَ: **`single-process + redis` حالةٌ مشروعةٌ لا تمنع الإقلاعَ**،
 * والرفضُ على `PROCESS_TOPOLOGY=multi-process` وحدَه.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DECIDED_EVENT_DISTRIBUTION,
  EVENT_DISTRIBUTION_MECHANISMS,
  singleInstanceInvariantViolation,
} from "../../packages/shared/config/single-instance.ts";

/**
 * قيمٌ صناعيّةٌ تُشبه الأسرارَ شكلاً ولا تُصيب شيئاً حقيقيّاً. غرضُها أن تُبحَث في
 * مخرجِ الإقلاعِ: حضورُ واحدةٍ منها فيه كشفُ سرٍّ.
 */
const FAKE_SECRETS = {
  DATABASE_URL: "postgres://fake_user:fakepassword123@127.0.0.1:5432/fake_db",
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-AAAAAAAAAAAAAAAAAAAA",
  UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token-BBBBBBBBBBBBBBBBBBBB",
  DRIVER_BOT_TOKEN: "1111111:fake-driver-bot-token-CCCCCCCCCCCC",
  RIDER_BOT_TOKEN: "2222222:fake-rider-bot-token-DDDDDDDDDDDD",
  TELEGRAM_WEBHOOK_SECRET: "fake-webhook-secret-EEEEEEEEEEEEEEEE",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "999999999",
  // `ADR 0286` — سطحُ miniapp افتراضًا، وعنوانُ التطبيقِ شرطُ إقلاعِه.
  MINIAPP_URL: "https://fake-miniapp.example.com",
  // F5-04 / ADR 0063: إعلانٌ إلزاميٌّ في الإنتاج، وهذه البيئةُ إنتاجيّةٌ. وبلا
  // سطرِه يسقط الإقلاعُ على شرطٍ آخرَ فيصير المُختبَرُ غيرَ ما كُتِب له.
  RUN_WORKER_IN_GATEWAY: "false",
  // `F5-08` / ADR 0064: الطفلُ يُقلعُ ببيئةِ إنتاجٍ، والإعلانُ صارَ إلزاميّاً فيها.
  // و`false` ههنا لا تُعطِّلُ ما يقيسُهُ هذا الملفُّ: اللوحةُ ليست موضوعَهُ أصلاً.
  RUN_ADMIN_IN_GATEWAY: "false",
} as const;

describe("شرطُ صحّةِ النسخةِ الواحدةِ — الحكمُ النقيُّ (جدولُ ADR 0051 §٢-ج كاملاً)", () => {
  it("single-process + memory ⇒ يسمح", () => {
    expect(
      singleInstanceInvariantViolation({
        topology: "single-process",
        sessionStore: "memory",
        distribution: DECIDED_EVENT_DISTRIBUTION,
      }),
    ).toBeNull();
  });

  /**
   * **هذا هو العيبُ المُصحَّحُ.** الحكمُ القديمُ كان يرفض هذه الحالةَ لأنّه يقرأ
   * `redis` إعلانَ تعدُّدِ عملياتٍ. وهي حالةٌ إنتاجيةٌ مشروعةٌ، بل هي الخطوةُ الأولى
   * في مسارِ الانتقالِ المكتوبِ في `docs/render-deployment-vars.md` §٣.
   */
  it("single-process + redis ⇒ يسمح — مكانُ الجلساتِ لا يخلق عمليةً ثانيةً", () => {
    expect(
      singleInstanceInvariantViolation({
        topology: "single-process",
        sessionStore: "redis",
        distribution: DECIDED_EVENT_DISTRIBUTION,
      }),
    ).toBeNull();
  });

  it("multi-process + redis ⇒ يرفض — التوزيعُ بين العملياتِ غيرُ منفَّذٍ", () => {
    const violation = singleInstanceInvariantViolation({
      topology: "multi-process",
      sessionStore: "redis",
      distribution: "in-process",
    });
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe("SINGLE_INSTANCE_INVARIANT");
    expect(violation?.reason).toBe("MULTI_PROCESS_WITHOUT_DISTRIBUTION");
    expect(violation?.name).toBe("SingleInstanceInvariantError");
    expect(violation).toBeInstanceOf(Error);
  });

  it("multi-process + memory ⇒ يرفض كذلك — ولا يمرّ لأنّ الجلساتِ في الذاكرةِ", () => {
    const violation = singleInstanceInvariantViolation({
      topology: "multi-process",
      sessionStore: "memory",
      distribution: "in-process",
    });
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe("SINGLE_INSTANCE_INVARIANT");
  });

  /**
   * الحكمُ على **الطوبولوجيا** لا على مخزنِ الجلساتِ: تبديلُ `sessionStore` وحدَه
   * لا يقلب الحكمَ في أيٍّ من الاتّجاهَين ما دامت الطوبولوجيا ثابتةً.
   */
  it("مخزنُ الجلساتِ وحدَه لا يقلب الحكمَ — الطوبولوجيا هي الفاصلُ", () => {
    const single = (["memory", "redis"] as const).map((store) =>
      singleInstanceInvariantViolation({
        topology: "single-process",
        sessionStore: store,
        distribution: "in-process",
      }),
    );
    expect(single).toEqual([null, null]);

    const multi = (["memory", "redis"] as const).map((store) =>
      singleInstanceInvariantViolation({
        topology: "multi-process",
        sessionStore: store,
        distribution: "in-process",
      }),
    );
    expect(multi.every((violation) => violation !== null)).toBe(true);
  });

  it("الرسالةُ تُسمّي البندَ والقرارَ والإصلاحَ — لا رمزاً غامضاً", () => {
    const violation = singleInstanceInvariantViolation({
      topology: "multi-process",
      sessionStore: "redis",
      distribution: "in-process",
    });
    const message = violation?.message ?? "";
    expect(message).toContain("R-17");
    expect(message).toContain("ADR 0050");
    expect(message).toContain("ADR 0051");
    expect(message).toContain("PROCESS_TOPOLOGY");
    expect(message).toContain("numInstances");
  });

  /**
   * القرارُ ثابتٌ في الشيفرةِ لا متغيّرُ بيئةٍ: من جعله متغيّراً جعل شرطَ الصحّةِ
   * قابلاً للإطفاءِ من لوحةِ تحكّمٍ، وهو عينُ ما يُعالجه `R-17`.
   */
  it("آليةُ التوزيعِ المُقرَّرةُ واحدةٌ ولا محوِّلَ اختِير", () => {
    expect(EVENT_DISTRIBUTION_MECHANISMS).toEqual(["in-process"]);
    expect(DECIDED_EVENT_DISTRIBUTION).toBe("in-process");
  });

  it("مُدخلُ الحكمِ لا يحمل سرّاً — قيدُ نوعٍ لا اتفاقٌ", () => {
    const source = readFileSync("packages/shared/config/single-instance.ts", "utf8");
    // لا `process.env` ولا قراءةَ بيئةٍ في وحدةِ الحكمِ: الضبطُ يُمرَّر إليها.
    expect(source).not.toContain("process.env");
    for (const key of Object.keys(FAKE_SECRETS)) {
      if (key === "SESSION_STORE") continue;
      expect(source).not.toContain(`${key}:`);
    }
  });
});

describe("نقطةُ إقلاعِ البوابةِ — سقوطٌ حقيقيٌّ برمزِ خروجٍ", () => {
  /**
   * تشغيلٌ فعليٌّ لنقطةِ الإقلاعِ ببيئةٍ صناعيّةٍ كاملةٍ. ولا يُصيب هذا التشغيلُ
   * قاعدةً ولا Redis ولا تيليجرام: الفحصُ يسبق تركيبَ أيِّ محوِّلٍ، فالخروجُ يقع
   * قبلَ أوّلِ اتّصالٍ. وهذا رمزُ خروجٍ لا نصٌّ — والنصُّ يُقرَأ للتحقّقِ من عدمِ
   * كشفِ سرٍّ لا للحكمِ على النجاح.
   */
  const spawnGateway = (env: Record<string, string>) =>
    Bun.spawn(["bun", "apps/gateway/src/index.ts"], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        ...FAKE_SECRETS,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

  const bootGateway = async (
    env: Record<string, string>,
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
    const child = spawnGateway(env);
    const exitCode = await child.exited;
    return {
      exitCode,
      stderr: await new Response(child.stderr).text(),
      stdout: await new Response(child.stdout).text(),
    };
  };

  /**
   * للحالاتِ المسموحةِ: لا يُنتظَر خروجٌ — الخدمةُ المسموحُ لها تمضي إلى تركيبِ
   * محوِّلاتِها. والمطلوبُ إثباتُ **عبورِ الحاجزِ** لا اكتمالِ الإقلاعِ، فتُمهَل
   * مدّةً ثمّ تُقتَل، ويُحكَم على غيابِ رمزِ الخرقِ من مخرجِها.
   */
  const bootGatewayUntilPastGuard = async (
    env: Record<string, string>,
  ): Promise<{ outcome: "exited" | "still-running"; stderr: string; stdout: string }> => {
    const child = spawnGateway(env);
    const outcome = await Promise.race([
      child.exited.then(() => "exited" as const),
      Bun.sleep(6_000).then(() => "still-running" as const),
    ]);
    if (outcome === "still-running") child.kill();
    return {
      outcome,
      stderr: await new Response(child.stderr).text(),
      stdout: await new Response(child.stdout).text(),
    };
  };

  it("multi-process + redis ⇒ إقلاعٌ يفشل برمزٍ غيرِ صفريٍّ", async () => {
    const result = await bootGateway({
      PROCESS_TOPOLOGY: "multi-process",
      SESSION_STORE: "redis",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SINGLE_INSTANCE_INVARIANT");
  }, 60_000);

  it("multi-process + memory ⇒ يُرفض memory في الإنتاج قبل فحص الطوبولوجيا", async () => {
    // SCL-002: الإنتاجُ يرفضُ مخزنَّ الذاكرةِ قبلَ أيِّ فحصٍ للطوبولوجيا — فلا يصلُ
    // النظامُ إلى حارسِ النسخةِ الواحدةِ أصلاً. وهذا عمدٌ: عطلُ الذاكرةِ أبسطُ
    // وأقدمُ من عطلِ الطوبولوجيا، فيُرفَضُ أوّلاً.
    const result = await bootGateway({
      PROCESS_TOPOLOGY: "multi-process",
      SESSION_STORE: "memory",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SESSION_STORE");
  }, 60_000);

  /**
   * القيمةُ المجهولةُ **خطأُ إعدادٍ حتميٌّ** لا ردٌّ صامتٌ إلى الافتراضِ (ADR 0051 §٢-ب).
   */
  it("PROCESS_TOPOLOGY بقيمةٍ غيرِ صالحةٍ ⇒ خطأُ إعدادٍ يمنع الإقلاعَ", async () => {
    const result = await bootGateway({ PROCESS_TOPOLOGY: "many", SESSION_STORE: "redis" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("PROCESS_TOPOLOGY");
    expect(result.stderr).toContain("single-process");
  }, 60_000);

  /**
   * **برهانُ التصحيحِ.** هذه الحالةُ كانت تسقط قبلَ ADR 0051 وهي مشروعةٌ.
   */
  it("single-process + SESSION_STORE=redis ⇒ لا يمنع الإقلاعَ", async () => {
    const result = await bootGatewayUntilPastGuard({
      PROCESS_TOPOLOGY: "single-process",
      SESSION_STORE: "redis",
    });
    // ما زالت حيّةً بعدَ المهلةِ: والحاجزُ يخرج فوراً، فبقاؤها برهانُ عبورِه.
    expect(result.outcome).toBe("still-running");
    expect(result.stderr).not.toContain("SINGLE_INSTANCE_INVARIANT");
  }, 60_000);

  /**
   * **الغيابُ ليس البطلانَ** (ADR 0051 §٢-ب): المفتاحُ الغائبُ من بيئةِ العمليةِ
   * يُقرأ `single-process` — وهو حالُ الإنتاجِ القائمُ — بينما القيمةُ المكتوبةُ
   * التي لا تُفهَم تمنع الإقلاعَ (الفحصُ أعلاه). والحالتان مفصولتانِ عن قصدٍ.
   *
   * **ولا يُقاس على هذا ملفُّ النشرِ:** غيابُ الإعلانِ من `render.yaml` **خرقٌ**
   * (`MISSING_PROCESS_TOPOLOGY` في `check-instance-invariant.test.ts`) لأنّه
   * إعلانُ نيّةٍ يُقرأ بجانبِ `numInstances` (§٢-هـ).
   */
  it("غيابُ PROCESS_TOPOLOGY ⇒ الافتراضُ single-process ولا يمنع الإقلاعَ", async () => {
    const result = await bootGatewayUntilPastGuard({ SESSION_STORE: "redis" });
    expect(result.outcome).toBe("still-running");
    expect(result.stderr).not.toContain("SINGLE_INSTANCE_INVARIANT");
  }, 60_000);

  it("رسالةُ الفشلِ لا تتضمّن قيمةَ سرٍّ واحدةً", async () => {
    const result = await bootGateway({
      PROCESS_TOPOLOGY: "multi-process",
      SESSION_STORE: "redis",
    });
    const output = `${result.stderr}\n${result.stdout}`;
    for (const value of Object.values(FAKE_SECRETS)) {
      if (value === FAKE_SECRETS.BOOTSTRAP_ADMIN_TELEGRAM_ID) continue;
      expect(output).not.toContain(value);
    }
    expect(output).not.toContain("fakepassword123");
  }, 60_000);

  it("رسالةُ خطأِ الطوبولوجيا غيرِ الصالحةِ لا تكشف سرّاً كذلك", async () => {
    const result = await bootGateway({ PROCESS_TOPOLOGY: "many", SESSION_STORE: "memory" });
    const output = `${result.stderr}\n${result.stdout}`;
    for (const value of Object.values(FAKE_SECRETS)) {
      if (value === FAKE_SECRETS.BOOTSTRAP_ADMIN_TELEGRAM_ID) continue;
      expect(output).not.toContain(value);
    }
  }, 60_000);
});
