/**
 * الغرض: تركيبُ تبعيّاتِ **عمليةِ لوحةِ الإدارةِ المستقلّةِ** — قاعدةٌ، ومنفذُ
 *   تصريحٍ، وناقلُ أحداثٍ يعبرُ حدودَ العمليّاتِ، وقناةُ رمزِ دخولٍ، ونمطُ خريطةٍ.
 *   حاويةٌ **ضيّقةٌ بالقصدِ**: لا بوتَ حوارٍ، ولا طابورَ تحديثاتٍ، ولا صندوقَ
 *   صادرٍ، ولا مهمّةً دوريّةً.
 * الحالة: منفّذ فعلياً — `F5-08` / `ARCH-011` · ADR 0064.
 * ينتمي إلى: apps/admin
 * يستخدمه: apps/admin/src/index.ts · tests/integration/admin-service-separation.test.ts
 *
 * ## ولمَ حاويةٌ ثانيةٌ لا `buildContainer` نفسُها بأعلامٍ
 *
 * لأنّ حاويةَ البوّابةِ تبني — بالضرورةِ لا بالسهوِ — بوتَي حوارٍ، ومُرسِلَينِ
 * بصمودٍ خارجيٍّ، ومخزنَي جلسةٍ، وطابورَ تحديثاتٍ، ودرينراً، ومنفذَ صادرٍ.
 * وعمليةُ اللوحةِ لا تستقبلُ تحديثاً واحداً من تلغرام، فبناءُ ذلك كلِّهِ فيها
 * يعني: اتّصالاتٌ تُفتَحُ ولا تُستخدَم، ومؤقّتاتٌ تدورُ بلا عملٍ، **وسطحُ عطلٍ
 * يُقلعُ عليهِ ما لا يحتاجُهُ** — أي نقضٌ لغرضِ الفصلِ في أوّلِ سطرٍ منه.
 *
 * والحدُّ المُعلَنُ: اللوحةُ تقرأُ من القاعدةِ وتكتبُ فيها بـRPC، وكلُّ حالةِ
 * تصريحِها في القاعدةِ (جلسةٌ بجدولٍ، ورمزُ CSRF مُشتقٌّ من بصمةِ الجلسةِ لا
 * مُخزَّنٌ). فلا حالةَ تُنقَلُ ولا هجرةَ تُكتَبُ لأجلِ هذا الفصلِ — وهو ما يجعلُهُ
 * ممكناً أصلاً، وهو نتيجةُ `ARCH-005` مُحصَّلةً لا مصادفةً.
 */

import type { SupportResolutionPort } from "../../../packages/application/dispute/resolve-dispute.ts";
import type { SessionRevocationStore } from "../../../packages/application/identity/ports.ts";
import type { RatingFlagPort } from "../../../packages/application/reputation/index.ts";
import type { TrackingTokenRpcPort } from "../../../packages/application/tracking/tracking-token-ports.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import { createSupportResolutionPort } from "../../../packages/infrastructure/dispute/support-adapters.ts";
import { createRedisSessionRevocationStore } from "../../../packages/infrastructure/identity/redis-session-revocation-store.ts";
import { createTelegramApi } from "../../../packages/infrastructure/notification/telegram-client.ts";
import { createUpstashRedis } from "../../../packages/infrastructure/redis/upstash.ts";
import { createRatingFlagPort } from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import {
  createTrackingEventBus,
  type TrackingEventBus,
} from "../../../packages/infrastructure/tracking/event-bus.ts";
import {
  createRedisStreamTrackingEventBus,
  DEFAULT_POLL_MS,
  TRACKING_EVENT_STREAM_KEY,
} from "../../../packages/infrastructure/tracking/redis-stream-event-bus.ts";
import { createTrackingTokenRpc } from "../../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import { type ResolvedMapStyle, resolveMapStyle } from "../../../packages/maps/index.ts";
import {
  DB_POOL_MAX,
  DB_QUERY_DEADLINE_MS,
} from "../../../packages/shared/config/connection-budget.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import type { AdminAuthPort, AdminCodeSender } from "../../gateway/src/admin/auth.ts";
import { createAdminAuthPort } from "../../gateway/src/admin/auth.ts";

