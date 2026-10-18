/**
 * الغرض: **نموذجُ ميزانيةِ اتّصالاتِ القاعدةِ** موضعاً واحداً في الشيفرةِ لا فقرةً في
 *   وثيقةٍ — الشطرُ المفقودُ من `F7-04` (ROADMAP §12 · F7) بعدَ أن أغلقَ `CAP-004`
 *   شطرَي «قرارِ pooler» و«تعطيلِ الجُملِ المُحضَّرة» بـ[ADR 0056](../../../docs/adr/0056-supabase-transaction-pooler-and-prepared-statements.md).
 * الحالة: منفَّذ فعلياً — مصدرُ حقيقةٍ واحدٌ لكلِّ سقفِ تجمُّعٍ في عمليةٍ إنتاجيّةٍ،
 *   ومُنفَذٌ آليّاً بـ`scripts/check-connection-budget.ts` في سلسلةِ `bun run ci`.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: `packages/infrastructure/db/client.ts` (السقفُ الافتراضيُّ)
 *   · `apps/workers/src/container.ts` · `apps/admin/src/container.ts`
 *   · `packages/infrastructure/backup/restore-verifier.ts` · نقطةُ إقلاعِ البوّابةِ (سطرُ الميزانيةِ)
 * ملاحظات مستقبلية: يومَ يُرفَعُ `numInstances` لخدمةٍ يُعدَّلُ `DECLARED_TOPOLOGY`
 *   ههنا **ومانيفستُ النشرِ معاً**، وإلّا سقطَ الحاجزُ — والتكافؤُ مقصودٌ.
 *
 * ## لماذا وحدةٌ لا فقرةٌ في ADR
 *
 * نصُّ `CAP-004` أوجبَ «نموذجَ ميزانيةِ اتّصالاتٍ **معلَناً**»، وأُعلِنَ في
 * [ADR 0056](../../../docs/adr/0056-supabase-transaction-pooler-and-prepared-statements.md)
 * §٣-ج صيغةً نصّيّةً: `5N + 10M`. وتلكَ الصيغةُ كانت **صادقةً يومَ كُتِبَت** ثمّ
 * تقادَمَت بلا أن يُخطِرَ بها شيءٌ:
 *
 * ١. **خدمةُ اللوحةِ لم تكن موجودةً.** فُصِلَت لوحةُ الإدارةِ خدمةً ثالثةً
 *    (`F5-08` / `ARCH-011` · ADR 0064) ولها تجمُّعُها الخاصُّ — فصارَ حدٌّ كاملٌ
 *    خارجَ الصيغةِ، والصيغةُ لا تعرِفُ أنّها نقصَت.
 * ٢. **المهامُّ داخلَ البوّابةِ لا تُقرأُ من الصيغةِ.** `RUN_WORKER_IN_GATEWAY`
 *    تبني حاويةَ عاملٍ **في عمليةِ البوّابةِ** بتجمُّعَيها (`apps/gateway/src/embedded-worker.ts`)،
 *    فعمليةُ بوّابةٍ واحدةٌ تحملُ خمسةَ عشرَ اتّصالاً لا خمسةً — و`5N` تقولُ خمسةً.
 * ٣. **الرقمُ الخمسةُ كان مكتوباً بأربعةِ مواضعَ.** السقفُ الافتراضيُّ في
 *    `createSql`، وسقفُ العاملِ، وسقفُ اللوحةِ، وسقفُ قفلِ المهامِّ — أربعةُ ثوابتَ
 *    تصفُ ميزانيّةً واحدةً، ومَن عدَّلَ واحداً لم يكن شيءٌ يُلزمُه بالباقي.
 *
 * فالعيبُ ليسَ خطأً في الحسابِ بل أنّ **الميزانيّةَ لم تكن مقروءةً من مصدرِها**.
 * وهذه الوحدةُ تجعلُ الصيغةَ **محسوبةً من الثوابتِ التي يُقلعُ عليها الإنتاجُ
 * فعلاً** لا مكتوبةً بيدٍ بجوارِها — فتقادُمُها يصيرُ مستحيلاً لا مُستبعَداً.
 *
 * ## ما لا تدّعيه هذه الوحدةُ — صراحةً
 *
 * **لا تعرِفُ سقفَ المزوِّدِ.** عددُ الاتّصالاتِ الذي تسمحُ به خطّةُ Supabase
 * المُشترَكةُ مُدخَلٌ من خارجِ المستودعِ (خطّةُ الحسابِ · إعدادُ pooler)، ولا
 * يُشتقُّ من شيفرةٍ. فالمحسوبُ ههنا **الطلبُ** لا **العرضُ**، والمقارنةُ بينَهما
 * قرارُ سعةٍ يملكُه المالكُ. ورقمٌ مُخترَعٌ للسقفِ كان سيُنتجَ أسوأَ ما في البابِ:
 * حاجزٌ أخضرُ يُطمئِنُ على ميزانيّةٍ لم تُقَسْ (`ح-5`).
 *
 * **ولا تُغيِّرُ سلوكاً.** كلُّ رقمٍ ههنا هو الرقمُ الذي كانَ يُقلعُ عليه الإنتاجُ
 * قبلَ هذا الملفِّ حرفاً — نُقِلَ موضعُه ولم تُبدَّل قيمتُه.
 */

