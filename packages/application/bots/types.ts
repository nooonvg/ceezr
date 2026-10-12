/**
 * الغرض: عقود حوار البوت مستقلةً عن تلغرام: ماذا وصل، وماذا نردّ، وبأي منافذ.
 *   هكذا يُختبر منطق البوت كاملاً بلا رمز بوت ولا شبكة، ويبقى grammY محوّلاً رقيقاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، tests/unit/*-dialog.test.ts
 * ملاحظات مستقبلية: أي منصّة أخرى (واتساب مثلاً) تُوصَل بمحوّل جديد بلا لمس منطق الحوار.
 */

import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { Subscription } from "../../domain/subscription/entity.ts";
import type {
  CityId,
  DriverId,
  OfferId,
  OrderId,
  RiderId,
  ServiceType,
} from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** ما يصل من المنصّة، مُجرَّداً من شكل تلغرام. */
/** ما يُبلّغه المصدر عن إصلاحته. كلّه اختياري: بلاغٌ ناقص أصدق من بلاغٍ مُلفَّق. */
export interface LocationQualityHints {
  readonly accuracyMeters?: number | undefined;
  readonly headingDegrees?: number | undefined;
  /** ميلي‌ثانية Unix لزمن التقاط الإصلاحة — لا زمن وصولها إلى الخادم. */
  readonly recordedAtMs?: number | undefined;
}

/** جودة الإصلاحة كما حكم عليها المجال، لا كما ادّعاها المصدر. */
export interface StoredLocationQuality {
  /**
   * المرحلة ٥ — زمن **الجهاز** للإصلاحة، لا زمن الخادم.
   *
   * `last_location_at` تُكتب بـ`now()` وهي الصواب لسؤال «هل معرفتنا حديثة؟»
   * والخطأ لقياس التتابع: مقارنة طابعِ جهازٍ جديد بطابعِ خادمٍ سابق تجعل المدة
   * المقيسة زمنَ الشبكة لا زمن الرحلة، فتُقرأ ٢٥٠ متراً في ستين ثانية سرعةً
   * لا نهائية. والفارق بين الساعتين متغيّر بطبيعته فلا يُصلَح بمعامل.
   *
   * **و`BUG-001` جعلَه لازماً لا اختياريّاً**: هو مُسنَدُ الحارسِ الشرطيِّ في
   * القاعدةِ، وكتابةٌ بلا طابعٍ كانت ستمرَّ بلا حكمٍ **وتمحو** الطابعَ المخزَّنَ،
   * فتُسقِط أساسَ الحكمِ على ما يليها — أي بابٌ خلفيٌّ للتراجعِ الذي وُجِد الحارسُ
   * ليمنعَه. واللزومُ في النوعِ يمنعُه عند الترجمةِ لا عند التشغيلِ.
   */
  readonly recordedAtMs: number;
  readonly accuracyMeters: number | null;
  readonly verdict: "ACCEPT" | "WARNING" | "ALERT";
}

/**
 * حكمُ الكتابةِ الشرطيّةِ على `drivers.last_location` — `BUG-001`.
 *
 * الكتابةُ صارت مشروطةً في القاعدةِ، فصار لها جوابٌ لا صمتٌ: مَن كتبَ لا يعرف
 * أقُبِلت إصلاحتُه أم رُفِضت إلَّا إذا قالت له القاعدةُ. و`stale` ليست خطأً
 * تقنيّاً: الحالةُ سليمةٌ ولم تتراجع، وإنّما الإصلاحةُ الواصلةُ أقدمُ من
 * المخزَّنةِ فلم تُقدِّم شيئاً.
 *
 * والمفرداتُ هي مفرداتُ حارسِ `tracking_sessions` نفسُها (`accepted` · `stale`)
 * عن قصدٍ: `ADR 0053` §٦ يُلزِم بأن يكونَ للنظامِ حَكَمٌ واحدٌ على «الأحدثِ»،
 * فاختلافُ الأسماءِ على المعنى الواحدِ أوّلُ خطوةٍ إلى حَكَمَين.
 */
export type LocationWriteOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "stale" }
  | { readonly kind: "no_driver" };

