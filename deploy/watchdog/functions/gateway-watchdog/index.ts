// gateway-watchdog — مراقبٌ خارجيٌّ لبوّابةِ وَصْلة (OPS-ALERT-01).
//
// يعملُ على Supabase Edge Functions ويُستدعى كلَّ دقيقةٍ من pg_cron. مستقلٌّ عن Render
// وعن جدولةِ GitHub Actions (التي تأخّرَت ساعاتٍ يومَ 2026-10-04). يفحصُ `/ready`، ويحفظُ
// الحالةَ في `ops.watchdog_state`، ويُنبِّهُ عبرَ Telegram والبريد بإلحاحٍ متكرّرٍ حتى يعودَ.
//
// لا سرَّ ولا بياناتٍ شخصيّةً في هذا الملفّ (المستودَعُ عامّ):
//   • الأسرارُ في Supabase ← Edge Functions ← Secrets (أو Vault بالأسماءِ الصغيرةِ نفسِها):
//       ALERT_TELEGRAM_BOT_TOKEN   (إلزاميٌّ لقناةِ Telegram)
//       BREVO_API_KEY              (إلزاميٌّ لقناةِ البريد)
//   • المستلِمونَ والعتباتُ في جدولِ `ops.watchdog_config` في القاعدة.
//   • SUPABASE_DB_URL يوفّرُه Supabase تلقائيّاً.

import postgres from "npm:postgres@3.4.4";
import { classifyDown, type DownCause, downDetail, downRepeatSeconds } from "./classify.ts";

type Health = "up" | "degraded" | "down";
interface Probe {
  health: Health;
  httpStatus: number | null;
  ms: number;
  detail: string;
  cause?: DownCause;
}
interface Config {
  target_url: string;
  telegram_chat_ids: string[];
  email_to: string[];
  email_from: string;
  fail_threshold: number;
  down_tg_every_s: number;
  down_email_every_s: number;
  degraded_grace_s: number;
  degraded_tg_every_s: number;
  degraded_email_every_s: number;
  daily_utc_hour: number;
  enabled: boolean;
  test_pending: boolean;
}
interface State {
  status: "up" | "degraded" | "down" | "unknown";
  since: string;
  consecutive_failures: number;
  last_check_at: string | null;
  last_detail: string | null;
  last_tg_at: string | null;
  last_email_at: string | null;
  alerted: boolean;
  last_daily_on: string | null;
}

const DB_URL = Deno.env.get("SUPABASE_DB_URL");
if (!DB_URL) throw new Error("SUPABASE_DB_URL is not set");
const sql = postgres(DB_URL, { max: 1, prepare: false });
// المصدرُ الأوّلُ أسرارُ الدالّة، والبديلُ Supabase Vault (`alert_telegram_bot_token` · `brevo_api_key`).
// كلُّ سرٍّ يُقصُّ من الفراغِ في طرفَيه: لصقُ قيمةٍ في Vault قد يُلحِقُ `\r\n` (رُصِدَ 2026-10-04 في رابطِ Apps Script).
const clean = (v: string | undefined | null) => (v ?? "").trim();
let TG = clean(Deno.env.get("ALERT_TELEGRAM_BOT_TOKEN"));
let BREVO = clean(Deno.env.get("BREVO_API_KEY"));
// بديلُ Brevo بلا طرفٍ ثالث: تطبيقُ Google Apps Script منشورٌ من حسابِ المالكِ يُرسِلُ بـMailApp.
let GAS_URL = clean(Deno.env.get("ALERT_EMAIL_WEBHOOK_URL"));
let GAS_SECRET = clean(Deno.env.get("ALERT_EMAIL_WEBHOOK_SECRET"));
async function loadVaultSecrets() {
  if (TG && (BREVO || (GAS_URL && GAS_SECRET))) return;
  const rows = await sql<
    { name: string; v: string }[]
  >`select name, decrypted_secret as v from vault.decrypted_secrets
    where name in ('alert_telegram_bot_token', 'brevo_api_key', 'alert_email_webhook_url', 'alert_email_webhook_secret')`;
  for (const r of rows) {
    if (r.name === "alert_telegram_bot_token" && !Deno.env.get("ALERT_TELEGRAM_BOT_TOKEN"))
      TG = clean(r.v);
    if (r.name === "brevo_api_key" && !Deno.env.get("BREVO_API_KEY")) BREVO = clean(r.v);
    if (r.name === "alert_email_webhook_url" && !Deno.env.get("ALERT_EMAIL_WEBHOOK_URL"))
      GAS_URL = clean(r.v);
    if (r.name === "alert_email_webhook_secret" && !Deno.env.get("ALERT_EMAIL_WEBHOOK_SECRET"))
      GAS_SECRET = clean(r.v);
  }
}

