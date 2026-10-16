/**
 * استهلاكُ أحداثِ محاكيِ تيليجرام — دوالُّ نقيةٌ بلا أيِّ تأثيرٍ جانبيٍّ عند
 * الاستيرادِ (يستوردها المولّدُ والاختبارُ معًا). الدرسُ التاريخيُّ: مؤشّرُ
 * القراءةِ كانَ لا يتقدّمُ (خلطُ بروتوكولِ `since`/`cursor` بـ`after`/`seq`)
 * فيعادُ كلُّ التاريخِ في كلِّ استطلاعٍ، وفلترُ ≤60ث كانَ يستبعدُ العيناتِ
 * البطيئةَ فيتحسّنُ المتوسطُ زورًا.
 */

export interface MockEvent {
  readonly seq: number;
  readonly t: number;
  readonly bot: string;
  readonly method: string;
  readonly chat_id: string;
  readonly message_id: number | null;
  readonly status: number;
}

export interface ConsumptionState {
  cursor: number;
  observed: number;
  ageSumMs: number;
  ageMaxMs: number;
}

/** استهلاكُ صفحةٍ منَ الأحداثِ: تحصي كلَّ حدثٍ (لا فلترَ يستبعدُ البطيءَ)،
 *  وتُقدّمُ المؤشّرَ إلى آخرِ حدثٍ استُهلكَ فعلًا لا إلى رأسِ السجلِّ (الصفحةُ
 *  محدودةٌ فالقفزُ إلى الرأسِ يتخطى أحداثًا لم تُقرأ). */
export function consumePage(
  events: readonly MockEvent[],
  state: ConsumptionState,
  nowMs: number,
): ConsumptionState {
  let { cursor, observed, ageSumMs, ageMaxMs } = state;
  for (const event of events) {
    observed += 1;
    const age = Math.max(0, nowMs - event.t);
    ageSumMs += age;
    ageMaxMs = Math.max(ageMaxMs, age);
  }
  const last = events.length > 0 ? events[events.length - 1]?.seq : undefined;
  if (typeof last === "number") cursor = last;
  return { cursor, observed, ageSumMs, ageMaxMs };
}
