/**
 * Payments & Finance UI v2 feature flag (server-read, returned via the admin
 * payments API so a Vercel env flip takes effect on the next request WITHOUT
 * a redeploy — the app never inlines this into the client bundle).
 *
 * Gates the risky UI swap on `/admin/payments` and the Registrations-by-Source
 * page: the derived-channel source card, the source definitions in the expanded
 * panel, the collapsible filter redesign + new Source filter, and removal of
 * non-essential animations. Every other admin surface is unaffected.
 *
 * Default: ON. Flip to `"false"` (exact lowercase) via the Vercel env var
 * `PAYMENTS_UI_V2=false` to fall back to the pre-shipment UI/logic. Any other
 * value (unset, empty, "true", "TRUE", "FALSE") leaves the feature ON — same
 * "exact match" semantics as the attribution-full-capture flag so admins never
 * fat-finger a partial "false" and silently disable it.
 */
export function isPaymentsUiV2Enabled(): boolean {
  return process.env.PAYMENTS_UI_V2 !== "false";
}
