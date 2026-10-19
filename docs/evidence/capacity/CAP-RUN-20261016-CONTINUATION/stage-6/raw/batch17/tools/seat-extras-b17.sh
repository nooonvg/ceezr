#!/usr/bin/env bash
# الدفعة 17 — ملحقاتُ المقعدِ بعدَ setup-env-20261016.sh all (لا يمسُّ الكودَ ولا run.env):
#  1) pg_stat_statements مُحمَّلٌ مسبقاً (كما في مقعدِ الدفعة 12: pgss-full.csv في أدلّةِ قبولِها) — للتشخيصِ بعدَ الموجة.
#  2) INTERNAL_SIGNAL_SECRET في secrets.env (شرطُ wave.sh القبليّ: مسارُ الإشارةِ مُركَّبٌ ومحروس 401).
#  3) القالبُ ceezr_cap_tpl = القاعدةُ المُهاجَرةُ + config/seat-seed.sql (fresh-db.sh ينسخُه لكلِّ موجة).
#  4) أدواتُ المقعدِ من الأدلّة (batch9/seat-tools، seat-tools-r11، batch12/tools) بمساراتِ هذا المقعدِ وحدَها.
set -euo pipefail
B=/srv/ceezr-cap-20261016; REPO=/home/user/workspace/wt-acc; N=$B/bin/nsx
P="psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$N $P -c "alter system set shared_preload_libraries='pg_stat_statements'"
$N /usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart >/dev/null
[ "$($N psql -h 127.0.0.1 -p 55432 -U postgres -tAc 'show shared_preload_libraries')" = pg_stat_statements ] || { echo PGSS_FAIL; exit 1; }
grep -q '^INTERNAL_SIGNAL_SECRET=' $B/secrets.env || (umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> $B/secrets.env)
chmod 600 $B/secrets.env
$N $P -c "drop database if exists ceezr_cap_tpl" -c "create database ceezr_cap_tpl template ceezr_cap_20261016"
$N $P -d ceezr_cap_tpl -f $REPO/deploy/capacity-run/config/seat-seed.sql
R=$REPO/docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw
for f in $R/seat-tools-r11/{run-wave.sh,pgss-dump.sh} $R/batch9/seat-tools/{fresh-db.sh,gates.sh,db-export.sh} \
         $R/batch12/tools/{validity.json,host-sampler.py,qual-check.py,qual-summary.py,qual-wave.sh,idle-baseline.sh,speed-probe.py,pg-probe.sh,post-diag.sh,res-sampler.py,wave-full.sh,b12-analyse.sh}; do
  cp "$f" $B/bin/
done
sed -i "s#/home/user/cap-seat#$B#g; s#/home/user/workspace/ceezr#$REPO#g" $B/bin/*.sh $B/bin/*.py
chmod +x $B/bin/*
echo SEAT_EXTRAS_OK