/**
 * أقصى تَوازٍ للمهامِّ الدوريّةِ. **موضعُه ههنا لا في حاويةِ العاملِ** لأنّه ليس
 * إعدادَ تشغيلٍ وحدَه: كلُّ مهمّةٍ جاريةٍ تحتجزُ اتّصالَ قفلٍ طولَ عملِها، فالرقمُ
 * حدٌّ في ميزانيّةِ الاتّصالاتِ قبلَ أن يكونَ حدَّ تَوازٍ. و`apps/workers/src/container.ts`
 * يُعيدُ تصديرَه باسمِه القديمِ `MAX_JOB_CONCURRENCY` فلا يتغيّرُ مُستدعٍ واحدٌ.
 */
export const JOB_CONCURRENCY = 4;

/**
 * أدوارُ تجمُّعاتِ الاتّصالِ في المستودعِ. **قائمةٌ مغلقةٌ**: تجمُّعٌ إنتاجيٌّ بلا
 * دورٍ ههنا يُسقِطُ الحاجزَ، لأنّ الغرضَ منعُ تسلُّلِ سقفٍ لا يعرفُه أحدٌ.
 */
export const DB_POOL_ROLES = [
  "gatewayRequest",
  "gatewayDispatch",
  "workerJobs",
  "workerLocks",
  "adminRequest",
  "restoreVerifier",
] as const;

export type DbPoolRole = (typeof DB_POOL_ROLES)[number];

/**
 * سقفُ كلِّ تجمُّعٍ. **هذه هي الأرقامُ التي يُقلعُ عليها الإنتاجُ**، لا نسخةٌ عنها:
 * كلُّ موضعِ إنشاءٍ يقرأُ من ههنا، ويُنفَذُ ذلكَ بالحاجزِ.
 */