export interface AdminContainer {
  readonly sql: Sql;
  readonly auth: AdminAuthPort;
  readonly bus: TrackingEventBus;
  readonly codeSender: AdminCodeSender;
  readonly mapStyle: ResolvedMapStyle | null;
  readonly mapOrigins: readonly string[];
  readonly maplibreSri: string | null;
  /** `true` إن كان الناقلُ مغلَّفاً بـRedis Streams — يُسجَّلُ عندَ الإقلاع. */
  readonly busCrossesProcesses: boolean;
  /**
   * مخزنُ إبطالِ جلساتِ Mini App (`SEC-18-ب`). `null` حينَ لا Redis — وحينَها
   * مسلكُ الإبطالِ يردُّ ٥٠٣، فلا يُسجَّلُ قرارٌ بلا إنفاذٍ.
   */
  readonly sessionRevocation: SessionRevocationStore | null;
  /**
   * `F16-03` — منفذُ رموزِ التتبُّعِ لقطعِ الروابطِ منَ اللوحةِ. `null` يعني
   * إغلاقَ المسلكِ بردِّ ٥٠٣ لا صمتَهُ.
   */
  readonly trackingTokens: TrackingTokenRpcPort | null;
  /**
   * `F16-02` — منفذُ الإقفالِ الإداريِّ للتذاكرِ من صفحةِ النزاعاتِ. `null` يعني
   * إغلاقَ المسلكِ بردِّ ٥٠٣ لا صمتَهُ — حاويةٌ بلا قاعدةٍ لا تُقفِلُ شيئاً.
   */
  readonly disputeResolutions: SupportResolutionPort | null;
  /**
   * `F16-01` — منفذُ تعليمِ التقييمِ المسيءِ لصفحةِ التقييماتِ: **`null` يعني إغلاقَ
   * المسلكِ بردِّ ٥٠٣ لا صمتهُ** — حاويةٌ بلا قاعدةٍ (اختبارٌ) لا تعلِّمُ شيئًا.
   */
  readonly ratingFlags: RatingFlagPort | null;
  readonly close: () => Promise<void>;
}

export interface AdminContainerOverrides {
  readonly sql?: Sql;
  readonly codeSender?: AdminCodeSender;
}

