/**
 * Read-only marketing SOURCE pill for admin per-person surfaces.
 *
 * Renders NOTHING when there's no attribution stamp on the matched lead — never
 * shows an edit control, never fires an action, never touches payment /
 * enrolment / student data. Colors track the `channel` string so it stays
 * visually consistent with the Lead CRM's Google Ads / Meta Ads pills.
 *
 * Shared by:
 *   • Payments user card              (app/admin/payments/page.tsx)
 *   • Student profile header          (app/admin/students/[id]/page.tsx)
 *   • Students / People hub row       (app/admin/students/page.tsx)
 *
 * Each surface joins by phone (last-10 normalized) via `lastDigits10()` below.
 */

export interface LeadAttrStamp {
  channel: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
}

/** Loose last-10 digits so a "+91..." phone matches a raw-10 lead-record phone. */
export function lastDigits10(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D/g, "").slice(-10);
}

/** Look up per-phone attribution from an admin API's `leadAttrByPhone` map. */
export function lookupLeadAttr(
  byPhone: Record<string, LeadAttrStamp> | null | undefined,
  phone: string | null | undefined,
): LeadAttrStamp | null {
  if (!byPhone) return null;
  const key = lastDigits10(phone);
  if (!key) return null;
  return byPhone[key] || null;
}

interface Props {
  attr: LeadAttrStamp | null;
  /** Extra classes for the wrapping fragment's spacing at the callsite. */
  className?: string;
  /** Compact = smaller font + less padding, for dense table rows. */
  size?: "default" | "compact";
}

/**
 * Read-only marketing source pill (channel + optional utm_campaign).
 * Renders nothing when `attr` is null or the channel is missing.
 */
export default function SourcePill({ attr, size = "default" }: Props) {
  if (!attr || !attr.channel) return null;
  const isGoogleAds = attr.channel === "Google Ads";
  const isMetaAds = attr.channel === "Meta Ads";
  const tone = isGoogleAds
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : isMetaAds
    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
    : "border-line bg-surface2 text-ink2";
  const padCls = size === "compact" ? "px-1.5 py-0" : "px-2 py-0.5";
  const textCls = size === "compact" ? "text-[10px]" : "text-[11px]";
  return (
    <>
      <span
        className={`inline-flex items-center gap-1 rounded-full border font-medium ${tone} ${padCls} ${textCls}`}
        title="Marketing source captured on the matching lead — read-only, from lead attribution."
      >
        <span aria-hidden="true">•</span>
        {attr.channel}
      </span>
      {attr.utm_campaign && (
        <span
          className={`rounded-full border border-line bg-surface2 font-mono text-ink2 ${padCls} ${textCls}`}
          title="utm_campaign (read-only)"
        >
          {attr.utm_campaign}
        </span>
      )}
    </>
  );
}