export type IncomingUpdate =
  | {
      readonly kind: "text";
      readonly from: Sender;
      readonly updateId: number;
      readonly text: string;
    }
  | {
      readonly kind: "callback";
      readonly from: Sender;
      readonly updateId: number;
      readonly data: string;
      /**
       * `NEG-SELECT-01` — معرّفُ الرسالةِ التي حملَت الزرَّ: يلزمُ لتبديلِ البطاقةِ في مكانِها
       * («معلوماتُ السائقِ» ثمَّ «تجاهل»). اختياريٌّ: الاختباراتُ القائمةُ لا تحملُه.
       */
      readonly messageId?: string;
    }
  /**
   * `quality` اختياري لأن المصادر تختلف فيما تُبلّغ عنه: زرّ الموقع في تلغرام
   * يرسل الدقّة والاتجاه، والبطاقة اليدوية لا ترسل شيئاً. وغيابه ليس معناه
   * إصلاحةً مثاليةً بل إصلاحةً بلا شهادة على نفسها، ومُقيِّم المجال يتعامل مع
   * الحالتين على حِدَة.
   */
  | {
      readonly kind: "location";
      readonly from: Sender;
      readonly updateId: number;
      readonly location: Coordinates;
      readonly quality?: LocationQualityHints;
    }
  /**
   * `ownerTelegramId`: صاحب البطاقة كما يُقرّه تلغرام، لا كما يدّعي المرسِل.
   * يساوي `from.telegramUserId` حين يضغط المستخدم زرّ مشاركة رقمه،
   * ويختلف عنه حين يُعيد توجيه بطاقة شخص آخر. `null` = بطاقة بلا حساب.
   */
  | {
      readonly kind: "contact";
      readonly from: Sender;
      readonly updateId: number;
      readonly phone: string;
      readonly ownerTelegramId: string | null;
    }
  /**
   * صورة: نحمل معرّف الملف عند تلغرام ولا نُنزّل الصورة ولا نخزّنها عندنا.
   * إعادة إرسالها للدعم تتم بالمعرّف نفسه، فلا تكلفة تخزين ولا تسريب لملفات المستخدمين.
   */
  | {
      readonly kind: "photo";
      readonly from: Sender;
      readonly updateId: number;
      readonly fileId: string;
      readonly caption: string | null;
    }
  | { readonly kind: "unsupported"; readonly from: Sender; readonly updateId: number }
  /**
   * طلبُ انضمامٍ إلى قروبٍ (`PD-001` · `ADR 0157`). لا يحملُ نصاً ولا زرّاً:
   * صاحبُهُ لم يكتبْ للبوتِ بعدُ، فلا جلسةَ لهُ ولا حواراً — والبوتُ الذي
   * استقبلَهُ يقرّر في بوّابةِ الدخولِ قبلَ أيِّ شيءٍ آخر.
   *
   * `groupChatId`: القروبُ المطلوبُ ( سالبٌ عندَ تيليجرامَ عادةً). و`userChatId`:
   * محادثةُ المستخدمِ الخاصةُ معَ البوتِ إن فتحَها تلغرامُ (تُستعملُ لأفضلِ
   * جهدٍ في مراسلتِهِ)، وإلّا فمعرّفُهُ نفسُهُ.
   */
  | {
      readonly kind: "join_request";
      readonly from: Sender;
      readonly updateId: number;
      readonly groupChatId: string;
      readonly userChatId: string;
    }
  /**
   * `GRP-GATE-02` — عضوٌ دخلَ القروبَ مباشرةً (الرابطُ العامُّ أو إضافةٌ) لا عبرَ طلبِ انضمامٍ
   * تحكمُ فيه البوّابةُ. يصلُ من تحديثِ `chat_member` — وتلغرامُ لا يُرسلُه إلا لبوتٍ مشرفٍ،
   * وهوَ نفسُه شرطُ الإخراجِ. و`from` هوَ الداخلُ نفسُه لا من أضافَه.
   */
  | {
      readonly kind: "member_joined";
      readonly from: Sender;
      readonly updateId: number;
      readonly groupChatId: string;
      readonly isBot: boolean;
    };

export interface Sender {
  readonly telegramUserId: string;
  readonly chatId: string;
  /** لغة عميل تلغرام — تُستخدم فقط كافتراض أولي حتى يختار المستخدم لغته. */
  readonly languageHint: string;
}

export type ButtonRow = readonly Button[];

