/**
 * الغرض: الحالاتُ **السالبةُ** لحاجزِ أولويّاتِ المرورِ (`F6-07` / ADR-0071).
 *    حاجزٌ يُختبَرُ خضرةً وحدَها حاجزٌ بالاسمِ: كلُّ قاعدةٍ من قواعدِه السّبعِ
 *    تُخرَقُ ههنا عمداً ويُتحقَّقُ أنّها تُخفِقُ فعلاً، ثمَّ يُتحقَّقُ أنَّ
 *    المستودعَ الحقيقيَّ يمرُّ — فلا يبقى الحاجزُ صحيحاً على وقائعَ مُصطنَعةٍ وحدَها.
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  type CodeDeclaration,
  claimOrderClause,
  codeDeclaration,
  findViolations,
  hasOrderCausalHead,
  hasOrderPendingIndex,
  hasPriorityIndex,
  readMigrations,
} from "../../scripts/check-traffic-priority.ts";
import type { SqlMigration } from "../../scripts/lib/traffic-priority-sql.ts";

/**
 * هجرتانِ مُصطنَعتانِ صغيرتانِ: دالّةُ الرتبةِ، والمُطالِبُ، والفهرسُ. ولا تُقرأُ
 * الهجراتُ الحقيقيّةُ في الحالاتِ السالبةِ كي يبقى الاختبارُ حاكماً على المنطقِ
 * لا على حالةِ المستودعِ اليومَ.
 */
function fixtureMigrations(): SqlMigration[] {
  const cases = [
    ["safety_incident", 1],
    ["order_cancelled", 1],
    ["negotiation_turn_opened", 1],
    ["negotiation_turn_closed", 1],
    ["negotiation_agreed", 1],
    ["rider_trip_notice", 1],
    ["driver_candidate_notice", 1],
    ["offer", 2],
    ["wider_circle_opened", 2],
    ["order_chat_message", 2],
    ["no_driver_found", 3],
    ["dispute_resolution", 3],
    ["subscription_notice", 3],
    ["lost_item_report", 3],
    ["driver_location_reminder", 3],
    ["safety_resolution_closed", 3],
    ["safety_resolution_blocked", 3],
    ["broadcast_recipient", 4],
  ] as const;
  return [
    {
      file: "20260101000000_priority.sql",
      sql: [
        "-- migration-phase: expand",
        "create or replace function notification_kind_priority(p_kind text)",
        "returns smallint language sql immutable as $$",
        "  select case p_kind",
        ...cases.map(([kind, rank]) => `    when '${kind}' then ${String(rank)}`),
        "    else 1",
        "  end::smallint",
        "$$;",
        "create or replace function notification_kind_is_deferrable(p_kind text)",
        "returns boolean language sql immutable as $$",
        "  select notification_kind_priority(p_kind) >= 3",
        "$$;",
        "create or replace function claim_notification_delivery(p_limit integer)",
        "returns setof record language plpgsql as $$",
        "begin",
        "  return query select n.id from notification_outbox n",
        "    where n.status = 'pending'",
        "    and not exists (",
        "      select 1 from notification_outbox o",
        "       where o.order_id = n.order_id",
        "         and o.status = 'pending'",
        "         and o.next_attempt_at <= now()",
        "         and (o.created_at, o.id) < (n.created_at, n.id)",
        "    )",
        "    order by notification_kind_priority(n.kind), n.created_at",
        "    limit p_limit;",
        "end;",
        "$$;",
      ].join("\n"),
    },
    {
      file: "20260101010000_priority_index.sql",
      sql: [
        "-- migration-phase: index",
        "create index concurrently if not exists notification_outbox_priority_due_idx",
        "  on notification_outbox (notification_kind_priority(kind), created_at)",
        "  where status = 'pending';",
      ].join("\n"),
    },
    {
      file: "20260101020000_order_pending_index.sql",
      sql: [
        "-- migration-phase: index",
        "create index concurrently if not exists notification_outbox_order_pending_idx",
        "  on notification_outbox (order_id, created_at, id)",
        "  where status = 'pending' and order_id is not null;",
      ].join("\n"),
    },
  ];
}

function withSql(migrations: SqlMigration[], edit: (sql: string) => string): SqlMigration[] {
  const [first, ...rest] = migrations;
  if (first === undefined) throw new Error("لا هجرةَ في الوقائعِ المُصطنَعةِ");
  return [{ file: first.file, sql: edit(first.sql) }, ...rest];
}

