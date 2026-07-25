"use client";

import { Eye, EyeOff } from "lucide-react";
import SourcePill from "@/components/admin/SourcePill";
import { formatISTDate } from "@/lib/dates";

/**
 * The small, shared, honest renderers for one worklist row.
 *
 * Two rules run through all of them:
 *   1. NULL IS NEVER FILLED IN. A missing value renders an em dash or a named
 *      phrase that says what the absence means — never a plausible default.
 *   2. PHONE NUMBERS ARE MASKED. Not truncated in the layout: masked in the
 *      DOM, so the digits are simply not present until someone asks for them.
 */

/** The em dash every "we do not have this" cell shares. */
export function Dash() {
  return <span className="text-muted">—</span>;
}

/**
 * `98xxxxx210` — first two and last three digits, the rest replaced.
 *
 * Enough to recognise a number you already know and to tell two rows apart;
 * not enough to dial, copy, or leak in a screenshot of a 178k-row table.
 */
export function maskPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.length <= 5) return "x".repeat(digits.length);
  return `${digits.slice(0, 2)}${"x".repeat(digits.length - 5)}${digits.slice(-3)}`;
}

/**
 * Masked by default, revealed only on an explicit per-row click.
 *
 * The reveal is per row and does not persist anywhere — reloading the page
 * masks everything again.
 *
 * BOTH `revealed` AND `onToggle` ARE OPTIONAL, AND THE SAFE STATE IS THE
 * DEFAULT. A caller that supplies neither gets a masked, inert cell; there is
 * no prop arrangement — including forgetting the props entirely — that renders
 * the digits. Making `revealed` required would have meant every future call
 * site had to opt back INTO masking, which is the wrong direction for a
 * default that protects 178,183 people's phone numbers.
 */
