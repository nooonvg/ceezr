#!/usr/bin/env bash
# الدفعة 23 — تجهيزُ مقعدِ GitHub بالجذر: حزمُ المقعدِ الأصليِّ بإصداراتِها حيثُ أمكن، والمستخدم «user»،
# وإيقافُ خدماتِ المشغّلِ التي لا وجودَ لها على المقعدِ الأصليّ (تُسجَّلُ قبلُ وبعد).
set -euo pipefail
OUT=/home/user/b25-out
. /etc/os-release
echo "os=$PRETTY_NAME codename=$VERSION_CODENAME kernel=$(uname -r) nproc=$(nproc)"
systemctl list-units --type=service --state=running --no-legend | awk '{print $1}' > /tmp/services-before.txt
for s in docker.service docker.socket containerd.service podman.service mysql.service php8.3-fpm.service mono-xsp4.service php8.5-fpm.service packagekit.service ModemManager.service udisks2.service hv-kvp-daemon.service; do
  systemctl disable --now "$s" >/dev/null 2>&1 || true
done
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
# الإصداراتُ المطابقةُ للمقعدِ الأصليِّ أوّلاً؛ وإلا الأحدثُ مع تسجيلِ الفرق.
PKGS_PIN="postgresql-18=18.6-1.pgdg26.04+2 postgresql-client-18=18.6-1.pgdg26.04+2 postgresql-18-postgis-3=3.6.4+dfsg-2.pgdg26.04+1 postgresql-18-postgis-3-scripts=3.6.4+dfsg-2.pgdg26.04+1 redis-server=5:8.0.5-1ubuntu0.1 redis-tools=5:8.0.5-1ubuntu0.1"
if DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --allow-downgrades $PKGS_PIN ripgrep >/dev/null 2>&1; then echo "PKGS=pinned"; else
  echo "PKGS=latest (الإصداراتُ المثبَّتةُ غيرُ متاحة)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-18 postgresql-client-18 postgresql-18-postgis-3 postgresql-18-postgis-3-scripts redis-server redis-tools ripgrep >/dev/null
fi
dpkg -l | grep -E "postgresql-18|postgis|redis" | awk '{print $2"="$3}'
# المقعدُ الأصليُّ بلا عنقودٍ افتراضيٍّ قائمٍ ولا redis على 6379.
pg_ctlcluster 18 main stop >/dev/null 2>&1 || true; systemctl disable --now postgresql redis-server >/dev/null 2>&1 || true
id user >/dev/null 2>&1 || useradd -m -s /bin/bash user
echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-ceezr-user; chmod 440 /etc/sudoers.d/90-ceezr-user
install -d -o user -g user /home/user/workspace /home/user/.local/bin "$OUT"
sudo -u user -H bash -c 'curl -fsSL https://bun.sh/install | BUN_INSTALL=/home/user/.bun bash -s "bun-v1.4.3" >/dev/null 2>&1; ln -sf /home/user/.bun/bin/bun /home/user/.local/bin/bun; /home/user/.bun/bin/bun --version'
systemctl list-units --type=service --state=running --no-legend | awk '{print $1}' > /tmp/services-after.txt
{ echo "== before"; cat /tmp/services-before.txt; echo "== after"; cat /tmp/services-after.txt; } > "$OUT/runner-services.txt"; chown user:user "$OUT/runner-services.txt"
echo PROVISION_OK
