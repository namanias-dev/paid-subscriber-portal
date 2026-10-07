"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
] as const;

/**
 * Range chips and the custom form. One date range drives every cohort section.
 * While the next range loads, the current numbers stay on screen, slightly dimmed.
 */
export default function AnalyticsShell({ range, header, children }: { range: string; header: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => start(() => router.push(href, { scroll: false }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") || "");
    const to = String(data.get("to") || "");
    if (!from || !to) return;
    go(`/admin/notes/analytics?range=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  };

  return (
    <>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {header}
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map(([key, text]) => (
            <a
              key={key}
              href={`/admin/notes/analytics?range=${key}`}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                go(`/admin/notes/analytics?range=${key}`);
              }}
              aria-current={range === key ? "page" : undefined}
              className={`ca-focus min-h-10 rounded-full px-3 py-2 text-sm font-semibold ${range === key ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}
            >
              {text}
            </a>
          ))}
          <form action="/admin/notes/analytics" onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="range" value="custom" />
            <input type="date" name="from" required aria-label="From" className="min-h-10 rounded-full border border-ca-navy/10 bg-white px-3 text-sm" />
            <input type="date" name="to" required aria-label="To" className="min-h-10 rounded-full border border-ca-navy/10 bg-white px-3 text-sm" />
            <button type="submit" className={`min-h-10 rounded-full px-3 text-sm font-semibold ${range === "custom" ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>Custom</button>
          </form>
          <span role="status" aria-live="polite" className={`text-xs font-semibold text-ca-navy/55 transition-opacity ${pending ? "opacity-100" : "opacity-0"}`}>
            {pending ? "Updating…" : ""}
          </span>
        </div>
      </header>
      <div aria-busy={pending} className={`transition-opacity duration-200 motion-reduce:transition-none ${pending ? "opacity-60" : "opacity-100"}`}>
        {children}
      </div>
    </>
  );
}