export const DB_POOL_MAX: Readonly<Record<DbPoolRole, number>> = Object.freeze({
  /**
   * تجمُّعُ البوّابةِ: مسارُ الطلبِ كلُّه — ويبهوكُ تلغرام، ومسارُ HTTP للسائقِ،
   * وسطحُ اللوحةِ حينَ يُركَّبُ في البوّابةِ (يُعيدُ استخدامَ هذا التجمُّعِ نفسِه،
   * `apps/gateway/src/admin/mount.ts` يستقبلُ `sql` ولا يُنشئُ تجمُّعاً).
   *
   * **5 مقيسٌ لا مُفترَض** (`LOAD-01` · الدفعةُ العاشرةُ): جُرِّبَ 6 مرشّحًا ملتزَمًا (`d3c4b90d`) فاجتازَ
   * 250 وفشلَ قبولُ 500 على G1 (96.81%)، ولم ترتفعِ الإنتاجيّةُ (~21 سيناريو/ث في الحالتين) بل انتقلَ
   * الطابورُ من HTTP إلى مستنزِفِ تيليجرام — فلم يُعتمَد (`BATCH-10-LOAD01-ACCEPT500.md`).
   */
  gatewayRequest: 5,
  /**
   * `LOAD-01 · P4` · `ADR 0289` — اتّصالُ شوطِ البثِّ الفوريِّ (المُرسِلُ لكلِّ مدينةٍ). الشوطُ
   * تسلسليٌّ لا يحملُ أكثرَ من استعلامٍ في آنٍ، فاتّصالٌ واحدٌ يسعُه كاملاً؛ وعلى تجمُّعِ الطلبِ
   * كانَ كلُّ استعلامٍ من ~4 لكلِّ طلبٍ ينتظرُ اتّصالاً خلفَ حركةِ الطلبِ (قيسَ `select 1`
   * 11–28ms عبرَه مقابلَ 1.4–2.4ms مباشرةً) فوقفت طاقتُه عندَ ~14 طلباً جديداً/ث دونَ وصولٍ
   * ~16–17/ث وانتظرَ الطلبُ ~35ث قبلَ أوّلِ معالجةٍ (`b9-trace500`). **يرفعُ الطلبَ المحسوبَ
   * اتّصالاً واحداً**؛ ومقارنتُه بخطّةِ القاعدةِ قرارُ سعةٍ يملكُه المالكُ (`ADR 0073`).
   */
  gatewayDispatch: 1,
  /** تجمُّعُ استعلاماتِ المهامِّ الدوريّةِ في عمليةِ العاملِ. */
  workerJobs: 5,
  /**
   * تجمُّعُ الأقفالِ الاستشاريّةِ. **مشتقٌّ من التَّوازي لا مكتوبٌ**: مهمّةٌ جاريةٌ
   * تحتجزُ اتّصالَها خاملاً طولَ عملِها، فتجمُّعٌ أضيقُ من التَّوازي يعني مهمّةً
   * تنتظرُ اتّصالاً لا يتحرّرُ إلّا بانتهاءِ أُختِها — والزائدُ واحدٌ متنفَّسٌ.
   */
  workerLocks: JOB_CONCURRENCY + 1,
  /**
   * تجمُّعُ خدمةِ اللوحةِ. أضيقُ عمداً في المعنى لا في الرقمِ: مشغّلونَ معدودونَ
   * لا آلافُ راكبين، وسقفٌ واسعٌ ههنا يعني تقريراً ثقيلاً واحداً يستهلكُ حصّةَ
   * البوّابةِ — أيْ إعادةُ العطلِ الذي فُصِلَت اللوحةُ لمنعِهِ من الطرفِ الآخر.
   */
  adminRequest: 5,
  /**
   * مُتحقِّقُ استعادةِ النسخةِ الاحتياطيّةِ. **عابرٌ لا دائمٌ**: يُفتَحُ لبصمةٍ
   * واحدةٍ ثمّ يُغلَقُ، فلا يدخلُ ميزانيّةَ الحالةِ المستقرّةِ — ويُعلَنُ مع ذلكَ
   * لأنّ تجمُّعاً لا يُعلَنُ لا يُحاسَبُ يومَ يُنسى إغلاقُه.
   */
  restoreVerifier: 1,
});

/**
 * **مهلةُ الاستعلامِ لكلِّ دورٍ** (`F11-04` · `ADR 0197`) — تُمرَّرُ إلى `createSql` بـ`queryDeadlineMs`،
 * ويُلزِمُ `scripts/check-connection-budget.ts` كلَّ موضعِ إنشاءٍ دورُه ذو مهلةٍ بتمريرِها من ههنا.
 *
 * بلا مهلةٍ، بطءٌ على جدولٍ واحدٍ يحتجزُ اتّصالاتِ التجمُّعِ كلَّها فيقفُ مسارٌ لا صلةَ له به طولَ
 * البطءِ (مقيسٌ: 3805ms من بطءٍ 4000ms). والمهلةُ من **العميلِ** لأنَّ Supavisor يُهمِلُ
 * `statement_timeout` مُعامِلَ إقلاعٍ، ودورُ `postgres` الذي نتّصلُ به مهلتُه على الخادمِ `2min`.
 *
 * و**8000ms لمسارِ الطلبِ** ليست رقماً مُخترَعاً: هيَ حدُّ Supabase نفسِه لأدوارِ مسارِ الطلبِ
 * (`authenticated` و`authenticator`: `statement_timeout=8s`، مقروءةً من `pg_roles` على قاعدةِ الاختبارِ).
 * ولا يُدَّعى أنّها أطولُ من كلِّ استعلامٍ مشروعٍ تحتَ الحملِ — ذاكَ قياسُ `F10-*`.
 *
 * و`null` قرارٌ مكتوبٌ لا إغفالٌ: تجمُّعاتُ العاملِ مهامُّ دفعيّةٌ يطولُ بعضُها مشروعاً (تطهيرٌ ·
 * تجميعٌ)، وتجمُّعُ القفلِ يحملُ جلسةً طولَ المهمّةِ، والتحقُّقُ من الاستعادةِ يقرأُ نسخةً كاملةً؛
 * ومهلةُ مسارِ الطلبِ عليها تُلغي عملاً صحيحاً. ولا مستخدمَ ينتظرُها فلا انهيارَ متتالياً على مسارِه.
 */
