"use client";

/**
 * Tiny helpers shared by public forms — never throw, never block submit.
 */
import { useRef } from "react";
import { ga4FormStart, ga4FormSubmit } from "@/lib/analytics/ga4";

export function useGa4FormTracking(formId: string, formName: string) {
  const started = useRef(false);
  function onFocusCapture() {
    if (started.current) return;
    started.current = true;
    ga4FormStart(formId, formName);
  }
  function trackSubmit(extra: Record<string, unknown> = {}) {
    ga4FormSubmit(formId, formName, extra);
  }
  return { onFocusCapture, trackSubmit };
}
