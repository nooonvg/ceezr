/**
 * # جردُ أسطحِ الواجهةِ — UI-1 / PR 0 (`ADR 0233` §5)
 *
 * سجلٌّ مُلتزَمٌ لكلِّ سطحٍ عرضيٍّ قائمٍ اليومَ، مُقابَلٌ بالقرصِ في
 * `scripts/check-ui-surface-inventory.ts`: ملفٌّ جديدٌ لا يدخلُ صامتاً، وملفٌّ
 * محذوفٌ لا يبقى في السجلِّ. هذا جردٌ للواقعِ لا خطّةٌ: لا يُسنِدُ أرقامَ
 * R0–R15/D0–D14 لأنَّ مصدرَها (PDF v2.0) ليسَ في المستودعِ (`ADR 0233` §5).
 */

export interface SurfaceGroup {
  readonly id: string;
  /** الجذرُ الذي يُمسَحُ على القرصِ. */
  readonly root: string;
  /** امتدادُ الملفِّ العرضيِّ في هذا الجذرِ. */
  readonly ext: ".tsx" | ".ts";
  /** المسحُ عميقٌ أم في المستوى الأوّلِ وحدَه. */
  readonly recursive: boolean;
  readonly files: readonly string[];
}

export const SURFACE_INVENTORY: readonly SurfaceGroup[] = [
  {
    id: "miniapp/rider",
    root: "apps/miniapp/src/surfaces/rider",
    ext: ".tsx",
    recursive: true,
    files: [
      "RiderRoot.tsx",
      "account/AccountScreen.tsx",
      "active/ActiveRideScreen.tsx",
      // لوحةُ التفاوضِ — تُبنى مع الرحلةِ النشطةِ (وُلدت في فرعِ السعةِ e87b0229
      // وبقيتْ خارجَ الجردِ فأسقطَ حارسُ الجردِ verify في CI — القياسُ الرابع).
      "active/NegotiationPanel.tsx",
      "active/RideJourney.tsx",
      "destination/DestinationScreen.tsx",
      "faq/FaqScreen.tsx",
      "history/RideDetailScreen.tsx",
      "history/RideHistoryScreen.tsx",
      "home/HomeScreen.tsx",
      "notifications/NotificationsScreen.tsx",
      "privacy/PrivacyScreen.tsx",
      "quote/QuoteScreen.tsx",
      "search/SearchScreen.tsx",
      // WR-09 (ADR 0266): بطاقةُ المرشَّحِ — داخلَ البحثِ والرحلةِ النشطة.
      "search/RideCandidateCard.tsx",
      "search/ScheduledRideCard.tsx",
      // UI-3 / PR 5 (ADR 0238): لوحاتُ [B] على عقودِها القائمة — داخلَ R12/R13/R15.
      "settings/EmergencyContactPanel.tsx",
      "settings/NotificationPrefsPanel.tsx",
      "settings/SavedPlacesPanel.tsx",
      "settings/TicketThread.tsx",
      "share/RideShareCard.tsx",
      "sos/SosCard.tsx",
      "sos/SosEntry.tsx",
      "sos/SosScreen.tsx",
      "summary/RideSummaryScreen.tsx",
      "support/SupportScreen.tsx",
      "welcome/WelcomeScreen.tsx",
    ],
  },
  {
    id: "miniapp/driver",
    root: "apps/miniapp/src/surfaces/driver",
    ext: ".tsx",
    recursive: true,
    files: [
      "DriverRoot.tsx",
      "account/AccountScreen.tsx",
      "activity/ActivityScreen.tsx",
      "consent/DriverConsentGate.tsx",
      "deductions/DeductionTraceScreen.tsx",
      "documents/DocumentsScreen.tsx",
      "job/JobScreen.tsx",
      "location/LocationBroadcast.tsx",
      "offers/OfferDetailScreen.tsx",
      "offers/OffersScreen.tsx",
      "subscription/PaymentInvoicePanel.tsx",
      "subscription/SubscriptionScreen.tsx",
      "summary/DriverRideSummaryScreen.tsx",
      "support/SupportScreen.tsx",
      "vehicle/VehicleScreen.tsx",
    ],
  },
  {
    id: "miniapp/account",
    root: "apps/miniapp/src/surfaces/account",
    ext: ".tsx",
    recursive: true,
    files: ["AccountRights.tsx"],
  },
  {
    id: "miniapp/admin",
    root: "apps/miniapp/src/surfaces/admin",
    ext: ".tsx",
    recursive: true,
    files: ["AdminRoot.tsx"],
  },
  {
    id: "miniapp/onboarding",
    root: "apps/miniapp/src/surfaces/onboarding",
    ext: ".tsx",
    recursive: true,
    files: ["OnboardingRoot.tsx"],
  },
  {
    id: "miniapp/support",
    root: "apps/miniapp/src/surfaces/support",
    ext: ".tsx",
    recursive: true,
    files: ["TicketsScreen.tsx"],
  },
  {
    id: "miniapp/shell",
    root: "apps/miniapp/src/shell",
    ext: ".tsx",
    recursive: false,
    files: ["ErrorBoundary.tsx", "Layout.tsx", "ScreenFrame.tsx", "Shell.tsx"],
  },
  {
    id: "miniapp/system",
    root: "apps/miniapp/src/system",
    ext: ".tsx",
    recursive: false,
    files: ["EmptyState.tsx", "Skeleton.tsx", "SystemScreen.tsx", "UnsupportedCityScreen.tsx"],
  },
  {
    id: "admin-dashboard/pages",
    root: "apps/admin-dashboard/src/pages",
    ext: ".ts",
    recursive: false,
    files: [
      "attendance.ts",
      "break-glass.ts",
      "broadcast.ts",
      "disputes.ts",
      "driver-detail.ts",
      "drivers.ts",
      "heatmap.ts",
      "live-map.ts",
      "live-orders.ts",
      "messages.ts",
      "overview.ts",
      "payments.ts",
      "ratings.ts",
      "recovery.ts",
      "settings.ts",
    ],
  },
  {
    id: "telegram/bots",
    root: "apps/gateway/src/bots",
    ext: ".ts",
    recursive: true,
    files: [
      "driver/availability.ts",
      "driver/index.ts",
      "driver/offers.ts",
      "driver/rating.ts",
      "driver/registration.ts",
      "driver/subscription.ts",
      "driver/trip-lifecycle.ts",
      "rider/index.ts",
      "rider/order-tracking.ts",
      "rider/rating.ts",
      "rider/request-delivery.ts",
      "rider/request-ride.ts",
      "shared/counterpart-notifier.ts",
      "shared/keyboards.ts",
      "shared/language-middleware.ts",
      "shared/redis-session.ts",
      "shared/register-commands.ts",
      "shared/reply-delivery.ts",
      "shared/session-revision.ts",
      "shared/session.ts",
      "shared/telegram-mapper.ts",
    ],
  },
  {
    id: "public-tracking",
    root: "apps/gateway/src/routes",
    ext: ".ts",
    recursive: false,
    files: ["public-tracking.ts"],
  },
];