describe("F6-07 — حاجزُ أولويّاتِ المرورِ يُخفِقُ عندَ الخرقِ", () => {
  test("الوقائعُ السليمةُ تمرُّ — وإلّا لم يكن للسالباتِ معنًى", () => {
    expect(findViolations(fixtureMigrations(), codeDeclaration())).toEqual([]);
  });

  test("١) نوعٌ بلا رتبةٍ في الكودِ", () => {
    const declared = codeDeclaration();
    const ranks = { ...declared.ranks };
    delete ranks.broadcast_recipient;
    const broken: CodeDeclaration = { ...declared, ranks };
    const violations = findViolations(fixtureMigrations(), broken);
    expect(violations.some((entry) => entry.includes("بلا رتبةٍ"))).toBe(true);
  });

  test("١-ب) رتبةٌ خارجَ المجالِ ١..٤", () => {
    const declared = codeDeclaration();
    const broken: CodeDeclaration = {
      ...declared,
      ranks: { ...declared.ranks, offer: 9 },
    };
    const violations = findViolations(fixtureMigrations(), broken);
    expect(violations.some((entry) => entry.includes("خارجَ المجالِ"))).toBe(true);
  });

  test("٢) رتبةٌ تفترقُ بينَ الكودِ والقاعدةِ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace("when 'offer' then 2", "when 'offer' then 4"),
    );
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("تفترقُ"))).toBe(true);
  });

  test("٢-ب) لا دالّةَ رتبةٍ في القاعدةِ أصلاً", () => {
    const violations = findViolations([], codeDeclaration());
    expect(violations.some((entry) => entry.includes("لا تعريفَ لدالّةِ"))).toBe(true);
  });

  test("٢-ج) نوعٌ مُصنَّفٌ في القاعدةِ لا وجودَ له في الكودِ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace("    else 1", "    when 'ghost_kind' then 2\n    else 1"),
    );
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("مُدخلٌ ميّتٌ"))).toBe(true);
  });

  test("٣) المجهولُ يُقرأُ منخفضاً بدلَ الحرجِ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace("    else 1", "    else 4"),
    );
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("رتبةَ الحرجِ"))).toBe(true);
  });

  test("٤) اشتقاقُ التأجيلِ يفترقُ بينَ الطرفَينِ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace(
        "notification_kind_priority(p_kind) >= 3",
        "notification_kind_priority(p_kind) >= 4",
      ),
    );
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("الاشتقاقانِ افترقا"))).toBe(true);
  });

  test("٥) المُطالِبُ يعودُ إلى الأقدميّةِ وحدَها فتصيرُ الرتبةُ حِبراً", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace(
        "order by notification_kind_priority(n.kind), n.created_at",
        "order by n.created_at",
      ),
    );
    const order = claimOrderClause(migrations);
    expect(order).toBe("n.created_at");
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("لا يبدأُ بالرتبةِ"))).toBe(true);
  });

  test("٦) لا فهرسَ للترتيبِ الجديدِ", () => {
    const [first] = fixtureMigrations();
    if (first === undefined) throw new Error("لا هجرةَ");
    expect(hasPriorityIndex([first])).toBe(false);
    const violations = findViolations([first], codeDeclaration());
    expect(violations.some((entry) => entry.includes("لا فهرسَ"))).toBe(true);
  });

  // تصحيحٌ مُضافٌ — بعدَ حكمِ CI `34393076336`: انقلابُ التتابعِ السببيِّ عطبٌ
  // قاسَه اختبارٌ قائمٌ، فحُجِبَ بشرطِ رأسِ الطلبِ، فوجبَ أن يُحرَسَ الشرطُ نفسُه.
  test("٧) حَذفُ شرطِ رأسِ الطلبِ يُخفِقُ الحاجزَ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace(/ {4}and not exists \([\s\S]*?\n {4}\)\n/, ""),
    );
    expect(hasOrderCausalHead(migrations)).toBe(false);
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("رأسِ الطلبِ"))).toBe(true);
  });

  test("٧-ب) تتابعٌ جزئيٌّ (created_at وحدَه) لا يُقبَلُ — المتساويانِ يحجُبانِ بعضَهما", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace(
        "         and (o.created_at, o.id) < (n.created_at, n.id)",
        "         and o.created_at < n.created_at",
      ),
    );
    expect(hasOrderCausalHead(migrations)).toBe(false);
    const violations = findViolations(migrations, codeDeclaration());
    expect(violations.some((entry) => entry.includes("رأسِ الطلبِ"))).toBe(true);
  });

  test("٧-ج) شرطٌ يحجُبُ بالمُتراجِعِ أيضاً — بلا `next_attempt_at` يُجمَّدُ الطلبُ", () => {
    const migrations = withSql(fixtureMigrations(), (sql) =>
      sql.replace("         and o.next_attempt_at <= now()\n", ""),
    );
    expect(hasOrderCausalHead(migrations)).toBe(false);
  });

  test("٧-د) لا فهرسَ لشرطِ رأسِ الطلبِ", () => {
    const withoutIndex = fixtureMigrations().slice(0, 2);
    expect(hasOrderPendingIndex(withoutIndex)).toBe(false);
    const violations = findViolations(withoutIndex, codeDeclaration());
    expect(violations.some((entry) => entry.includes("order_id, created_at, id"))).toBe(true);
  });
});

describe("F6-07 — المستودعُ الحقيقيُّ", () => {
  test("هجراتُ المستودعِ اليومَ تمرُّ بالحاجزِ", () => {
    expect(findViolations(readMigrations(), codeDeclaration())).toEqual([]);
  });
});
