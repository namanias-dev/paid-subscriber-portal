import { parseConsentCookie, type ConsentState } from "@/lib/attribution";

/**
 * The privacy popup never opens by itself.
 * It opens only when the visitor uses Privacy Settings.
 */
export const PRIVACY_SETTINGS_EVENT = "nsa:open-privacy-settings";

/**
 * Older UI-open flags. They are not accept/reject choices.
 * `nsa_consent` is the real preference cookie and is never cleared here.
 */
export const LEGACY_CONSENT_UI_KEYS = [
  "consent_seen",
  "consent_prompted",
  "show_cookie_banner",
  "privacy_modal_open",
] as const;

export type ConsentPromptReason =
  | "mount"
  | "route"
  | "timer"
  | "scroll"
  | "missing_cookie"
  | "legacy_open"
  | "reload"
  | "privacy_settings";

/** Passive reasons never show the privacy popup. */
export function shouldShowConsentPrompt(reason: ConsentPromptReason | string, _pathname?: string): boolean {
  return reason === "privacy_settings";
}

/**
 * A visitor with no stored choice is not opted in.
 * Returning this null means "do not write a consent cookie".
 */
export function consentChoiceForNewVisitor(): null {
  return null;
}

/** Keep a previously saved accept or reject choice unchanged. */
export function preservedConsentChoice(existing: ConsentState | null | undefined): ConsentState | null {
  if (!existing) return null;
  return {
    analytics: existing.analytics === true,
    marketing: existing.marketing === true,
    version: existing.version,
  };
}

/** Optional browser tools stay off unless that exact choice was saved as true. */
export function optionalTrackingAllowed(
  consent: Pick<ConsentState, "analytics" | "marketing"> | null | undefined,
  kind: "analytics" | "marketing",
): boolean {
  if (!consent) return false;
  return consent[kind] === true;
}

export function readStoredConsent(raw: string | null | undefined): ConsentState | null {
  return parseConsentCookie(raw);
}

type StorageLike = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
};

/** Drop leftover popup-open flags. Does not touch nsa_consent or nsa_attr. */
export function purgeLegacyConsentUiFlags(...stores: Array<StorageLike | null | undefined>): string[] {
  const removed: string[] = [];
  for (const store of stores) {
    if (!store) continue;
    for (const key of LEGACY_CONSENT_UI_KEYS) {
      try {
        if (store.getItem(key) != null) {
          store.removeItem(key);
          removed.push(key);
        }
      } catch {
        /* private mode or blocked storage */
      }
    }
  }
  return removed;
}
