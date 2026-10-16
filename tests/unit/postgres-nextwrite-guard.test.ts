/**
 * الغرض: اختبارُ حارسِ `nextWrite` (D7 · `ADR 0286`): الكتابةُ على اتصالٍ ماتَ
 *   مقبسُهُ (`socket === null` بعدَ `closed()`) يجبُ أن تُسوَّى برفضِ الاستعلامِ
 *   المتأثرِ بـ`CONNECTION_DESTROYED` — لا انهيارَ العمليةِ بخطأٍ غير ملتقطٍ
 *   (`TypeError: null is not an object (evaluating 'socket.write')`) كما وقعَ في
 *   جولةِ `CAP-RUN-20261015` (02:49:18 · انقطاعٌ 231.9ث).
 * الحالة: منفّذ فعلياً — رقعةُ `patches/postgres@3.4.9.patch`.
 * ينتمي إلى: tests/unit
 * يُغطّي: node_modules/postgres/src/connection.js · `nextWrite`.
 *
 * ## لِمَ مباشرةً على وحدةِ الاتصالِ
 *
 * السباقُ نافذةٌ توقيتٍ داخلَ المكتبةِ (قتلُ خلفيةٍ + كتابةٌ في الدورةِ نفسِها) لا
 * يُضمنُ التقاءُها من الخارجِ — فالاختبارُ يبني الاتصالَ **بلا مقبسٍ أصلًا** ثم
 * يستدعي المسارَ نفسَهُ (`execute` ← `write` ← `nextWrite` عبرَ `setImmediate`)
 * فيثبتُ أنَّ الحارسَ يُسوّي الاستعلامَ ويصمدُ. وبلا الرقعةِ ينهارُ هذا الاختبارُ
 * بخطأٍ غير ملتقطٍ — وهذا هوَ انحدارُهُ المحروسُ.
 */

import { describe, expect, it } from "bun:test";
import Connection from "../../node_modules/postgres/src/connection.js";
import { Query } from "../../node_modules/postgres/src/query.js";

/** أصغرُ استعلامٍ بسيطٍ يمرُّ بمسارِ الكتابةِ — لا يعتمدُ على اتصالٍ حيٍّ. */
function simpleQuery() {
  return new Query(
    ["select 1"],
    [],
    // المعالجُ الأصغرُ: يعيدُ صفوفَ الاستعلامِ كما هي — لا يُستدعى أصلًا في مسارِ
    // الرفضِ، لكنّ العقدَ يطلبُه دالةً.
    (query: { rows?: unknown[] }) => query.rows,
    undefined,
    { simple: true, prepare: false, debug: undefined },
  );
}

const rejected: Error[] = [];

function deadConnection() {
  // بلا `connect()`: المقبسُ لا يُنشَأُ أصلًا — وهذا جوهرُ الاختبارِ: كتابةٌ على
  // اتصالٍ بلا مقبسٍ (ما بعدَ `closed()` بالضبطِ).
  const queues = { closed: [] as unknown[] };
  return Connection(
    {
      user: "u",
      host: ["127.0.0.1"],
      port: 5432,
      database: "d",
      idle_timeout: 0,
      connect_timeout: 0,
      ssl: false,
      max: 1,
      buffers: {},
      onparameter: () => undefined,
    },
    queues as never,
    {
      onopen: () => undefined,
      onend: () => undefined,
      onclose: () => undefined,
    },
  ) as unknown as { execute: (q: unknown) => unknown };
}

describe("حارسُ nextWrite — D7: كتابةٌ على مقبسٍ ميتٍ تُسوَّى لا تُسقطُ العمليةَ", () => {
  it("استعلامٌ على اتصالٍ بلا مقبسٍ ⇒ رفضُ `CONNECTION_DESTROYED` لا TypeError", async () => {
    rejected.length = 0;
    const connection = deadConnection();
    const query = simpleQuery();
    query.catch((error: Error) => rejected.push(error));
    const outcome = connection.execute(query) as boolean | undefined;
    // نتيجةُ `execute` هنا غيرَ مضمونةٍ (قد تُعادَ قيمةً أو لا) — المهمُّ المسارُ:
    // `write` جدولةَ `nextWrite` عبرَ `setImmediate` ثمَّ الحارسُ.
    expect(typeof outcome === "boolean" || outcome === undefined).toBe(true);
    // دورةُ أحداثٍ واحدةٌ تكفي لتنفيذِ الفوريِّ المُجدوَلِ.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]?.message).toContain("CONNECTION_DESTROYED");
  });

  it("العمليةُ صامدةٌ بعدَ كتاباتٍ متتابعةٍ على اتصالاتٍ ميتةٍ — لا انهيارَ", async () => {
    rejected.length = 0;
    for (let i = 0; i < 5; i++) {
      const query = simpleQuery();
      query.catch((error: Error) => rejected.push(error));
      deadConnection().execute(query);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejected.length).toBe(5);
    for (const error of rejected) {
      expect(error.message).toContain("CONNECTION_DESTROYED");
    }
  });
});