export const DB_QUERY_DEADLINE_MS = Object.freeze({
  gatewayRequest: 8_000,
  // استعلاماتُ الشوطِ هي استعلاماتُ مسارِ الطلبِ نفسُها (`broadcastOffers`) فمهلتُها مهلتُه.
  gatewayDispatch: 8_000,
  workerJobs: null,
  workerLocks: null,
  adminRequest: 8_000,
  restoreVerifier: null,
} as const satisfies Readonly<Record<DbPoolRole, number | null>>);

/**
 * التجمُّعاتُ العابرةُ — تُعلَنُ ولا تُجمَعُ في الحالةِ المستقرّةِ. وفصلُها **قرارٌ
 * مكتوبٌ لا حذفٌ**: الفرقُ بينَ اتّصالٍ مفتوحٍ دائماً واتّصالٍ يُفتَحُ لثوانٍ فرقٌ
 * في الطبيعةِ لا في الحجمِ، وجمعُهما في رقمٍ واحدٍ يُضخِّمُ الطلبَ فيُقرأُ خطأً.
 */
export const TRANSIENT_POOL_ROLES: readonly DbPoolRole[] = ["restoreVerifier"];

/**
 * السقفُ الافتراضيُّ في `createSql` حينَ لا يُمرَّرُ `max`. **وهو سقفُ البوّابةِ
 * بعينِه لا رقمٌ ثانٍ يُصادفُ أن يُساويَه**: البوّابةُ هي المُستدعي الإنتاجيُّ الذي
 * يُغفلُ `max` (`apps/gateway/src/container.ts`)، فافتراضيٌّ مستقلٌّ عنها كان
 * يعني سقفَ إنتاجٍ **غيرَ مُعلَنٍ في الميزانيّةِ** — وهو حرفُ العيبِ المُعالَجِ.
 */
export const DEFAULT_DB_POOL_MAX: number = DB_POOL_MAX.gatewayRequest;

/** عمليّاتُ الإنتاجِ التي تحملُ تجمُّعاً. قائمةٌ مغلقةٌ كذلك. */
export const BUDGETED_PROCESSES = ["gateway", "worker", "admin"] as const;

export type BudgetedProcess = (typeof BUDGETED_PROCESSES)[number];

/** أيُّ عمليةٍ تحملُ أيَّ دورٍ في الحالةِ المستقرّةِ. */
const STEADY_STATE_POOLS: Readonly<Record<BudgetedProcess, readonly DbPoolRole[]>> = Object.freeze({
  gateway: ["gatewayRequest", "gatewayDispatch"],
  worker: ["workerJobs", "workerLocks"],
  admin: ["adminRequest"],
});

/**
 * طوبولوجيا التشغيلِ كما تُقاسُ عليها الميزانيّةُ. **حقولٌ مُعلَنةٌ لا مُستنتَجةٌ**
 * (ADR 0051 §٢-ب): لا يُقرأُ عددُ النسخِ من مخزنِ الجلساتِ ولا من أيِّ إشارةٍ بديلةٍ.
 */
export interface ConnectionTopology {
  readonly gatewayInstances: number;
  readonly workerInstances: number;
  readonly adminInstances: number;
  /**
   * `RUN_WORKER_IN_GATEWAY` — تُقرأُ ههنا لأثرِها في الميزانيّةِ وحدَه: صحيحةً
   * تعني أنّ **كلَّ** عمليةِ بوّابةٍ تحملُ تجمُّعَي العاملِ فوقَ تجمُّعِها.
   */
  readonly workerRunsInGateway: boolean;
  /**
   * `RUN_ADMIN_IN_GATEWAY` — صحيحةً تعني أنّ كلَّ عمليةِ بوّابةٍ تحملُ تجمُّعَ اللوحةِ
   * فوقَ تجمُّعِها (2026-10-02: الخطّةُ المجّانيّةُ ⇒ عمليةٌ واحدةٌ تحملُ الثلاثةَ).
   */
  readonly adminRunsInGateway: boolean;
}

/**
 * الطوبولوجيا المُعلَنةُ في مانيفستِ النشرِ. **تُقارَنُ بالمانيفستِ في الحاجزِ
 * تكافؤاً في الاتّجاهَين**: إعلانانِ عن شيءٍ واحدٍ في موضعَين، وتنافرُهما أسوأُ من
 * خطأِ أحدِهما لأنّ كلَّ قارئٍ يُصدِّقُ ما تحتَ يدِه.
 */
