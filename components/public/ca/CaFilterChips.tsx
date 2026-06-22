"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CA_ARTICLE_TYPES, CA_GS_PAPERS } from "@/lib/caConstants";

/** Filter chips that drive the URL searchParams; the server page reads them. */
export default function CaFilterChips() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const activeType = sp.get("type") || "";
  const activeGs = sp.get("gs") || "";
  const activeRel = sp.get("rel") || "";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value && params.get(key) !== value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const chip = (active: boolean) => `ca-filter ca-focus ${active ? "ca-filter--active" : ""}`;

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by type">
        <button className={chip(!activeType)} aria-pressed={!activeType} onClick={() => setParam("type", "")}>All</button>
        {CA_ARTICLE_TYPES.map((t) => (
          <button key={t.value} className={chip(activeType === t.value)} aria-pressed={activeType === t.value} onClick={() => setParam("type", t.value)}>{t.label}</button>
        ))}
      </div>
      <div className="no-scrollbar flex flex-wrap gap-2" role="group" aria-label="Filter by exam relevance and GS paper">
        <button className={chip(activeRel === "prelims")} aria-pressed={activeRel === "prelims"} onClick={() => setParam("rel", "prelims")}>Prelims</button>
        <button className={chip(activeRel === "mains")} aria-pressed={activeRel === "mains"} onClick={() => setParam("rel", "mains")}>Mains</button>
        {CA_GS_PAPERS.map((p) => (
          <button key={p} className={chip(activeGs === p)} aria-pressed={activeGs === p} onClick={() => setParam("gs", p)}>{p}</button>
        ))}
      </div>
    </div>
  );
}