export type Button = CallbackButton | WebAppButton | UrlButton;

export interface CallbackButton {
  readonly label: string;
  /** البيانات المرسلة عند الضغط — لأزرار inline فقط. */
  readonly data: string;
  readonly webAppUrl?: undefined;
  readonly url?: undefined;
}

/**
 * زرٌّ يفتحُ التطبيقَ المصغَّرَ على شاشةٍ بعينِها (`ADR 0213`). لا يُرسِلُ إلى البوتِ شيئاً:
 * الفعلُ كلُّه يجري في التطبيقِ بجلستِه الموقّعةِ، فلا `callback_data` ولا حدَّ الأربعةِ
 * والستّينَ بايتاً. والرابطُ يُبنى بـ`miniAppUrl` وحدَها (`packages/shared/miniapp-link`).
 */
export interface WebAppButton {
  readonly label: string;
  readonly webAppUrl: string;
  /** غائبٌ دائماً: زرُّ التطبيقِ لا يحملُ بياناتِ رجوعٍ إلى البوت. */
  readonly data?: undefined;
  readonly url?: undefined;
}

/**
 * `LOC-TRUST-01` — زرٌّ يفتحُ رابطاً خارجيّاً (موقعُ الالتقاطِ/الوجهةِ في بطاقةِ السائق).
 * لا يُرسِلُ إلى البوتِ شيئاً. والرابطُ يُبنى في الخادمِ من مضيفي الخرائطِ المقبولينَ وحدَهم
 * (`apps/gateway/src/routes/place-links.ts`)؛ ورابطٌ يرفضُه Telegram يُسقِطُ الرسالةَ كلَّها،
 * فالمُرسِلُ يُعيدُ المحاولةَ بلا هذه الأزرارِ ولا يُسقِطُ البطاقة.
 */
export interface UrlButton {
  readonly label: string;
  readonly url: string;
  readonly data?: undefined;
  readonly webAppUrl?: undefined;
}

export function isUrlButton(button: Button): button is UrlButton {
  return typeof (button as { url?: unknown }).url === "string";
}

export function isWebAppButton(button: Button): button is WebAppButton {
  return typeof button.webAppUrl === "string";
}

export type Keyboard =
  | { readonly kind: "inline"; readonly rows: readonly ButtonRow[] }
  /**
   * لوحة أزرار أسفل الشاشة. `persistent` تفرق فرقاً جوهرياً لا تجميلياً:
   * دونها يرسل تلغرام `one_time_keyboard` فتختفي اللوحة بعد أول ضغطة، وقائمة
   * رئيسية تختفي بعد أول استعمال ليست قائمة دائمة ولا تفي بما طُلب في البند 2.1.
   */
  | {
      readonly kind: "reply";
      readonly rows: readonly (readonly string[])[];
      readonly persistent?: true;
    }
  /**
   * زرّ إرسال الموقع. `menuRows` ليست تجميلاً: لوحة الردّ في تلغرام واحدة لا
   * تتراكم، فكل لوحة طلبِ موقع تُرسَل **تمحو** القائمة الرئيسية من أسفل الشاشة —
   * فيبقى العميل في منتصف طلبه بزرٍّ واحد لا زرّ دعم ولا لغة، وهو نقضٌ صريح
   * لمطلب البند 4.3: الدعم بضغطة واحدة في كل الحالات. فتُضمّ القائمة تحت الزرّ.
   */
  | {
      readonly kind: "request_location";
      readonly label: string;
      readonly menuRows?: readonly (readonly string[])[];
    }
  | {
      readonly kind: "request_contact";
      readonly label: string;
      readonly menuRows?: readonly (readonly string[])[];
    }
  | { readonly kind: "remove" };