async function probe(url: string): Promise<Probe> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(25_000),
      headers: { "user-agent": "wasla-watchdog/1" },
    });
    const body = await r.text();
    const ms = Date.now() - t0;
    if (r.status !== 200)
      return {
        health: "down",
        httpStatus: r.status,
        ms,
        detail: downDetail(r.status, body),
        cause: classifyDown(r.status, body),
      };
    let j: { status?: string; failedChecks?: string[]; degradedChecks?: string[] } = {};
    try {
      j = JSON.parse(body);
    } catch {
      /* غيرُ JSON */
    }
    const failed = j.failedChecks ?? [];
    if (failed.length > 0)
      return { health: "down", httpStatus: 200, ms, detail: `failed: ${failed.join(",")}` };
    if (j.status && j.status !== "ready")
      return {
        health: "degraded",
        httpStatus: 200,
        ms,
        detail: `${j.status}: ${(j.degradedChecks ?? []).join(",")}`,
      };
    return { health: "up", httpStatus: 200, ms, detail: "ready" };
  } catch (e) {
    return {
      health: "down",
      httpStatus: null,
      ms: Date.now() - t0,
      detail: `no response: ${(e as Error).name} ${(e as Error).message}`.slice(0, 200),
    };
  }
}

async function sendTelegram(chatIds: string[], text: string): Promise<string> {
  if (!TG) return "tg:skipped(no token)";
  const out: string[] = [];
  for (const chat_id of chatIds) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text,
          disable_notification: false,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      out.push(r.ok ? "tg:ok" : `tg:${r.status}`);
    } catch (e) {
      out.push(`tg:err ${(e as Error).name}`);
    }
  }
  return out.join(",");
}

async function sendEmail(cfg: Config, subject: string, text: string): Promise<string> {
  if (cfg.email_to.length === 0) return "email:skipped(no recipients)";
  if (!BREVO && GAS_URL && GAS_SECRET) {
    try {
      const r = await fetch(GAS_URL, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        redirect: "follow",
        body: JSON.stringify({ secret: GAS_SECRET, to: cfg.email_to, subject, text }),
        signal: AbortSignal.timeout(20_000),
      });
      const b = (await r.text()).slice(0, 120);
      return r.ok && b.includes('"ok":true') ? "email:ok(gas)" : `email:gas ${r.status} ${b}`;
    } catch (e) {
      return `email:gas err ${(e as Error).name}`;
    }
  }
  if (!BREVO || !cfg.email_from) return "email:skipped(not configured)";
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": BREVO },
      body: JSON.stringify({
        sender: { email: cfg.email_from, name: "WASLA Watchdog" },
        to: cfg.email_to.map((email) => ({ email })),
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? "email:ok" : `email:${r.status} ${(await r.text()).slice(0, 120)}`;
  } catch (e) {
    return `email:err ${(e as Error).name}`;
  }
}

