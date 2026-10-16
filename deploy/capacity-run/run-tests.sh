#!/usr/bin/env bash
# CAP-RUN-20261016 — تشغيل الاختبارات وحفظ الأوامر ومخرجاتها الفعلية في test-results.txt
B=/srv/ceezr-cap-20261016; R=/home/user/workspace/ceezr; OUT=$B/test-results.txt; export PATH=$HOME/.bun/bin:$PATH
cd $R
run() { echo; echo "================================================================"; echo "\$ $*"; echo "# at $(date -u +%FT%TZ)"; echo "----------------------------------------------------------------"; "$@" 2>&1; echo "# exit=$?"; }
TDB=postgres://postgres@127.0.0.1:55432/ceezr_cap_test_20261016
PRE=postgres://postgres@127.0.0.1:55432/ceezr_cap_test_pre_d4
{
echo "CAP-RUN-20261016 test-results — repo $(git rev-parse HEAD) + working tree (branch $(git rev-parse --abbrev-ref HEAD))"
echo "## 0) إعادة إنتاج الأعطال على شفرة PR #558 قبل الإصلاح (نسخ الاختبارات الجديدة مؤقتاً إلى $B/pr558 ثم حذف النسخ) — يجب أن تفشل"
NEWT="tests/unit/telegram-update-drainer-truncated-rerun.test.ts tests/unit/telegram-update-drainer-fairness-lease.test.ts tests/unit/telegram-update-drainer-lane-unblock-rerun.test.ts tests/unit/outbound-global-bucket-per-bot.test.ts tests/unit/notification-outbox-concurrent-drain.test.ts"
for t in $NEWT; do cp $R/$t $B/pr558/$t; done
( cd $B/pr558; for t in $NEWT; do run bun test $t; done )
echo "## 0b) D8 (تكامل) على شفرة PR #558 — يجب أن يفشل"
cp $R/tests/integration/redispatch-exhausted-starvation.test.ts $B/pr558/tests/integration/
( cd $B/pr558; run $B/bin/nsx env PATH=$PATH TEST_DATABASE_URL=$TDB bun test tests/integration/redispatch-exhausted-starvation.test.ts )
rm -f $B/pr558/tests/integration/redispatch-exhausted-starvation.test.ts
( cd $B/pr558; for t in $NEWT; do rm -f $t; done; echo "# pr558 worktree status after cleanup:"; git status --short | head )
echo "## 1) اختبارات الإصلاحات الجديدة (وحدة)"
run bun test tests/unit/telegram-update-drainer-truncated-rerun.test.ts tests/unit/telegram-update-drainer-fairness-lease.test.ts tests/unit/telegram-update-drainer-lane-unblock-rerun.test.ts tests/unit/outbound-global-bucket-per-bot.test.ts tests/unit/notification-outbox-concurrent-drain.test.ts tests/unit/ops-egress-01.test.ts
echo "## 2) اختبارات التكامل على PostgreSQL المعزول (بعد الإصلاح)"
run $B/bin/nsx env PATH=$PATH TEST_DATABASE_URL=$TDB bun test tests/integration/telegram-jobs-lane-order.test.ts tests/integration/telegram-drain-lease-renewal.test.ts tests/integration/redispatch-exhausted-starvation.test.ts tests/integration/dispatch-redispatch.test.ts tests/integration/wr-06-scheduled-dispatch.test.ts
echo "## 3) اختبار D4 على قاعدة بدوال المطالبة القديمة (قبل الإصلاح) — يجب أن يفشل"
run $B/bin/nsx env PATH=$PATH TEST_DATABASE_URL=$PRE bun test tests/integration/telegram-jobs-lane-order.test.ts
echo "## 4) التكامل المرتبط بالطابور والإيداع الصامد"
for f in $(ls tests/integration | grep -iE "drain|lease|telegram-update|durable|intake|outbox" ); do run $B/bin/nsx env PATH=$PATH TEST_DATABASE_URL=$TDB bun test tests/integration/$f; done
echo "## 5) كل اختبارات الوحدة"
run bun test tests/unit
echo "## 6) فحص الأنواع"
run bunx tsc --noEmit -p .
} > $OUT 2>&1
grep -E "^\\$|# exit=| pass$| fail$|^ *[0-9]+ (pass|fail)" $OUT | tail -60