export interface BotReply {
  readonly chatId: string;
  readonly text: string;
  readonly keyboard: Keyboard | null;
  /**
   * إن وُجد، تُرسَل صورة بهذا المعرّف والنصّ تعليقاً عليها بدل رسالة نصّية.
   * يحتاجه الدعم: إيصال التحويل يجب أن يظهر صورةً في القروب لا رابطاً لا يفتحه أحد.
   */
  readonly photoFileId?: string;
  /**
   * المرحلة ١٢ — إن وُجد، يُرسَل دبّوس موقعٍ **إضافةً** إلى النصّ لا بدلاً منه.
   *
   * ولماذا إضافةً؟ لأن الدبّوس وحده خريطةٌ بلا معنى: السائق يرى نقطةً ولا يعرف
   * أهي الانطلاق أم المقصد ولا في أيّ مرحلةٍ هو. والنصّ وحده معنىً بلا خريطة.
   * فالنصّ يقول «ما هذا»، والدبّوس يقول «أين» ويُشغّل الملاحة.
   *
   * والوسم مُرفَق ليكون في النصّ المصاحب: دبّوسٌ بلا وسمٍ في محادثةٍ فيها دبابيس
   * كثيرة لا يُميَّز بعد دقيقة.
   */
  readonly mapPin?: {
    readonly latitude: number;
    readonly longitude: number;
    readonly label: string;
  };
  /**
   * `NEG-SELECT-01` — إن وُجد، يُعدَّلُ نصُّ هذه الرسالةِ وأزرارُها في مكانِها بدلَ رسالةٍ
   * جديدةٍ. وإن تعذّرَ التعديلُ (رسالةٌ قديمةٌ، مُرسِلٌ لا يُعدِّلُ) تُرسَلُ رسالةً جديدةً.
   */
  readonly editMessageId?: string;
}

/** حالة الحوار المحفوظة بين رسالتين. لا تحمل قيمة تجارية، فقط تقدّم المستخدم. */
export type DialogStep =
  | "idle"
  | "awaiting_name"
  | "awaiting_phone"
  | "awaiting_city"
  | "awaiting_service"
  | "awaiting_pickup"
  | "awaiting_dropoff"
  /** خاصّ بالتوصيل: وصف الطرد بعد تثبيت نقطتي الانطلاق والوصول. */
  | "awaiting_parcel"
  /** اختيار نوع الشكوى بعد /support: اشتراك أم نزاع رحلة. */
  | "awaiting_support_type"
  /** انتظار نصّ الشكوى أو صورتها بعد اختيار النوع. */
  | "awaiting_support_message"
  /** ملفّ السائق التوثيقي: نوع المركبة ثم لوحتها ثم الهوية ثم صورة المركبة. */
  | "awaiting_vehicle_type"
  | "awaiting_plate_number"
  | "awaiting_national_id"
  | "awaiting_vehicle_photo"
  /**
   * البند 2.4 — خطوتان اختياريتان بعد اكتمال التسجيل: اسم المنطقة ثم موقعها.
   * وُضعتا **بعد** كتابة الصفّ لا قبلها قصداً: تسجيلٌ يسقط عند خطوة اختيارية
   * يضيّع كل ما سبقها، والمنطقة أهون من أن تُكلّف السائق ملفّه كلّه.
   */
  | "awaiting_preferred_area_label"
  | "awaiting_preferred_area_location"
  /** تغيير المدينة بعد التسجيل — للانتقال والسفر. */
  | "awaiting_city_change";

/**
 * القائمة نفسها كقيمة، ليتحقّق منها مخزن Redis عند القراءة.
 * كانت مكرّرة يدوياً هناك، فأُضيفت خطواتٌ جديدة إلى النوع ولم تُضَف إلى القائمة:
 * فصار المخزن يرفض كل جلسة تصلها خطوةٌ جديدة ويعيدها إلى الصفر بصمت — والاختبار
 * في الذاكرة لا يراه لأنه لا يمرّ بالترجمة أصلاً. التكرار هو العطب، فأُزيل.
 * `satisfies` يجعل أي انحراف بين النوع والقائمة خطأ ترجمة لا مفاجأة إنتاج.
 */
export const DIALOG_STEPS = [
  "idle",
  "awaiting_name",
  "awaiting_phone",
  "awaiting_city",
  "awaiting_service",
  "awaiting_pickup",
  "awaiting_dropoff",
  "awaiting_parcel",
  "awaiting_support_type",
  "awaiting_support_message",
  "awaiting_vehicle_type",
  "awaiting_plate_number",
  "awaiting_national_id",
  "awaiting_vehicle_photo",
  "awaiting_preferred_area_label",
  "awaiting_preferred_area_location",
  "awaiting_city_change",
] as const satisfies readonly DialogStep[];