const since = (iso: string | null, now: number) =>
  iso ? (now - Date.parse(iso)) / 1000 : Infinity;
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} د`;
const riyadh = (d: Date) =>
  d.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });

Deno.serve(async () => {
  await loadVaultSecrets();
  const [cfg] = await sql<Config[]>`select * from ops.watchdog_config where id = 1`;
  if (!cfg) return Response.json({ error: "no config" }, { status: 500 });
  const [st] = await sql<State[]>`select * from ops.watchdog_state where id = 1`;
  if (!st) return Response.json({ error: "no state" }, { status: 500 });

  const nowD = new Date();
  const now = nowD.getTime();
  // رسالةُ تجربةٍ تُطلَبُ من القاعدةِ وحدَها (`update ops.watchdog_config set test_pending = true`)،
  // لا من معاملٍ في الرابط — فلا يستطيعُ حاملُ المفتاحِ العامِّ إغراقَ المستلِمين.
  if (cfg.test_pending) {
    await sql`update ops.watchdog_config set test_pending = false where id = 1`;
    const msg = `🧪 اختبار تنبيهات وَصْلة\nهذه رسالة تجربة من المراقب. الحالة المسجّلة: ${st.status}.\n${riyadh(nowD)} بتوقيت الرياض`;
    const r = [
      await sendTelegram(cfg.telegram_chat_ids, msg),
      await sendEmail(cfg, "🧪 اختبار تنبيهات وَصْلة", msg),
    ];
    await sql`insert into ops.watchdog_events (kind, detail) values ('test', ${r.join(" ")})`;
    return Response.json({ test: true, result: r });
  }
  if (!cfg.enabled) return Response.json({ skipped: "disabled" });
  if (since(st.last_check_at, now) < 40) return Response.json({ skipped: "too soon" });

  const p = await probe(cfg.target_url);
  const fails = p.health === "down" ? st.consecutive_failures + 1 : 0;
  // لا نُعلنُ «متوقّفة» إلّا بعدَ عتبةِ فشلٍ متتالٍ، تجنّباً لإنذارٍ كاذبٍ من إعادةِ تشغيلٍ لحظيّة.
  let eff: Health | "pending" =
    p.health === "down" && fails < cfg.fail_threshold ? "pending" : p.health;
  if (eff === "pending")
    eff = st.status === "down" ? "down" : ((st.status === "unknown" ? "up" : st.status) as Health);

  let status = st.status,
    sinceAt = st.since,
    alerted = st.alerted;
  let tgAt = st.last_tg_at,
    emAt = st.last_email_at;
  const sent: string[] = [];
  const target = new URL(cfg.target_url).host;

  if (eff !== status) {
    if (eff === "up" && status === "down") {
      const d = mins(since(st.since, now));
      const m = `✅ عادت بوّابة وَصْلة للعمل\nمدة التوقف: ${d}\nزمن الاستجابة: ${p.ms}ms\n${riyadh(nowD)} بتوقيت الرياض`;
      sent.push(
        await sendTelegram(cfg.telegram_chat_ids, m),
        await sendEmail(cfg, `✅ وَصْلة عادت للعمل (توقّف ${d})`, m),
      );
    } else if (eff === "up" && status === "degraded" && alerted) {
      sent.push(
        await sendTelegram(cfg.telegram_chat_ids, `✅ زالَ التدهور في بوّابة وَصْلة\n${riyadh(nowD)}`),
      );
    }
    await sql`insert into ops.watchdog_events (kind, detail) values (${`${status}->${eff}`}, ${p.detail})`;
    status = eff;
    sinceAt = nowD.toISOString();
    alerted = false;
    tgAt = null;
    emAt = null;
  }

  const dur = since(sinceAt, now);
  if (status === "down") {
    // OPS-ALERT-02: إيقافُ Render لا يزولُ إلّا بإجراءٍ من المالك، فلا يُكرَّرُ تنبيهُه كلَّ دقيقة.
    const cause: DownCause = p.health === "down" ? (p.cause ?? "other") : "other";
    const every = downRepeatSeconds(cause, cfg);
    const m =
      cause === "suspended"
        ? `🚨 بوّابة وَصْلة موقوفة من Render 🚨\nمنذ: ${mins(dur)}\nالسبب: ${p.detail}\nRender أوقف الخدمة (غالبًا تجاوز الحصة الشهرية أو الفوترة). لا تعود تلقائيًا: يلزم إجراء من لوحة Render (Billing ثم Resume).\nالخدمة: ${target}\n${riyadh(nowD)} بتوقيت الرياض\n\nسيتكرر هذا التنبيه كل ساعة حتى تعود الخدمة.`
        : `🚨🚨 بوّابة وَصْلة متوقفة 🚨🚨\nمنذ: ${mins(dur)}\nالسبب: ${p.detail}\nالخدمة: ${target}\n${riyadh(nowD)} بتوقيت الرياض\n\nسيتكرر هذا التنبيه حتى تعود الخدمة.`;
    if (since(tgAt, now) >= every.tg - 5) {
      sent.push(await sendTelegram(cfg.telegram_chat_ids, m));
      tgAt = nowD.toISOString();
    }
    if (since(emAt, now) >= every.email - 5) {
      sent.push(await sendEmail(cfg, `🚨 وَصْلة متوقفة منذ ${mins(dur)}`, m));
      emAt = nowD.toISOString();
    }
    alerted = true;
  } else if (status === "degraded" && dur >= cfg.degraded_grace_s) {
    const m = `⚠️ بوّابة وَصْلة متدهورة\nمنذ: ${mins(dur)}\nالتفاصيل: ${p.detail}\n${riyadh(nowD)} بتوقيت الرياض`;
    if (since(tgAt, now) >= cfg.degraded_tg_every_s - 5) {
      sent.push(await sendTelegram(cfg.telegram_chat_ids, m));
      tgAt = nowD.toISOString();
    }
    if (since(emAt, now) >= cfg.degraded_email_every_s - 5) {
      sent.push(await sendEmail(cfg, `⚠️ وَصْلة متدهورة منذ ${mins(dur)}`, m));
      emAt = nowD.toISOString();
    }
    alerted = true;
  }

  // نبضةٌ يوميّةٌ تُثبتُ أنّ المراقبَ نفسَه حيّ — صمتُها يومًا كاملًا إنذارٌ بحدِّ ذاته.
  let daily = st.last_daily_on;
  const today = nowD.toISOString().slice(0, 10);
  if (nowD.getUTCHours() === cfg.daily_utc_hour && daily !== today) {
    sent.push(
      await sendTelegram(
        cfg.telegram_chat_ids,
        `🟢 المراقب يعمل — حالة بوّابة وَصْلة: ${status} (${p.ms}ms)`,
      ),
    );
    daily = today;
  }

  await sql`update ops.watchdog_state set status = ${status}, since = ${sinceAt}, consecutive_failures = ${fails},
    last_check_at = now(), last_detail = ${p.detail}, last_ms = ${p.ms}, last_tg_at = ${tgAt}, last_email_at = ${emAt},
    alerted = ${alerted}, last_daily_on = ${daily} where id = 1`;
  if (sent.length)
    await sql`insert into ops.watchdog_events (kind, detail) values ('alert', ${`${status}: ${sent.join(" ")}`})`;
  return Response.json({ status, probe: p, fails, sent });
});
