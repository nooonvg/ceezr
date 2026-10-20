/**
 * الغرض: LOAD-01 (الدفعةُ 21) — قراءتا إقلاعِ الجلسة (`ADR 0210`: حسابُ المُشاهدِ وسجلُّ الموافقات)
 *   في **عبارةٍ واحدةٍ** بدلَ اثنتين على مجمّعِ `gatewayRequest`، **داخلَ نطاقِ طلبٍ واحدٍ فقط**.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: infrastructure/identity
 *
 * **لماذا هذا لا يغيّرُ الدلالة:**
 * - لا تخزينَ عبرَ الطلبات: `scoped()` يُنشئُ ذاكرةً جديدةً لكلِّ طلبٍ وتُرمى معه، فكلُّ طلبٍ يقرأُ
 *   `users.role`/`is_blocked` طازجةً من القاعدة كما كان. ولا يمسُّ أيَّ مسارٍ آخرَ يقرأُ الحظر.
 * - القراءتانِ كانتا متوازيتَين في الطلبِ نفسِه ولا ترتيبَ بينهما؛ والعبارةُ الواحدةُ تقرأُهما من
 *   لقطةٍ واحدة — أدقُّ لا أضعف.
 * - تحويلُ الصفوفِ بالقارئَين نفسَيهما حرفًا (`accountFromRow`، `consentsFromRows`): دورٌ مجهولٌ =
 *   `UNSUPPORTED_ROLE`، وختمٌ غيرُ مقروءٍ = `STORE_ERROR`، وغيابُ الصفِّ = `null`.
 * - كلُّ قارئٍ يتحقّقُ من الجلسةِ بنفسِه قبلَ النداء (`resolveViewer` و`readConsentStatus` بلا تغيير).
 * - فشلُ العبارة = فشلُ القراءتَين معًا ⇒ تُحذفانِ من الردِّ فيعودُ العميلُ إلى مسارَيهما المستقلَّين،
 *   وهو ما يحدثُ اليومَ حينَ تفشلانِ معًا. المبادلةُ نفسُها لا تسقط.
 */
import type { ConsentRecordReader } from "../../application/consent/ports.ts";
import type { ViewerAccountReader } from "../../application/identity/ports.ts";
import { err } from "../../shared/result/index.ts";
import { type ConsentRow, consentStoreFailed, consentsFromRows } from "../consent/consent-store.ts";
import type { Sql } from "../db/client.ts";
import {
  type AccountRow,
  accountFromRow,
  asTelegramId,
  viewerLookupFailed,
} from "./viewer-account.ts";

interface CombinedRow {
  readonly role: string | null;
  readonly is_blocked: boolean | null;
  readonly language_code: string | null;
  readonly consents: readonly {
    readonly kind: string;
    readonly version: string;
    readonly accepted_at_ms: number | null;
  }[];
}

type Combined =
  | { readonly ok: true; readonly account: AccountRow | undefined; readonly consents: ConsentRow[] }
  | { readonly ok: false };

/**
 * الصفُّ الواحدُ مضمونٌ (`from (…) c left join users`): غيابُ المستخدمِ = أعمدةُ الحسابِ `null`.
 * والترتيبُ بترتيبِ `list_user_consents` نفسِه (`with ordinality`). والختمُ بالمللي ثانيةِ مقطوعًا
 * كما يقطعُه تحويلُ `postgres.js` إلى `Date`.
 */
const COMBINED_SQL = `
  select u.role::text as role, u.is_blocked, u.language_code, c.consents
    from (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kind', l.kind,
                   'version', l.version,
                   'accepted_at_ms', floor(extract(epoch from l.accepted_at) * 1000)::bigint
                 ) order by l.n),
               '[]'::jsonb) as consents
        from list_user_consents($1::bigint) with ordinality as l(kind, version, accepted_at, n)
    ) c
    left join users u on u.telegram_id = $1::bigint`;

export interface ScopedBootstrapReaders {
  readonly accounts: ViewerAccountReader;
  readonly consents: ConsentRecordReader;
}

export function createBootstrapAccountConsents(sql: Sql): () => ScopedBootstrapReaders {
  return () => {
    const memo = new Map<string, Promise<Combined>>();
    const read = (telegramId: string): Promise<Combined> => {
      const hit = memo.get(telegramId);
      if (hit !== undefined) return hit;
      const pending = (async (): Promise<Combined> => {
        let rows: CombinedRow[];
        try {
          rows = await sql.unsafe<CombinedRow[]>(COMBINED_SQL, [telegramId]);
        } catch {
          return { ok: false };
        }
        const row = rows[0];
        if (row === undefined) return { ok: false };
        const account: AccountRow | undefined =
          row.role === null
            ? undefined
            : {
                role: row.role,
                is_blocked: row.is_blocked === true,
                // كما يمرّرُه القارئُ المستقلُّ حرفًا (بلا قيمةٍ افتراضيّة).
                language_code: row.language_code as string,
              };
        const consents: ConsentRow[] = (Array.isArray(row.consents) ? row.consents : []).map(
          (c) => ({
            kind: c.kind,
            version: c.version,
            // ختمٌ مفقودٌ يبقى غيرَ مقروءٍ فيُعلَنُ `STORE_ERROR` كما في القارئِ المستقلّ.
            accepted_at:
              typeof c.accepted_at_ms === "number" ? new Date(c.accepted_at_ms) : "invalid",
          }),
        );
        return { ok: true, account, consents };
      })();
      memo.set(telegramId, pending);
      return pending;
    };
    return {
      accounts: {
        findByTelegramUserId: async (telegramUserId) => {
          const telegramId = asTelegramId(telegramUserId);
          if (telegramId === null) return accountFromRow(undefined);
          const combined = await read(telegramId);
          if (!combined.ok) return err(viewerLookupFailed("READER_ERROR"));
          return accountFromRow(combined.account);
        },
      },
      consents: {
        listForTelegramUser: async (telegramUserId) => {
          const telegramId = asTelegramId(telegramUserId);
          if (telegramId === null) return consentsFromRows([]);
          const combined = await read(telegramId);
          if (!combined.ok) return err(consentStoreFailed("STORE_ERROR"));
          return consentsFromRows(combined.consents);
        },
      },
    };
  };
}