export interface DialogState {
  readonly step: DialogStep;
  readonly language: string;
  readonly draftName: string | null;
  readonly draftPhone: string | null;
  readonly draftCityId: CityId | null;
  readonly draftService: ServiceType | null;
  readonly draftPickup: Coordinates | null;
  /** وجهة محفوظة بين خطوتين — يحتاجها التوصيل لأن وصف الطرد يأتي بعدها. */
  readonly draftDropoff: Coordinates | null;
  /** نوع تذكرة الدعم المختار، محفوظاً حتى تصل رسالة الشكوى. */
  readonly draftSupportType: "subscription" | "ride_dispute" | "deduction" | null;
  /**
   * مسوّدة الملفّ التوثيقي. تُجمَع في الجلسة ولا تُكتب في القاعدة إلا مكتملة:
   * سائقٌ يتوقّف في منتصف التسجيل لا يجوز أن يترك صفّاً نصف موثَّق يظنّه
   * موظّف التوثيق ملفّاً حقيقياً.
   */
  readonly draftVehicleType: string | null;
  readonly draftPlateNumber: string | null;
  readonly draftNationalId: string | null;
  readonly draftVehiclePhotoFileId: string | null;
  /** اسم المنطقة المفضّلة محفوظاً حتى تصل إحداثيتها — البند 2.4. */
  readonly draftPreferredAreaLabel: string | null;
}

export const INITIAL_STATE: DialogState = {
  step: "idle",
  draftPreferredAreaLabel: null,
  language: "ar",
  draftName: null,
  draftPhone: null,
  draftCityId: null,
  draftService: null,
  draftPickup: null,
  draftDropoff: null,
  draftSupportType: null,
  draftVehicleType: null,
  draftPlateNumber: null,
  draftNationalId: null,
  draftVehiclePhotoFileId: null,
};

export interface SessionStore {
  load(telegramUserId: string): Promise<Result<DialogState | null, PortFailureError>>;
  save(telegramUserId: string, state: DialogState): Promise<Result<void, PortFailureError>>;
  clear(telegramUserId: string): Promise<Result<void, PortFailureError>>;
}

export interface CityRef {
  readonly id: CityId;
  readonly code: string;
  readonly name: string;
}

export interface CityDirectory {
  /** المدن المفعَّلة فقط. مدينة بلا مجموعات تلغرام لا تظهر للمستخدم إطلاقاً. */
  listActive(): Promise<Result<readonly CityRef[], PortFailureError>>;
}

export interface DriverProfile {
  readonly id: DriverId;
  readonly cityId: CityId;
  readonly telegramUserId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly isVerified: boolean;
  readonly isAvailable: boolean;
  /** بلا موقع محفوظ لا يدخل السائق المطابقة إطلاقاً — المسافة ركن في المعادلة. */
  readonly hasLocation: boolean;
  /**
   * المرحلة ٥ — آخر إصلاحة مقبولة كما هي في المصدر القانوني، أو `null` إن لم
   * يُرسل السائق موقعاً قط. وجودها في الملفّ الشخصي مقصود: تحقّق التتابع يحتاج
   * سابقةً، وجلبُها باستعلام ثانٍ كان سيفتح نافذةً تتغيّر فيها القيمة بين
   * القراءتين — والأسوأ أنه يجعل السابقة تُقرأ من لحظةٍ غير لحظة الكتابة.
   */
  readonly lastFix: {
    readonly latitude: number;
    readonly longitude: number;
    readonly recordedAtMs: number;
  } | null;
}

export interface RegisterDriverInput {
  readonly telegramUserId: string;
  readonly cityId: CityId;
  readonly fullName: string;
  readonly phone: string;
  readonly service: ServiceType;
  readonly language: string;
  /** الملفّ التوثيقي يُكتب مع التسجيل في عملية واحدة لا في تحديث لاحق. */
  readonly vehicleType: string;
  readonly plateNumber: string;
  readonly nationalId: string;
  /**
   * معرّفُ ملفِّ تيليجرامَ لصورةِ المركبة. `null` في التسجيلِ من التطبيقِ المصغَّر (`PRD-105`):
   * لا مسارَ رفعٍ لها هناك بعدُ، فتبقى ناقصةً ظاهرةً لا قيمةً مختلَقة.
   */
  readonly vehiclePhotoFileId: string | null;
}

