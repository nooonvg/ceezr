# مراقبُ البوّابة — `OPS-ALERT-01`

**لماذا:** يومَ 2026-10-04 انقطعَت البوّابةُ عن القاعدةِ 81 دقيقةً (02:23–03:44 UTC) ولم يصل أيُّ تنبيه:
`gateway-keep-alive.yml` لم يُشغِّله GitHub بينَ 01:59 و04:07 UTC، و`/health` لا يقرأُ القاعدة.
الدليل: `docs/evidence/reconciliation-2026-10-04/incident-db-auth-0223.md`.

**ما هو:** دالّةُ Supabase Edge (`gateway-watchdog`) يستدعيها `pg_cron` كلَّ دقيقة. تفحصُ `/ready`
(مهلةُ 25 ث)، وتحفظُ الحالةَ في مخطَّطِ `ops` المعزول، وتُنبِّهُ عبرَ Telegram والبريد (Brevo).
مستقلٌّ عن Render وعن جدولةِ GitHub. والفحصُ كلَّ دقيقةٍ يُبقي البوّابةَ المجانيّةَ مستيقظةً أيضاً.

| الحالة | متى تُعلَن | Telegram | البريد |
|---|---|---|---|
| متوقّفة | فحصانِ فاشلانِ متتاليانِ (لا ردّ، أو HTTP ≠ 200، أو `failedChecks`) | فوراً ثمّ **كلَّ دقيقة** | فوراً ثمّ كلَّ 10 دقائق |
| موقوفة من Render (`OPS-ALERT-02`) | متوقّفة، والردُّ 503 بصفحةٍ عنوانُها `Service Suspended` (إيقافُ فوترةٍ أو حصّة، لا يزولُ وحدَه) | فوراً ثمّ **كلَّ ساعة** | فوراً ثمّ كلَّ 6 ساعات |
| متدهورة | `status` ≠ `ready` مدّةَ 10 دقائقَ متّصلة | كلَّ 10 دقائق | كلَّ ساعة |
| عادت | أوّلُ فحصٍ سليمٍ بعدَ توقّف | رسالةُ عودةٍ بمدّةِ التوقّف | رسالةُ عودة |
| نبضةٌ يوميّة | 09:00 بتوقيتِ الرياض | «المراقب يعمل» | — |

العتباتُ في `ops.watchdog_config` وتُعدَّلُ بلا نشر.

## حالةُ النشر — 2026-10-13

- المنشورُ: **الإصدار 5** (`ACTIVE`، `verify_jwt = true`) من `df81182e` (#552، `OPS-ALERT-02`)، و`index.ts` و`classify.ts` مطابقان حرفيًّا.
  الدليل: `docs/evidence/production/OPS-ALERT-02-watchdog-suspended-cadence-20261013.md`.

## حالةُ النشر والتحقّق (2026-10-04)

- المنشورُ على Supabase: **الإصدار 4** (`ACTIVE`) — مطابقٌ حرفيّاً للالتزامِ `bedff13b` (يقصُّ الفراغَ من الأسرار).
- الأسرارُ الثلاثةُ في Vault: `alert_telegram_bot_token` و`alert_email_webhook_url` و`alert_email_webhook_secret`
  (فُحِصَ وجودُها وشكلُها بفحوصٍ منطقيّةٍ دونَ قراءةِ القيم). رابطُ Apps Script كانَ يحملُ `\r\n` زائداً فقُصَّ في Vault.
- **رسالةُ اختبارٍ واحدة** في 06:10:04 UTC: السجلُّ `tg:ok email:ok(gas)`، و**أكّدَ المالكُ وصولَها** إلى Telegram
  وإلى صندوقَي البريدِ المعتمدَين.
- المستلِمُ الثالثُ لم يصله البريد، ف**استُبعِدَ بقرارِ المالكِ** (09:29 بتوقيتِ الرياض) من `ops.watchdog_config.email_to`؛
  المعتمدون الآن: Telegram معرِّفٌ واحد، والبريدُ عنوانان. لم يُبحَث سببُ عدمِ الوصول بقرارِ المالك.
- النبضةُ اليوميّةُ (06:00 UTC) أُرسِلَت أوّلَ مرّةٍ في 06:00:09 UTC (`tg:ok`).
- فحصُ السجلّاتِ (`ops.watchdog_events` و`net._http_response` و`cron.job_run_details` وسجلّاتُ Supabase) بمطابقةٍ
  مع قيمِ الأسرارِ دونَ طباعتها: **صفرُ ظهور**.
- لم تُجرَ تجربةُ توقّفٍ حقيقيّةٌ بعدَ تفعيلِ القنوات؛ آخرُ محاكاةٍ (404) كانت قبلَ التفعيل (04:17 UTC).

## الملفّات

- `functions/gateway-watchdog/index.ts` — الدالّة (`deno check` نظيف).
- `functions/gateway-watchdog/classify.ts` — تصنيفُ سببِ التوقّفِ وإيقاعُ تكرارِه (منطقٌ خالص، `tests/unit/watchdog-suspended-cadence.test.ts`). يُرفَعُ معَ `index.ts` في كلِّ نشر.
- `setup.sql` — الامتدادات والجداولُ والجدولة (يُعادُ تشغيلُه بأمان). **ليسَ هجرةَ تطبيق**: `pg_cron` و`pg_net`
  غيرُ موجودَين في PostgreSQL الذي يُشغِّلُه CI، والمراقبُ ليسَ جزءاً من مخطَّطِ التطبيق.

## الأسرارُ والمستلِمون (لا شيءَ منها في المستودَع — المستودَعُ عامّ)

- `ALERT_TELEGRAM_BOT_TOKEN` و`BREVO_API_KEY`: في Supabase ← Edge Functions ← Secrets، أو في Vault
  بالاسمَين `alert_telegram_bot_token` و`brevo_api_key`.
- المستلِمونَ والمُرسِل: أعمدةُ `telegram_chat_ids` و`email_to` و`email_from` في `ops.watchdog_config`.
- بوتُ التنبيهِ لا يُرسِلُ لمن لم يضغط «Start» عندَه.

## التشغيلُ والتحقّق

```sql
select * from ops.watchdog_state;                                   -- الحالةُ الحاليّة
select * from ops.watchdog_events order by id desc limit 20;        -- التحوّلاتُ والتنبيهات
update ops.watchdog_config set test_pending = true;                 -- رسالةُ تجربةٍ في الدقيقةِ التالية
update ops.watchdog_config set enabled = false;                     -- إيقافٌ مؤقّت
select cron.unschedule('ops-gateway-watchdog');                     -- إزالةُ الجدولة
```

## حدود

- إن تعطّل Supabase نفسُه فلن يُنبِّهَ هذا المراقب؛ يبقى `gateway-keep-alive.yml` شبكةً ثانيةً (GitHub يُراسِلُ
  صاحبَ المستودَعِ عندَ فشلِ الـworkflow).
- النبضةُ اليوميّةُ هي ما يُثبتُ أنّ المراقبَ حيّ: غيابُها يومًا كاملًا يعني أنّه هو المعطَّل.
