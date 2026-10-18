```
bun test v1.4.3 (c6da4a4d3)

tests/unit/telegram-update-drainer-batch-claim.test.ts:
(pass) LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر > إعادةُ إنتاج: الالتقاطُ المفردُ البطيءُ لا يملأُ المسارات [1339.16ms]
113 |       maxJobsPerRun: 1000,
114 |       lanes: 16,
115 |       fairBots: ["driver", "rider"],
116 |     });
117 |     expect(f.done.length).toBe(64);
118 |     expect(t.peak()).toBeGreaterThanOrEqual(8);
                           ^
error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 8
Received: 2

      at <anonymous> (/tmp/basewt/tests/unit/telegram-update-drainer-batch-claim.test.ts:118:22)
(fail) LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر > الدُّفعةُ تملأُ المساراتِ برحلاتٍ أقلَّ وتُنجزُ الكلَّ [1339.41ms]
(pass) LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر > ترتيبُ تحديثاتِ المستخدمِ الواحدِ محفوظٌ داخلَ الدُّفعةِ وعبرَ الدُّفعات [643.71ms]
(pass) LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر > سقفُ الشوطِ يحكمُ الدُّفعةَ: لا التقاطَ فوقَ maxJobsPerRun [251.22ms]
(pass) LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر > الإنصافُ بين البوتين باقٍ مع الدُّفعة [1055.59ms]

tests/integration/redispatch-live-round-priority.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'LIVE_ROUND_ESCALATION_GRACE_SECONDS' not found in module '/tmp/basewt/packages/application/dispatch/redispatch-searching-orders.ts'.
-------------------------------


tests/integration/telegram-update-batch-claim.test.ts:
(pass) الالتقاطُ الدُّفعيُّ لوظائفِ تحديثِ تيليجرام — قاعدةٌ حقيقيّة > الحدُّ غيرُ الموجبِ مرفوضٌ صراحةً لا يُفسَّرُ [0.61ms]
47 |     const queue = createPostgresTelegramUpdateQueue(sql, {
48 |       leaseTimeoutSeconds: 30,
49 |       maxAttempts: 5,
50 |     });
51 |     const claim = queue.claimBatchFor;
52 |     expect(claim).toBeDefined();
                       ^
error: expect(received).toBeDefined()

Received: undefined

      at <anonymous> (/tmp/basewt/tests/integration/telegram-update-batch-claim.test.ts:52:19)
(fail) الالتقاطُ الدُّفعيُّ لوظائفِ تحديثِ تيليجرام — قاعدةٌ حقيقيّة > دُفعتانِ متزامنتانِ: مرتّبتانِ بالإيداعِ، ومنفصلتانِ (skip locked)، والإيصالُ مرآةٌ [0.53ms]
80 |       select claim_telegram_update_jobs_for_bot(30, 5, 'driver', 100000) as r`;
81 |     expect(row?.r.ok).toBe(true);
82 |     const jobs = row?.r.jobs ?? [];
83 |     expect(jobs.length).toBeLessThanOrEqual(100);
84 |     // أوّلُها بقيّةُ وظائفِنا (الأقدمُ إيداعًا) بالترتيب.
85 |     expect(jobs.slice(0, 2).map((j) => Number(j.update_id))).toEqual([BASE + 6, BASE + 7]);
                                                                  ^
error: expect(received).toEqual(expected)

  [
-   9921956,
-   9921957,
+   9921950,
+   9921951,
  ]

- Expected  - 2
+ Received  + 2

      at <anonymous> (/tmp/basewt/tests/integration/telegram-update-batch-claim.test.ts:85:62)
(fail) الالتقاطُ الدُّفعيُّ لوظائفِ تحديثِ تيليجرام — قاعدةٌ حقيقيّة > الحدُّ مقصوصٌ في القاعدةِ إلى 100 والباقي يُعادُ مرتّبًا [3.34ms]

 5 pass
 4 fail
 1 error
 20 expect() calls
Ran 9 tests across 3 files. [4.71s]
```