export interface DriverDirectory {
  findByTelegramId(telegramUserId: string): Promise<Result<DriverProfile | null, PortFailureError>>;
  register(input: RegisterDriverInput): Promise<Result<DriverProfile, PortFailureError>>;
  setAvailability(
    driverId: DriverId,
    isAvailable: boolean,
  ): Promise<Result<void, PortFailureError>>;
  /**
   * يحفظ آخر موقع للسائق — يغذّي المطابقة مباشرة.
   *
   * `quality` ليس زينةً في السجل: مُقيِّم المرحلة ٣ يُنتج ثلاثة أحكام، فإن خُزّن
   * الموضع وحده ضاع الحكم وعادت المطابقة تُسوّي بين إصلاحة بدقّة ٥ أمتار وأخرى
   * بدقّة ٣ كيلومترات. تمريره هنا يجعل الجودة جزءاً من المصدر القانوني (ADR-0015).
   *
   * **و`BUG-001`**: الكتابةُ مشروطةٌ في القاعدةِ — تُرفَض الإصلاحةُ الأقدمُ قِدَماً
   * صارماً فلا تُرجِع الحالةَ إلى الوراءِ — والحكمُ يُعاد إلى النادي صريحاً. ولذلك
   * صارت `quality` لازمةً: فيها طابعُ الإصلاحةِ الذي يحكمُ به الحارسُ.
   */
  updateLocation(
    driverId: DriverId,
    location: Coordinates,
    quality: StoredLocationQuality,
  ): Promise<Result<LocationWriteOutcome, PortFailureError>>;
  /**
   * يحفظ المنطقة المفضّلة أو يمسحها بتمرير `null` — البند 2.4.
   *
   * الاسم والإحداثية يُكتبان معاً أو يُمسحان معاً، لا واحد دون الآخر: قيد
   * `drivers_preferred_area_pair` في القاعدة يرفض نصف المنطقة، وتوقيع الدالة
   * يمنع كتابة ما سترفضه القاعدة بدل أن ينتظر خطأ تشغيل.
   */
  setPreferredArea(
    driverId: DriverId,
    area: { readonly label: string; readonly location: Coordinates } | null,
  ): Promise<Result<void, PortFailureError>>;
  /**
   * يغيّر مدينة السائق ذرّياً عبر RPC — للانتقال والسفر.
   * يتحقق RPC من: المدينة مُفعّلة، لا يوجد طلب نشط.
   */
  changeCity(
    driverId: DriverId,
    newCityId: CityId,
  ): Promise<Result<{ readonly ok: boolean; readonly error: string | null }, PortFailureError>>;
}

export interface RiderProfile {
  readonly id: RiderId;
  readonly cityId: CityId;
  readonly telegramUserId: string;
  readonly fullName: string;
}

export interface RegisterRiderInput {
  readonly telegramUserId: string;
  readonly cityId: CityId;
  readonly fullName: string;
  readonly language: string;
}

export interface RiderDirectory {
  findByTelegramId(telegramUserId: string): Promise<Result<RiderProfile | null, PortFailureError>>;
  register(input: RegisterRiderInput): Promise<Result<RiderProfile, PortFailureError>>;
  /**
   * يغيّر مدينة العميل ذرّياً عبر RPC — للانتقال والسفر.
   * يتحقق RPC من: المدينة مُفعّلة، لا يوجد طلب نشط.
   */
  changeCity(
    riderId: RiderId,
    newCityId: CityId,
  ): Promise<Result<{ readonly ok: boolean; readonly error: string | null }, PortFailureError>>;
}

export interface SubscriptionReader {
  /** الاشتراك السارِي للسائق إن وُجد — تجربة مجانية أو مدفوع. */
  findLive(driverId: DriverId): Promise<Result<Subscription | null, PortFailureError>>;
}

/** بدء التجربة المجانية ذرّياً — يقابل الدالة start_trial. */
export interface TrialRpcPort {
  startTrial(
    driverId: DriverId,
    service: ServiceType,
  ): Promise<
    Result<{ readonly started: boolean; readonly reason: string | null }, PortFailureError>
  >;
}

export interface CreateOrderInput {
  readonly cityId: CityId;
  readonly riderId: RiderId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  readonly dropoff: Coordinates | null;
  /** ملاحظة العميل على الطلب — وصف الطرد في التوصيل. تُكتب في orders.notes. */
  readonly notes?: string | null;
}

