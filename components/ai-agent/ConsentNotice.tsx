"use client";

/**
 * Marketing-consent notice + checkbox. Shown before any phone capture. When
 * consent is REQUIRED (AI_AGENT_REQUIRE_MARKETING_CONSENT=true and not already
 * granted via nsa_consent), the parent form disables submit until this is ticked.
 * The granted flag is passed to /api/ai-agent/leads as consent_marketing so it is
 * persisted on the lead.
 */
export default function ConsentNotice({
  required,
  checked,
  onChange,
  body,
}: {
  required: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
  body: string;
}) {
  return (
    <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl bg-surface p-2.5 text-[11px] leading-relaxed text-ink2">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="I agree to be contacted"
      />
      <span>
        {body}
        {required && <span className="text-danger"> *</span>}
      </span>
    </label>
  );
}
