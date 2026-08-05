"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InstallmentProofPromptProps } from "@/lib/installmentProofTypes";
import PinnedAccessBar from "./PinnedAccessBar";
export {
  requestInstallmentProofUpload,
  requestInstallmentProofView,
  requestInstallmentAccessRefresh,
} from "./ippEvents";

const H24 = 24 * 60 * 60 * 1000;

type SheetMode = "closed" | "upload" | "view" | "notice";

interface PromptResponse {
  ok: boolean;
  enabled?: boolean;
  prompt?: InstallmentProofPromptProps | null;
}

interface InstallmentAccessCtx {
  prompt: InstallmentProofPromptProps | null;
  enabled: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  openUpload: () => void;
  openView: () => void;
  openNotice: () => void;
  snoozeExpiring: () => void;
  sheetMode: SheetMode;
  setSheetMode: (m: SheetMode) => void;
  barVisible: boolean;
}

const Ctx = createContext<InstallmentAccessCtx | null>(null);

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function isWithin24h(ts: string | null): boolean {
  if (!ts) return false;
  const n = Number(ts);
  return Number.isFinite(n) && Date.now() - n < H24;
}

export function useInstallmentAccess(): InstallmentAccessCtx {
  const v = useContext(Ctx);
  if (!v) {
    return {
      prompt: null,
      enabled: false,
      loading: false,
      refresh: async () => {},
      openUpload: () => {},
      openView: () => {},
      openNotice: () => {},
      snoozeExpiring: () => {},
      sheetMode: "closed",
      setSheetMode: () => {},
      barVisible: false,
    };
  }
  return v;
}

export default function InstallmentAccessShell({ children }: { children?: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallmentProofPromptProps | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheetMode, setSheetMode] = useState<SheetMode>("closed");
  const [snoozeTick, setSnoozeTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/installment-proofs/prompt", { cache: "no-store" });
      const json = (await res.json()) as PromptResponse;
      if (!json.ok || !json.enabled) {
        setEnabled(false);
        setPrompt(null);
        return;
      }
      setEnabled(true);
      setPrompt(json.prompt?.state && json.prompt.state !== "none" ? json.prompt : null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpload = () => setSheetMode("upload");
    const onView = () => setSheetMode("view");
    const onRefresh = () => void refresh();
    window.addEventListener("ipp:open-upload", onUpload);
    window.addEventListener("ipp:open-view", onView);
    window.addEventListener("ipp:refresh", onRefresh);
    return () => {
      window.removeEventListener("ipp:open-upload", onUpload);
      window.removeEventListener("ipp:open-view", onView);
      window.removeEventListener("ipp:refresh", onRefresh);
    };
  }, [refresh]);

  const snoozeExpiring = useCallback(() => {
    if (!prompt || prompt.state !== "expiring") return;
    storageSet(`ipp_snooze_${prompt.enrollmentId}`, String(Date.now()));
    setSnoozeTick((n) => n + 1);
  }, [prompt]);

  const barVisible = useMemo(() => {
    if (!enabled || !prompt) return false;
    if (prompt.state === "expiring") {
      return !isWithin24h(storageGet(`ipp_snooze_${prompt.enrollmentId}`));
    }
    return prompt.state === "blocked" || prompt.state === "pending_review";
  }, [enabled, prompt, snoozeTick]);

  const value = useMemo<InstallmentAccessCtx>(
    () => ({
      prompt,
      enabled,
      loading,
      refresh,
      openUpload: () => setSheetMode("upload"),
      openView: () => setSheetMode("view"),
      openNotice: () => setSheetMode("notice"),
      snoozeExpiring,
      sheetMode,
      setSheetMode,
      barVisible,
    }),
    [prompt, enabled, loading, refresh, snoozeExpiring, sheetMode, barVisible],
  );

  return (
    <Ctx.Provider value={value}>
      {barVisible && prompt && <PinnedAccessBar prompt={prompt} />}
      {children}
    </Ctx.Provider>
  );
}