export function buildAdminContainer(
  config: AppConfig,
  overrides: AdminContainerOverrides = {},
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
): AdminContainer {
  /**
   * سقفُ اتّصالاتِ القاعدةِ لعمليةِ اللوحةِ — دورٌ مستقلٌّ في الميزانيّةِ لا حصّةٌ من
   * سقفِ البوّابةِ. ومحدودٌ عن قصدٍ: هذه العمليةُ يستخدمها **مشغّلونَ
   * معدودون** لا آلافُ راكبين، وسقفٌ واسعٌ ههنا يعني أنّ تقريراً ثقيلاً واحداً
   * يقدرُ على استهلاكِ حصّةِ القاعدةِ التي تحتاجُها البوّابةُ — أيْ إعادةُ العطلِ الذي
   * فُصِلت اللوحةُ لأجلِ منعِهِ، من الطرفِ الآخر.
   *
   * `F7-04` — **والرقمُ يُقرأُ من نموذجِ ميزانيّةِ الاتّصالاتِ لا من ثابتٍ ههنا**:
   * تجمُّعٌ لا تعرفُه الميزانيّةُ هو حرفُ ما جرى — خدمةُ اللوحةِ فُصِلَت بتجمُّعِها
   * وبقيَت صيغةُ `5N + 10M` لا تراه.
   */
  const sql =
    overrides.sql ??
    createSql({
      connectionString: config.databaseUrl,
      max: DB_POOL_MAX.adminRequest,
      applicationName: "ceezr:adminRequest",
      prepare: false,
      // `F11-04` · `ADR 0197`: تقريرٌ عالقٌ خلفَ قفلٍ لا يحتجزُ تجمُّعَ اللوحةِ طولَ البطءِ.
      queryDeadlineMs: DB_QUERY_DEADLINE_MS.adminRequest,
      onQueryDeadline: ({ deadlineMs }) =>
        log("db.query_deadline_exceeded", { pool: "adminRequest", deadlineMs }),
    });

  /**
   * ناقلُ الأحداثِ — **أخطرُ سطرٍ في هذا الملفِّ**.
   *
   * مجرى `/admin/api/live` يُشترِكُ في ناقلٍ، والأحداثُ تُنشَرُ في عمليةِ **البوّابةِ**
   * حيثُ يصلُ ويبهوكُ الموقعِ. فناقلٌ محلّيٌّ ههنا يعني مجرىً يفتحُ ويُنبِضُ ويُعيدُ
   * لقطةَ القاعدةِ كلَّ عشرينَ ثانيةً — **ولا دلتا لحظيّةً واحدةً تصلُهُ أبداً**.
   * وهذا عطلٌ لا يُخفِقُ فيهِ طلبٌ: الخريطةُ تعملُ، والنقاطُ تتحرّكُ (باللقطةِ)،
   * والتأخّرُ يُقرأُ «شبكةً بطيئةً» لا «قناةً مقطوعةً».
   *
   * ولذلك يُغلَّفُ بـRedis Streams متى وُجِدَ Redis (`SCL-004` · ADR 0058)، ويُسجَّلُ
   * الحالُ صريحاً عندَ الإقلاعِ. والإقلاعُ **لا يُمنَعُ** عندَ غيابِ Redis: بيئةُ
   * تطويرٍ بلا Redis تفتحُ اللوحةَ بلقطتِها وتعملُ، وإسقاطُ العمليةِ لأجلِ الدلتا
   * كان سيمنعُ فحصَ ثمانِ صفحاتٍ لا علاقةَ لها بالخريطةِ. وفي الإنتاجِ Redis
   * إلزاميٌّ أصلاً (`F5-03` · `SCL-002`)، فالحالُ الخطِرُ ممنوعٌ من موضعِهِ الصحيح.
   */
  const localBus = createTrackingEventBus((message, meta) => log(message, meta ?? {}));
  const redis =
    config.sessionStore === "redis"
      ? createUpstashRedis({ url: config.redisUrl, token: config.redisToken })
      : null;
  const distributedBus =
    redis !== null
      ? createRedisStreamTrackingEventBus({
          local: localBus,
          redis,
          streamKey: TRACKING_EVENT_STREAM_KEY,
          instanceId: crypto.randomUUID(),
          pollMs: DEFAULT_POLL_MS,
        })
      : null;
  /*
   * الإبطالُ **يقتضي مخزناً مشتركاً**: عمليةُ اللوحةِ تكتبُ العتبةَ وعمليةُ البوّابةِ
   * تقرؤها، فذاكرةُ العمليةِ لا تصلُحُ ههنا ولو صلَحَت في نسخةٍ واحدةٍ. فبلا Redis
   * لا مخزنَ — والمسلكُ يردُّ ٥٠٣ ولا يُوهِمُ بإبطالٍ لا يراهُ أحدٌ.
   */
  const sessionRevocation = redis === null ? null : createRedisSessionRevocationStore(redis);
  /** `F16-03` — منفذُ رموزِ التتبُّعِ فوقَ القاعدةِ نفسِها لا نسخةٌ ثانيةٌ. */
  const trackingTokens = createTrackingTokenRpc(sql);
  /** `F16-02` — منفذُ قراراتِ التذاكرِ فوقَ القاعدةِ نفسِها لا نسخةٌ ثانيةٌ. */
  const disputeResolutions = createSupportResolutionPort(sql);
  /** `F16-01` — منفذُ التعليمِ فوقَ القاعدةِ نفسِها لا نسخةٌ ثانيةٌ. */
  const ratingFlags = createRatingFlagPort(sql);

  if (distributedBus !== null) distributedBus.start();
  const bus: TrackingEventBus = distributedBus ?? localBus;

  /**
   * قناةُ رمزِ الدخولِ: بوتُ السائقِ يراسلُ المسؤولَ في محادثتِهِ الخاصّةِ — وهو
   * نفسُ العقدِ في البوّابةِ حرفاً (`AdminCodeSender`)، لكنّ العمليةَ ههنا لا تملكُ
   * مُرسِلَ الحاويةِ بصمودِهِ الخارجيِّ. و`Api` مباشرةً كافيةٌ: رسالةٌ واحدةٌ
   * لمشغّلٍ واحدٍ عندَ الدخولِ، لا بثٌّ يضربُ حدَّ Bot API. وفشلُ الإرسالِ يُعادُ
   * `false` لا يُرمى — لأنّ الصفحةَ تعرضُ للمشغّلِ سبباً مقروءاً، وانفجارُ العمليةِ
   * لأجلِ رسالةٍ لم تُسلَّم كان سيُسقطُ اللوحةَ لمن هو داخلُها أصلاً.
   */
  const api = createTelegramApi(config.driverBotToken);
  const codeSender: AdminCodeSender = overrides.codeSender ?? {
    send: async (telegramId, text) => {
      try {
        await api.sendMessage(telegramId, text);
        return true;
      } catch (cause) {
        log("admin.login_code.send_failed", {
          detail: cause instanceof Error ? cause.message : String(cause),
        });
        return false;
      }
    },
  };

  /**
   * نمطُ الخريطةِ يُحلَّلُ مرّةً عندَ الإقلاعِ — نفسُ حجّةِ البوّابةِ حرفاً: الضبطُ
   * ثابتٌ في عمرِ العمليةِ، وضبطٌ خاطئٌ يظهرُ في السجلِّ لحظتَهُ لا في أوّلِ زيارةٍ.
   * وضبطٌ خاطئٌ **لا يُسقطُ العمليةَ**: بقيّةُ صفحاتِ اللوحةِ تعملُ بجداولِها.
   */
  const resolved = resolveMapStyle({
    provider: config.mapProvider,
    styleUrl: config.mapStyleUrl,
    publicApiKey: config.mapTilesPublicKey,
  });
  if (!resolved.ok) {
    log("map.config.invalid", { key: resolved.error.key, detail: resolved.error.detail });
  } else if (!resolved.value.configured) {
    log("map.disabled", { reason: resolved.value.reason });
  }
  const mapStyle = resolved.ok ? resolved.value : null;
  const mapOrigins = mapStyle?.configured === true ? mapStyle.origins : [];

  return {
    sql,
    auth: createAdminAuthPort(sql),
    bus,
    codeSender,
    mapStyle,
    mapOrigins,
    maplibreSri: config.maplibreSri,
    busCrossesProcesses: distributedBus !== null,
    sessionRevocation,
    trackingTokens,
    disputeResolutions,
    ratingFlags,
    close: async () => {
      distributedBus?.stop();
      await sql.end({ timeout: 5 });
    },
  };
}
