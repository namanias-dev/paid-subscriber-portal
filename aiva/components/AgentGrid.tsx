"use client";

import Link from "next/link";
import { useApi } from "@/components/kit";
import type { AgentMeta } from "@/lib/agents/registry";

export default function AgentGrid() {
  const { data } = useApi<{ agents: AgentMeta[] }>("/api/agents");
  const agents = data?.agents || [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => (
        <Link key={a.id} href={a.href} className="aiva-card aiva-card-pad transition hover:border-royal/60">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: a.color }} />
            <span className="font-heading font-bold text-white">{a.name}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{a.blurb}</p>
        </Link>
      ))}
    </div>
  );
}