/**
 * نتيجة الإلغاء مفصَّلة، لا مجرّد صواب أو خطأ. كان الإلغاء يعيد boolean، فكان
 * «لم يُلغَ» يعني في آن واحد: لا طلب لك، وطلبك بدأ فلا يُلغى. فيُقال للعميل
 * «لا يوجد طلب نشط» عن طلب قائم يراه أمامه.
 */
export type CancelOutcome =
  | {
      readonly kind: "cancelled";
      readonly orderId: OrderId;
      readonly service: ServiceType;
      readonly previousStatus: string;
      readonly groupMessageIds: readonly string[];
    }
  | { readonly kind: "not_cancellable" }
  | { readonly kind: "not_found" };

export interface OrderWriter {
  create(input: CreateOrderInput): Promise<Result<OrderId, PortFailureError>>;
  cancelByRider(
    orderId: OrderId,
    riderId: RiderId,
  ): Promise<Result<CancelOutcome, PortFailureError>>;
}

/**
 * منفذُ الإلغاءِ وحدَه — الإنشاءُ عبر `RideRequestCommand` (D-01).
 * فصلُ الإنشاءِ عن الإلغاءِ يمنعُ البوتَ من حملِ قدرةِ الكتابةِ المباشرةِ.
 */
export interface OrderCancellationPort {
  cancelByRider(
    orderId: OrderId,
    riderId: RiderId,
  ): Promise<Result<CancelOutcome, PortFailureError>>;
}

/**
 * ملخّص طلب نشط. كان النظام يقرأ «آخر طلب» فقط بـ limit 1، والعميل قد يملك أكثر
 * من طلب في وقت واحد — مشوار وطرد مثلاً. فكان /cancel يُلغي الأحدث ويقول «أُلغي
 * طلبك» بلا تسمية، فيظنّ العميل أن الأقدم أُلغي وهو باقٍ يبحث عن سائق. هذا ما
 * حدث فعلاً في الإنتاج يوم 2026-08-11.
 */
/**
 * السائق المُسنَد إلى طلب، بالقدر الذي يطمئن به العميل ولا يزيد.
 *
 * لماذا اللوحة وصورة المركبة؟ لأن سؤال «أين سائقي؟» في الواقع سؤالان: هل أُسنِد
 * أحد؟ وكيف أعرفه حين يصل؟ الاسم وحده لا يميّز سيارةً من سيارة على رصيف مزدحم.
 * ولا يُدرج هنا هاتف السائق ولا هويّته: الأول قناة تواصل تُدار من المنصّة لا
 * تُسلَّم نصّاً، والثانية لا تخرج من القاعدة إلى أي رسالة أبداً.
 */
/** موضعٌ مقروء مع وقته — الوقت جزءٌ منه لا ملحقٌ به: موضعٌ بلا زمنٍ لا يُعرف أصادقٌ هو. */
export interface TimestampedPoint {
  readonly lat: number;
  readonly lng: number;
  /** وقت تسجيل الإصلاحة على جهاز السائق (`drivers.last_location_recorded_at`). */
  readonly recordedAt: Date;
}

export interface AssignedDriverRef {
  readonly fullName: string;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  readonly vehiclePhotoFileId: string | null;
  /**
   * المرحلة ١١: موقع السائق القانوني كما كتبته `directories.updateLocation`
   * (ADR-0015) — لا مصدرٌ ثانٍ ولا نسخةٌ في الذاكرة.
   *
   * ولماذا داخل `AssignedDriverRef` لا في `ActiveOrderSummary`؟ لأن الموقع وصفٌ
   * للسائق لا للطلب، ووضعُه على الطلب يجعل حقلاً يُقرأ ولا سائق له في
   * `searching` — فيُكتب له فحصٌ منفصلٌ قد يُنسى.
   *
   * `undefined` لا `null` في التوقيع: مساراتٌ قائمةٌ تبني هذا النوع بيدها
   * (واختباراتٌ كثيرة) لا يصحّ أن تُكسَر لإضافة سطرٍ إلى `/status`؛
   * و`null` تعني «لم يُرسل موقعاً قطّ» وهي حالةٌ حقيقيّة تُميَّز عن «لم يُقرأ».
   */
  readonly lastLocation?: TimestampedPoint | null;
}

