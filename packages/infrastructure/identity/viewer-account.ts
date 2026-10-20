/**
 * الغرض: قراءةُ دورِ صاحبِ الجلسةِ وحجبِه من `users` بمعرّفِ تيليجرام — محوّلٌ
 *   **للقراءةِ وحدَها** لمنفذِ `ViewerAccountReader` (البند `F1-05`).
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` عبر حقنِ التبعياتِ فقط.
 * ملاحظات مستقبلية: ربطُ المستخدمِ وإنشاؤه عندَ أوّلِ جلسةٍ (القسم 9.8 خطوة 4) **ليس
 *   ههنا بقرارِ مالكِ المنتجِ في `F1-05`**: بندٌ لاحقٌ يقرّر مدينتَه ودورَه
 *   الافتراضيَّ. والتسجيلُ الفعليُّ اليومَ يقع في `directories.ts` عبرَ البوت.
 *
 * لماذا لا يكتب هذا المحوّلُ شيئاً؟ لأنّ عبارةَ `select` وحدَها في هذا الملفِّ
 * تجعل «لا حالةَ أعمالٍ تُنشأ من التطبيقِ المصغَّر» (ADR 0035 §2) **مفروضاً
 * بالكودِ لا موصوفاً في وثيقة**.
 */

import type {
  ViewerAccount,
  ViewerAccountReader,
  ViewerLookupFailure,
  ViewerRole,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

export interface AccountRow {
  readonly role: string;
  readonly is_blocked: boolean;
  readonly language_code: string;
}

/** قيمُ نوعِ `user_role` في القاعدة — مصدرُها المخطَّطُ لا اجتهادُ العميل. */
const KNOWN_ROLES: readonly ViewerRole[] = ["rider", "driver", "support", "admin"];

function readRole(value: string): ViewerRole | null {
  return KNOWN_ROLES.find((role) => role === value) ?? null;
}

function lookupFailed(reason: ViewerLookupFailure["reason"]): ViewerLookupFailure {
  return { code: "VIEWER_LOOKUP_FAILED", reason };
}

/**
 * `users.telegram_id` عمودُ `bigint`، ومعرّفُ الجلسةِ نصٌّ. فالنصُّ غيرُ الرقميِّ
 * **لا يُرسَل إلى القاعدةِ أصلاً**: لا صفَّ يمكن أن يطابقه، وإرسالُه يورِّث خطأَ
 * تحويلٍ يُقرأ خطأَ خادمٍ لا «لا صفَّ».
 */
export function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

export function createViewerAccountReader(sql: Sql): ViewerAccountReader {
  return {
    findByTelegramUserId: async (
      telegramUserId: string,
    ): Promise<Result<ViewerAccount | null, ViewerLookupFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      if (telegramId === null) return ok(null);

      let rows: AccountRow[];
      try {
        rows = await sql.unsafe<AccountRow[]>(
          "select role::text as role, is_blocked, language_code from users where telegram_id = $1",
          [telegramId],
        );
      } catch {
        // لا يُمرَّر نصُّ خطأِ القاعدةِ ولا المعرّفُ إلى الأعلى: سببٌ مصنَّفٌ وحدَه.
        return err(lookupFailed("READER_ERROR"));
      }

      return accountFromRow(rows[0]);
    },
  };
}

/**
 * صفُّ `users` (أو غيابُه) ← حسابُ المُشاهد — **القارئُ الوحيدُ** للصفِّ، يستعملُه هذا المحوّلُ
 * وقراءةُ الإقلاعِ المدمجة (`bootstrap-account-consents.ts`، الدفعةُ 21) فلا يتفرّعُ الحكم.
 */
export function accountFromRow(
  row: AccountRow | undefined,
): Result<ViewerAccount | null, ViewerLookupFailure> {
  if (row === undefined) return ok(null);

  const role = readRole(row.role);
  if (role === null) {
    // دورٌ في القاعدةِ لا يعرفه الكودُ: يُعلَن خطأً ولا يُخشَّن إلى `rider`.
    // الترقيةُ الخاطئةُ والتخفيضُ الخاطئُ كلاهما خطر، والصمتُ أخطرُ منهما.
    return err(lookupFailed("UNSUPPORTED_ROLE"));
  }

  return ok({ role, isBlocked: row.is_blocked === true, languageCode: row.language_code });
}

export function viewerLookupFailed(reason: ViewerLookupFailure["reason"]): ViewerLookupFailure {
  return lookupFailed(reason);
}
