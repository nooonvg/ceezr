# بيئةُ تشغيلِ الدفعةِ العاشرة (b10-acc-250 · b10-acc-500)

| البند | القيمة |
|---|---|
| رأسُ الشيفرةِ المقيس | `d3c4b90dde96edb09c43b73778d0b0fa506fa4f5` (`code_dirty=0` و`docs_dirty=0` في `timeline.jsonl` للموجتين) |
| التغييرُ عن `main` (`121eaa2d`) | `DB_POOL_MAX.gatewayRequest` 5→6 + اختبارُ الميزانيّةِ المُثبَّت فقط |
| `deploy/capacity-run/config/run.env` sha256 | `9cc2765db3899d84b50b11402a2a6889d856b0e147a96db6103384680b999acd` |
| متغيّراتُ التشخيص | لا شيء (`diag-env.env` فارغ؛ لا `TRACE_FILE` ولا `DIAG_*`) |
| المعالج | 2 vCPU · Linux 6.1.155 |
| PostgreSQL | PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0, 64-bit |
| Bun | 1.4.3 |
| القاعدة | نسخةٌ جديدةٌ من القالبِ لكلِّ موجةٍ (`fresh-db.sh`)، والبوّابةُ تُعادُ معَها (`FRESH_DB_OK sha=d3c4b90d`) |
| سقوفُ تيليجرام في المحاكي | المعتمدةُ دونَ تغيير (البوتُ 20–25/ث عالميًّا، 1/ث للمحادثة) |
| المولّد | `deploy/capacity-run/load/miniapp-load.ts` بالمزيجِ نفسِه، حلقةٌ مغلقة، 180ث موجة + 180ث تصريف |
