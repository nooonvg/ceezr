/**
 * الغرض: محوّلا سجلِّ الموافقاتِ على PostgreSQL — قراءةٌ بدالّةٍ واحدةٍ وكتابةٌ
 *   بدالّةٍ ذرّيّةٍ واحدةٍ، لا SQL مبثوثٌ (البند `F2-01` · القاعدة 0.5).
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: infrastructure/consent
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * ملاحظات مستقبلية: `F2-11` يحتاجُ قراءةً بلا معرّفِ تيليجرام (تصديرُ بياناتٍ
 *   بطلبِ إشرافٍ)؛ فتُضافُ دالّةٌ ثالثةٌ في الهجرةِ ومحوّلٌ ثالثٌ ههنا، ولا
 *   يُوسَّعُ هذانِ بوسيطٍ اختياريٍّ يُبدِّلُ معنى النداءِ.
 *
 * ما لا يفعله هذا الملفُّ عن قصدٍ:
 *   ــ لا يبني `insert` ولا `update` بنفسِه: الكتابةُ كلُّها في `record_user_consent`
 *      حيثُ تُقرأُ المدينةُ من صفِّ المستخدمِ داخلَ القاعدةِ.
 *   ــ لا يقرِّرُ كفايةَ الموافقاتِ: يُعيدُ الصفوفَ، والحكمُ في النطاقِ.
 *   ــ لا يُمرِّرُ نصَّ خطأِ القاعدةِ إلى الأعلى: سببٌ مصنَّفٌ وحدَه.
 *   ــ لا يُنشئُ مستخدماً: `USER_NOT_FOUND` تُعادُ كما جاءَت من الدالّةِ.
 */

import type {
  ConsentRecordReader,
  ConsentRecordWriter,
  ConsentStoreFailure,
  RecordConsentCommand,
  RecordConsentOutcome,
} from "../../application/consent/ports.ts";
import type { RecordedConsent } from "../../domain/consent/consent-decision.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: ConsentStoreFailure["reason"]): ConsentStoreFailure {
  return { code: "CONSENT_STORE_FAILED", reason };
}

/** كما في `viewer-account.ts`: نصٌّ غيرُ رقميٍّ لا يُرسَلُ إلى `bigint` أصلاً. */
export function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

export interface ConsentRow {
  readonly kind: string;
  readonly version: string;
  readonly accepted_at: string | Date;
}

function readAcceptedAtMs(value: string | Date): number | null {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function createConsentRecordReader(sql: Sql): ConsentRecordReader {
  return {
    listForTelegramUser: async (
      telegramUserId: string,
    ): Promise<Result<readonly RecordedConsent[], ConsentStoreFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      // معرّفٌ لا يمكنُ أن يطابقَ صفّاً: سجلٌّ فارغٌ، لا خطأٌ ولا نداءُ قاعدةٍ.
      if (telegramId === null) return ok([]);

      let rows: ConsentRow[];
      try {
        rows = await sql.unsafe<ConsentRow[]>(
          "select kind, version, accepted_at from list_user_consents($1)",
          [telegramId],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      return consentsFromRows(rows);
    },
  };
}

/**
 * صفوفُ `list_user_consents` ← سجلُّ الموافقات — **القارئُ الوحيدُ** للصفوف، يستعملُه هذا المحوّلُ
 * وقراءةُ الإقلاعِ المدمجة (الدفعةُ 21) فلا يتفرّعُ حكمُ الختمِ غيرِ المقروء.
 */
export function consentsFromRows(
  rows: readonly ConsentRow[],
): Result<readonly RecordedConsent[], ConsentStoreFailure> {
  const recorded: RecordedConsent[] = [];
  for (const row of rows) {
    const acceptedAtMs = readAcceptedAtMs(row.accepted_at);
    // ختمٌ لا يُقرأُ زمناً **يُعلَنُ خطأً** ولا يُطرَحُ صامتاً: صفٌّ مطروحٌ
    // قد يحوِّلُ «وافقَ» إلى «ناقصٌ» فيُعادُ سؤالُه بلا سببٍ، أو أخطرُ من ذاكَ
    // يحوِّلُ «منسوخٌ» إلى «مُستوفىً» لو كانَ المطروحُ هوَ الأحدثَ.
    if (acceptedAtMs === null) return err(failed("STORE_ERROR"));
    recorded.push({ kind: row.kind, version: row.version, acceptedAtMs });
  }
  return ok(recorded);
}

export function consentStoreFailed(reason: ConsentStoreFailure["reason"]): ConsentStoreFailure {
  return failed(reason);
}

interface RecordResultRow {
  readonly result: {
    readonly ok?: boolean;
    readonly error?: string;
    readonly status?: string;
    readonly accepted_at?: string | Date;
  };
}

export function createConsentRecordWriter(sql: Sql): ConsentRecordWriter {
  return {
    record: async (
      command: RecordConsentCommand,
    ): Promise<Result<RecordConsentOutcome, ConsentStoreFailure>> => {
      const telegramId = asTelegramId(command.telegramUserId);
      // ههنا الغيابُ **ليس** سجلاً فارغاً بل كتابةٌ لا صاحبَ لها: تُردُّ صريحةً.
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: RecordResultRow[];
      try {
        rows = await sql.unsafe<RecordResultRow[]>(
          "select record_user_consent($1, $2, $3, $4) as result",
          [telegramId, command.kind, command.version, new Date(command.acceptedAtMs).toISOString()],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(failed(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "STORE_ERROR"));
      }

      const acceptedAt = result.accepted_at;
      if (acceptedAt === undefined) return err(failed("STORE_ERROR"));
      const acceptedAtMs = readAcceptedAtMs(acceptedAt);
      if (acceptedAtMs === null) return err(failed("STORE_ERROR"));

      // حالةٌ غيرُ الحالتَينِ المُعلَنتَينِ خطأٌ لا تُخشَّنُ إلى إحداهما: «سُجِّلَ»
      // و«كانَ مسجَّلاً» يختلفانِ في الختمِ المُعادِ، وتخمينُ أحدِهما يكذبُ.
      if (result.status !== "recorded" && result.status !== "already_recorded") {
        return err(failed("STORE_ERROR"));
      }

      return ok({ status: result.status, acceptedAtMs });
    },
  };
}
