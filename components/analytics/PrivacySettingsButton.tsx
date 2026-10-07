"use client";

import { PRIVACY_SETTINGS_EVENT } from "@/lib/analytics/consentPrompt";

/** Opens the existing privacy choices panel. Never opens it on its own. */
export default function PrivacySettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className || "bg-transparent p-0 text-left text-inherit hover:text-primary"}
      onClick={() => window.dispatchEvent(new Event(PRIVACY_SETTINGS_EVENT))}
    >
      Privacy Settings
    </button>
  );
}