export const DECLARED_TOPOLOGY: ConnectionTopology = Object.freeze({
  // 2026-10-02: render.yaml صارَ يُطابقُ المنشورَ — بوّابةٌ واحدةٌ مجّانيّةٌ تحملُ
  // العاملَ واللوحةَ، ولا خدمةَ عاملٍ ولا خدمةَ لوحةٍ مستقلّتَين.
  gatewayInstances: 1,
  workerInstances: 0,
  adminInstances: 0,
  workerRunsInGateway: true,
  adminRunsInGateway: true,
});

/** صفٌّ في تفصيلِ الميزانيّةِ — عمليةٌ واحدةٌ بأدوارِها. */
export interface ConnectionBudgetRow {
  readonly process: BudgetedProcess;
  readonly instances: number;
  /** الأدوارُ المحمولةُ في **كلِّ** عمليةٍ من هذا النوعِ. */
  readonly roles: readonly DbPoolRole[];
  /** مجموعُ سقوفِ أدوارِ العمليةِ الواحدةِ. */
  readonly perInstance: number;
  /** `perInstance × instances`. */
  readonly subtotal: number;
}

export interface ConnectionBudget {
  readonly topology: ConnectionTopology;
  readonly rows: readonly ConnectionBudgetRow[];
  /** مجموعُ اتّصالاتِ الحالةِ المستقرّةِ. */
  readonly steadyStateTotal: number;
  /** سقوفُ التجمُّعاتِ العابرةِ — تُعلَنُ ولا تُجمَعُ. */
  readonly transientPeak: number;
  /** الصيغةُ **محسوبةً** من الثوابتِ، للسجلِّ والوثائقِ. */
  readonly formula: string;
}

function sumRoles(roles: readonly DbPoolRole[]): number {
  return roles.reduce((total, role) => total + DB_POOL_MAX[role], 0);
}

/**
 * يحسبُ ميزانيّةَ الاتّصالاتِ لطوبولوجيا مُعطاةٍ.
 *
 * ويرمي على عددِ نسخٍ سالبٍ أو غيرِ صحيحٍ: ميزانيّةٌ محسوبةٌ على مُدخلٍ لا معنى له
 * أسوأُ من غيابِها، لأنّها تُقرأُ رقماً.
 */
export function computeConnectionBudget(topology: ConnectionTopology): ConnectionBudget {
  const counts: Readonly<Record<BudgetedProcess, number>> = {
    gateway: topology.gatewayInstances,
    worker: topology.workerInstances,
    admin: topology.adminInstances,
  };

  for (const process of BUDGETED_PROCESSES) {
    const value = counts[process];
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(
        `عددُ نسخِ «${process}» يجبُ أن يكونَ عدداً صحيحاً غيرَ سالبٍ — القيمةُ: ${String(value)}`,
      );
    }
  }

  const rows = BUDGETED_PROCESSES.map((process): ConnectionBudgetRow => {
    const roles: readonly DbPoolRole[] =
      process === "gateway"
        ? [
            ...STEADY_STATE_POOLS.gateway,
            ...(topology.workerRunsInGateway ? STEADY_STATE_POOLS.worker : []),
            ...(topology.adminRunsInGateway ? STEADY_STATE_POOLS.admin : []),
          ]
        : STEADY_STATE_POOLS[process];
    const perInstance = sumRoles(roles);
    return {
      process,
      instances: counts[process],
      roles,
      perInstance,
      subtotal: perInstance * counts[process],
    };
  });

  const steadyStateTotal = rows.reduce((total, row) => total + row.subtotal, 0);
  const transientPeak = sumRoles(TRANSIENT_POOL_ROLES);
  const formula = rows
    .map((row) => `${row.perInstance}×${row.process}(${row.instances})`)
    .join(" + ");

  return { topology, rows, steadyStateTotal, transientPeak, formula };
}

/**
 * سطرٌ واحدٌ يُسجَّلُ عندَ الإقلاعِ. **الغرضُ أن يُقرأَ الطلبُ من السجلِّ لا أن
 * يُحسَبَ بيدٍ يومَ تضيقُ القاعدةُ** — وحينَها يكونُ أسوأُ ما يُواجَهُ به العطلُ
 * تخميناً لعددِ الاتّصالاتِ التي تفتحُها المنظومةُ عن نفسِها.
 */
export function describeConnectionBudget(budget: ConnectionBudget): string {
  return (
    `${budget.formula} = ${budget.steadyStateTotal} اتّصالاً في الحالةِ المستقرّةِ` +
    ` (+${budget.transientPeak} عابرٌ عندَ التحقُّقِ من الاستعادةِ)`
  );
}
