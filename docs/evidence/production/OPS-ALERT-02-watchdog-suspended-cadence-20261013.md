# OPS-ALERT-02 — تنبيهُ إيقافِ Render كلَّ ساعةٍ لا كلَّ دقيقة (2026-10-13)

بنودُ الخارطة: `WR-27`. المكوّن: `deploy/watchdog/functions/gateway-watchdog` (Supabase Edge، `OPS-ALERT-01`).

## المشكلة المقيسة [إ]

- Render أوقفَ `waslah-gateway` و`waslah-miniapp` في 12:24:59Z بسببِ `billing` (تجاوزُ حصّةِ البياناتِ الشهريّة، `OPS-EGRESS-01`).
  قراءةُ `list_services` في 17:15Z: الخدماتُ الثلاثُ `suspended`، والموقِفُ `billing` (وstaging `user` + `billing`).
- `/ready` يُعيدُ HTTP 503 بصفحةِ HTML عنوانُها `Service Suspended`.
- المراقبُ يعاملُها توقّفًا عاديًّا، فيُرسلُ Telegram كلَّ دقيقةٍ (`down_tg_every_s = 60`) ويلصقُ أوّلَ 200 حرفٍ من HTML في الرسالة.
- `ops.watchdog_events` من 12:26:01Z إلى 17:17:01Z: انتقالٌ واحدٌ `up->down` و**292 تنبيهًا**.
- الإيقافُ لا يزولُ إلّا بوسيلةِ دفعٍ أو بدايةِ الشهر (نحوُ 18 يومًا): قرابةُ 25,920 رسالةً بالإيقاعِ القديم.

## الإصلاح [ش] [ا]

- `classify.ts` (منطقٌ خالص): 503 + `<title>Service Suspended</title>` = `suspended`. وكلُّ ما سواه `other`، ومنه 503 JSON من التطبيقِ نفسِه.
- `suspended`: تنبيهٌ فوريٌّ عندَ الانتقال، ثمّ كلَّ ساعةٍ في Telegram وكلَّ ستِّ ساعاتٍ في البريد. ونصٌّ يقولُ إنّ الخدمةَ لا تعودُ وحدَها
  وإنّ الإجراءَ في لوحةِ Render. والتفصيلُ `HTTP 503 Render: Service Suspended` بلا HTML.
- `other`: بلا تغيير، على `ops.watchdog_config`. ورسالةُ العودةِ فوريّةٌ كما كانت.
- لا هجرة، ولا تغييرَ في مخطّطِ `ops` ولا في إعدادِه.

الفحوص المحلّيّة:
- `bun test tests/unit/watchdog-suspended-cadence.test.ts`: 9/9.
- `deno check index.ts` (Deno 2.9.6، `npm:postgres@3.4.4`): نظيف.

## قبلَ النشر [إ]

- المنشورُ: `gateway-watchdog` الإصدار 4، `ACTIVE`، و`verify_jwt = true`. محتواه **مطابقٌ حرفيًّا** لـ`index.ts` في `main` = `3e41cf77`
  (قراءةُ `get_edge_function` ومقارنةُ `diff`).

## ما لم يُقَس

- لم تُجرَ تجربةُ توقّفٍ عاديٍّ بعدَ التعديل؛ مسارُ `other` لم يتغيّر واختبارُه آليٌّ فقط.
- رسالةُ العودةِ بعدَ الإيقافِ لم تُرَ، فالخدماتُ ما زالت موقوفة.