export interface ActiveOrderSummary {
  readonly orderId: OrderId;
  readonly service: ServiceType;
  readonly status: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAt: Date;
  /**
   * `WR-06` — موعدُ الحضورِ ولحظةُ إطلاقِ المجدولِ إلى البحث، ولحظةُ بدءِ البحثِ إن بدأَ
   * بعدَ الإنشاء. اختياريّةٌ: مساراتٌ واختباراتٌ تبني النوعَ بيدها.
   */
  readonly pickupAt?: Date | null;
  readonly dispatchAt?: Date | null;
  readonly searchingSince?: Date | null;
  /**
   * يُقرأ في نفس استعلام الطلب لا باستعلام لاحق: قراءتان منفصلتان قد تريان
   * لحظتين مختلفتين، فيُعرض «مُسنَد» بلا سائق أو سائقٌ لطلب أُلغي بينهما.
   * `null` تعني «لا سائق بعد» وهي الحال الطبيعية في `searching`.
   */
  readonly assignedDriver?: AssignedDriverRef | null;
  /**
   * المرحلة ١١: نقطتا الطلب بإحداثيّاتهما لا بوسميهما وحدهما — لأن
   * «كم يبعد سائقي؟» يحتاج مرجعاً يُقاس إليه، والوسم نصٌّ لا يُقاس.
   *
   * `pickup` غير قابلة للإعدام في القاعدة، ومع ذلك تُكتب اختياريّةً هنا: من يبني
   * `ActiveOrderSummary` بيده في اختبارٍ لا يعنيه الموقع، وحقلٌ إلزاميٌّ يُوجِب
   * تعديل عشرات المواضع لأجل سطرٍ واحد.
   */
  readonly pickup?: { readonly lat: number; readonly lng: number } | null;
  readonly dropoff?: { readonly lat: number; readonly lng: number } | null;
}

/**
 * طلب منتهٍ في سجلّ العميل — البند 5.
 *
 * لماذا نوعٌ ثانٍ لا `ActiveOrderSummary` نفسه؟ لأن ما يهمّ في الطلب المنتهي غير ما
 * يهمّ في الجاري: الجاريَ يُسأل عنه «أين سائقي؟» فيحتاج لوحةً وصورةَ مركبة، والمنتهي
 * يُسأل عنه «ماذا جرى؟» فيحتاج وقتَ الانتهاء والتقييم. وحمْلُ نوعٍ واحد للحاجتين
 * يجعل نصف حقوله `null` دائماً في كل استعمال، فلا يُقرأ منه ما هو حقيقةٌ وما هو غياب.
 *
 * ولا يُدرج هنا سعرٌ ولا مسافة: لا يُخزَّن للطلب سعرٌ في القاعدة اليوم، وعرضُ رقمٍ
 * محسوبٍ في لحظة العرض يجعل السجلّ يقول ما لم يقع.
 */
export interface PastOrderSummary {
  readonly orderId: OrderId;
  readonly service: ServiceType;
  /** `completed` أو `cancelled` أو `failed` — كلّها نهايات، ونهايةُ كلٍّ تُقال بنصّها. */
  readonly status: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAt: Date;
  /** لحظة الانتهاء الفعلية، و`null` لطلب أُلغي أو فشل قبل أن يكتمل. */
  readonly endedAt: Date | null;
  /** اسم السائق إن أُسنِد — والملغى قبل الإسناد لا سائق له فعلاً. */
  readonly driverName: string | null;
  /** نجوم العميل لهذا الطلب، و`null` تعني «لم تقيّم بعد» لا «صفر نجوم». */
  readonly ratingStars: number | null;
}

/**
 * رفض السائق للعرض — يُسجَّل فوراً ليخرج من دورة البثّ القادمة بلا انتظار المهلة.
 * ويُحدَّدُ بمعرّفِ عرضٍ واحدٍ لا باسمِ `(order_id, driver_id)`، فلا يُلغي رفضٌ نقرتُه
 * على عرضِ الجولةِ الثانيةِ عرضَ الجولةِ الأولى المعلَّقَ للسائقِ نفسِه (`BUG-003`).
 */
export interface OfferDecisionPort {
  reject(offerId: OfferId, driverId: DriverId): Promise<Result<boolean, PortFailureError>>;
}
