"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useState that persists to localStorage under `key`. SSR-safe: renders `initial`
 * on the server and first client paint, then hydrates from storage in an effect
 * (so there's no hydration mismatch). Best-effort — storage errors are swallowed.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch { /* ignore */ }
  }, [key]);

  const set = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key]);

  return [value, set];
}
