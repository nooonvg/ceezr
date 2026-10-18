/**
 * S5 (ADR 0288 §ملحق 2026-10-18) — مُرسِلُ ردودِ الحوارِ الفوريُّ غيرُ الحاجبِ لمسارِ الوظيفةِ.
 *
 * **المقيسُ الذي أوجبَه (`r11-wave-500`):** الوظيفةُ كانت تُختَمُ `done` قبلَ الإرسالِ (S5)،
 * لكنَّ مسارَ المستنزفِ كانَ **ينتظرُ** إرسالَ الردِّ قبلَ أن يلتقطَ التاليةَ؛ فصارَ معدّلُ
 * إتمامِ الوظائفِ معدّلَ دلوِ البوتِ (25/ث يتقاسمُه معَ إشعاراتِ العروضِ): زمنُ إتمامِ وظيفةِ
 * إثباتِ الهاتفِ صعدَ دقيقةً بدقيقةٍ 22ث → 34ث → 50ث → 62ث، وتجاوزَ مهلةَ المولّدِ (20ث)
 * في 4,344 من 4,738 تسجيلًا ⇒ G1 = 7.98%.
 *
 * **العقدُ:**
 * - `submit(laneKey, run)` يعودُ فورًا؛ مسارُ الوظيفةِ لا ينتظرُ تيليجرامَ.
 * - ردودُ المستخدمِ الواحدِ (`laneKey` = البوت+المستخدم) تُرسَلُ بالتسلسلِ وبترتيبِ الإيداعِ.
 * - `concurrency` مستخدمًا مختلفًا في آنٍ — الدلوُ (25/ث عالميًّا و1/ث للمحادثةِ) هو الحاكمُ
 *   لا هذا الرقمُ، ولم يُمَسَّ.
 * - طابورٌ محدودٌ (`maxQueued`): الامتلاءُ يعيدُ `false` فينتظرُ المستدعي الإرسالَ بنفسِه —
 *   ضغطٌ خلفيٌّ صريحٌ لا ذاكرةٌ بلا سقفٍ.
 * - **لا إرسالَ بعدَ نصفِ الإيجارِ:** ردٌّ انتظرَ أكثرَ من `maxWaitMs` لا يُرسَلُ هنا، ومعه كلُّ
 *   ما بعدَه للمستخدمِ نفسِه (حفظًا للترتيبِ)؛ يبقى صفُّه `sending` فينقضي إيجارُه ويلتقطُه
 *   المُرسِلُ الخلفيُّ (`claim_telegram_update_replies` يحجبُ اللاحقَ ما دامَ سابقُه معلّقًا).
 *   فلا يتسابقُ مُرسِلانِ على ردٍّ واحدٍ.
 */

export interface TelegramReplyPool {
  /** يعيدُ `true` إن قُبلَ الردُّ في الطابورِ، و`false` إن امتلأ (فيُرسِلُ المستدعي بنفسِه). */
  submit(laneKey: string, run: () => Promise<unknown>): boolean;
  stats(): {
    readonly queued: number;
    readonly running: number;
    readonly expiredLocal: number;
    readonly sent: number;
  };
  /** ينتظرُ فراغَ الطابورِ (إيقافٌ نظيفٌ، واختبارات). */
  idle(): Promise<void>;
}

export interface TelegramReplyPoolOptions {
  readonly concurrency: number;
  readonly maxQueued: number;
  /** أقلُّ من إيجارِ الردِّ (`TELEGRAM_REPLY_LEASE_SECONDS`) بهامشِ زمنِ إرسالٍ. */
  readonly maxWaitMs: number;
  readonly now?: () => number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

interface Item {
  readonly run: () => Promise<unknown>;
  readonly at: number;
}

export function createTelegramReplyPool(options: TelegramReplyPoolOptions): TelegramReplyPool {
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, Math.trunc(options.concurrency));
  const lanes = new Map<string, Item[]>();
  const ready: string[] = [];
  const running = new Set<string>();
  let queued = 0;
  let expiredLocal = 0;
  let sent = 0;
  let waiters: (() => void)[] = [];

  const settleIdle = (): void => {
    if (queued > 0 || running.size > 0) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const pump = (): void => {
    while (running.size < concurrency && ready.length > 0) {
      const lane = ready.shift() as string;
      const items = lanes.get(lane);
      if (items === undefined || items.length === 0) {
        lanes.delete(lane);
        continue;
      }
      const item = items.shift() as Item;
      queued -= 1;
      if (now() - item.at > options.maxWaitMs) {
        // يُتركُ هذا وكلُّ لاحقِه للمستخدمِ نفسِه للمُرسِلِ الخلفيِّ — الترتيبُ لا يُكسَرُ.
        const dropped = 1 + items.length;
        queued -= items.length;
        expiredLocal += dropped;
        lanes.delete(lane);
        options.log?.("telegram.replies.local_expired", { lane, dropped });
        continue;
      }
      running.add(lane);
      void item
        .run()
        .then(
          () => {
            sent += 1;
          },
          (error: unknown) =>
            options.log?.("telegram.replies.local_failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
        )
        .finally(() => {
          running.delete(lane);
          const rest = lanes.get(lane);
          if (rest !== undefined && rest.length > 0) ready.push(lane);
          else lanes.delete(lane);
          pump();
          settleIdle();
        });
    }
    settleIdle();
  };

  return {
    submit: (laneKey, run) => {
      if (queued >= options.maxQueued) return false;
      const items = lanes.get(laneKey);
      if (items === undefined) {
        lanes.set(laneKey, [{ run, at: now() }]);
        if (!running.has(laneKey)) ready.push(laneKey);
      } else {
        items.push({ run, at: now() });
        if (items.length === 1 && !running.has(laneKey)) ready.push(laneKey);
      }
      queued += 1;
      pump();
      return true;
    },
    stats: () => ({ queued, running: running.size, expiredLocal, sent }),
    idle: () =>
      queued === 0 && running.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          }),
  };
}
