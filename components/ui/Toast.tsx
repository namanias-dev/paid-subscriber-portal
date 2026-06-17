"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastType = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-20 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-slide-up rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur"
            style={{
              background: "rgba(17,34,64,0.95)",
              borderColor:
                t.type === "error"
                  ? "rgba(231,76,60,0.6)"
                  : t.type === "success"
                  ? "rgba(46,204,113,0.6)"
                  : "var(--gold)",
              color:
                t.type === "error"
                  ? "#ff9a8f"
                  : t.type === "success"
                  ? "#7ee2a8"
                  : "var(--gold-light)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