export function MaskedPhone({
  phone,
  revealed = false,
  onToggle,
  size = "sm",
}: {
  phone: string | null | undefined;
  revealed?: boolean;
  /** Omit to render a read-only masked cell with no reveal affordance. */
  onToggle?: () => void;
  size?: "sm" | "md";
}) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return <Dash />;
  const showFull = revealed && !!onToggle;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-mono tabular-nums ${size === "sm" ? "text-[12px]" : "text-sm"}`}>
        {showFull ? phone : maskPhone(phone)}
      </span>
      {onToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="inline-flex shrink-0 items-center rounded-md p-1 text-muted transition hover:bg-surface hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          title={showFull ? "Hide the phone number again" : "Reveal the full phone number"}
          aria-label={showFull ? "Hide phone number" : "Reveal phone number"}
          aria-pressed={showFull}
        >
          {showFull ? <EyeOff size={13} strokeWidth={1.75} /> : <Eye size={13} strokeWidth={1.75} />}
        </button>
      )}
    </span>
  );
}

/**
 * The re-engagement marker. Paired with a left accent border on the row, so
 * legacy rows read as a deliberate, calm category rather than a warning.
 */
export function LegacyChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`pill pill-saffron shrink-0 px-1.5 py-0 text-[10px] font-semibold ${className}`}
      title="Imported from the team's Google Sheet. Not a live site capture — consent is unknown and outbound messaging is disabled."
    >
      Legacy
    </span>
  );
}

/** The lead's pipeline `status`, verbatim. */
export function StatusPill({ status }: { status: string | null }) {
  if (!status) return <Dash />;
  return (
    <span className="pill pill-blue max-w-full truncate px-2 py-0 text-[11px]" title={status}>
      {status}
    </span>
  );
}

/**
 * Consent. `unknown` is the honest state for 100% of legacy leads and is shown
 * as such — never softened into something that reads like permission.
 *
 * The value is rendered from whatever the row actually holds. An unrecognised
 * value gets a neutral pill with its raw text rather than being coerced into
 * one of the four we know about.
 */
export function ConsentBadge({ value }: { value: string | null }) {
  if (!value) return <Dash />;
  const tone =
    value === "explicit"
      ? "pill-green"
      : value === "implied"
      ? "pill-amber"
      : value === "withdrawn" || value === "opted_out"
      ? "pill-red"
      : "pill-gray";
  const label = value.replace(/_/g, " ");
  const title =
    value === "unknown"
      ? "No record that this person agreed to be contacted. Outbound messaging is disabled."
      : `consent_status = ${value}`;
  return (
    <span className={`pill ${tone} max-w-full truncate px-2 py-0 text-[11px] capitalize`} title={title}>
      {label}
    </span>
  );
}

/**
 * The source tag. Reuses the CRM's own `SourcePill` so this table speaks the
 * same visual language as Payments, Students and the Kanban.
 */
export function SourceTag({
  legacySourceTab,
  source,
  isLegacy,
}: {
  legacySourceTab: string | null;
  source: string | null;
  isLegacy: boolean;
}) {
  const channel = (legacySourceTab || source || "").trim();
  if (!channel) return <Dash />;
  return (
    <SourcePill
      size="compact"
      attr={{ channel, displayChannel: null, utm_campaign: null, utm_source: null, legacy: isLegacy }}
    />
  );
}

/**
 * `legacy_call_status_raw` — THE TEAM'S OWN WORDING, RENDERED VERBATIM.
 *
 * Never re-mapped, never title-cased, never bucketed. This column is the one
 * the counsellors trust because it is literally what their sheet said; the
 * moment it is "tidied" it stops being evidence. Long values are truncated by
 * CSS only, with the full string on the element's title.
 */
export function LegacyCallStatus({ value }: { value: string | null }) {
  if (value === null || value === "") return <Dash />;
  return (
    <span className="block truncate text-[12px] text-ink" title={value}>
      {value}
    </span>
  );
}

/**
 * `campaign_clean`, or an explicit statement of its absence.
 *
 * 7,644 of 178,183 legacy rows (4.3%) have no campaign. That is a real fact
 * about the import, not a rendering failure, so it gets deliberate muted
 * italic styling instead of an empty cell that looks like a bug.
 *
 * THE PHRASE IS GATED ON `is_legacy`, AND MUST STAY THAT WAY.
 * `campaign_clean` is written only by the legacy import path (via the
 * attribution trigger) and is NULL for 100% of live-captured leads — measured:
 * 0 of 1,027. Keying the message off the null alone would stamp
 * "Legacy — no campaign" onto every live row in the All scope, which is both
 * wrong and exactly the kind of confident-sounding falsehood this CRM cannot
 * afford. Live rows fall back to the flat `campaign` column (populated for 558
 * of them) and then to an honest dash.
 */
export function CampaignCell({
  value,
  campaign,
  isLegacy,
}: {
  value: string | null;
  campaign: string | null;
  isLegacy: boolean;
}) {
  const clean = (value ?? "").trim();
  if (clean) {
    return (
      <span className="block truncate text-[12px] text-ink" title={clean}>
        {clean}
      </span>
    );
  }

  if (isLegacy) {
    return (
      <span
        className="block truncate text-[12px] italic text-muted"
        title="This legacy row carried no campaign in the source sheet. Nothing was inferred."
      >
        Legacy — no campaign
      </span>
    );
  }

  const raw = (campaign ?? "").trim();
  if (raw) {
    return (
      <span className="block truncate text-[12px] text-ink" title={raw}>
        {raw}
      </span>
    );
  }
  return <Dash />;
}

/** Assignment. "Unassigned" is a calm, intentional state, not an error. */
export function AssigneeCell({ value }: { value: string | null }) {
  const name = (value ?? "").trim();
  if (!name) {
    return (
      <span className="text-[12px] text-muted" title="No counsellor owns this lead yet.">
        Unassigned
      </span>
    );
  }
  return (
    <span className="block truncate text-[12px] text-ink" title={name}>
      {name}
    </span>
  );
}

/** A date, or an em dash. Never "today", never a guess. */
export function DateCell({ value, empty }: { value: string | null; empty?: string }) {
  if (!value) {
    return empty ? (
      <span className="text-[12px] text-muted">{empty}</span>
    ) : (
      <Dash />
    );
  }
  return (
    <span className="whitespace-nowrap text-[12px] text-ink2" title={value}>
      {formatISTDate(value)}
    </span>
  );
}

/** Thousands-separated count that tells the truth about a capped total. */
export function formatTotal(total: number | null, capped: boolean): string | null {
  if (total === null) return null;
  const n = total.toLocaleString("en-IN");
  // A capped total is a FLOOR. Rendering it bare would be a number nobody
  // computed, presented as one somebody did.
  return capped ? `${n}+` : n;
}