/** ملفٌّ اختباريٌّ ليسَ سطحاً. */
export function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

export interface InventoryVerdict {
  readonly ok: boolean;
  readonly total: number;
  readonly problems: readonly string[];
}

/**
 * الحكمُ النقيُّ: `onDisk` لكلِّ مجموعةٍ هوَ ما وجدَه الماسحُ (مساراتٌ نسبيّةٌ
 * إلى الجذرِ، بلا اختباراتٍ). مجموعةُ `public-tracking` مُدرَجةٌ ملفّاً بعينِه
 * داخلَ مجلّدِ مساراتٍ أعمَّ، فيُقاسُ وجودُه لا تطابقُ المجلّدِ كلِّه.
 */
export function evaluateInventory(
  inventory: readonly SurfaceGroup[],
  onDisk: Readonly<Record<string, readonly string[]>>,
): InventoryVerdict {
  const problems: string[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const g of inventory) {
    if (ids.has(g.id)) problems.push(`مجموعةٌ مكرَّرةٌ: ${g.id}`);
    ids.add(g.id);
    const declared = new Set(g.files);
    if (declared.size !== g.files.length) problems.push(`ملفٌّ مكرَّرٌ في ${g.id}`);
    total += declared.size;
    const disk = onDisk[g.id];
    if (!disk) {
      problems.push(`الجذرُ غيرُ مقروءٍ: ${g.root} (${g.id})`);
      continue;
    }
    const diskSet = new Set(disk);
    for (const f of declared) {
      if (!diskSet.has(f)) problems.push(`في السجلِّ وغائبٌ عن القرصِ: ${g.root}/${f}`);
    }
    if (g.id === "public-tracking") continue;
    for (const f of diskSet) {
      if (!declared.has(f)) problems.push(`سطحٌ على القرصِ غيرُ مُدرَجٍ: ${g.root}/${f}`);
    }
  }
  return { ok: problems.length === 0, total, problems };
}
