#!/usr/bin/env bash
# مِسبارُ PostgreSQL ثابتُ العمل: زمنُ استعلامِ CPU واحدٍ (3 ملايين صفّ) بالمللي، من \timing.
/home/user/cap-seat/bin/nsx bash -c "printf '\\\\timing on\nselect sum(i) from generate_series(1,3000000) i;\n' | psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -At" | grep -o 'Time: [0-9.]*' | awk '{print $2}'
