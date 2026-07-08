"use client";

import Link from "next/link";
import { ArrowRight, Video, GraduationCap, ListChecks, MessageCircle, MapPin, Download, Sparkles } from "lucide-react";
import type { ResourceCta } from "@/lib/types";

const ICONS: Record<string, typeof ArrowRight> = {
  webinar: Video,
  course: GraduationCap,
  quiz: ListChecks,
  whatsapp: MessageCircle,
  centre: MapPin,
  pdf: Download,
  custom: Sparkles,
};

function track(kind: string, href: string) {
  try {
    fetch("/api/public/resources/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "cta_click", ref: `${kind}:${href}` }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export default function ResourceCtas({ blocks }: { blocks: ResourceCta[] }) {
  const active = (blocks || []).filter((b) => b.enabled !== false && (b.title || b.href));
  if (active.length === 0) return null;
  return (
    <div className="mt-10 space-y-4">
      {active.map((c, i) => {
        const Icon = ICONS[c.kind] || Sparkles;
        return (
          <div key={i} className="overflow-hidden rounded-2xl border border-[rgba(212,175,55,0.4)] bg-gradient-to-br from-[var(--ca-gold-soft)] to-[#fff8e6] p-6">
            <div className="flex items-start gap-3">
              <span className="ca-icon-chip mt-0.5" style={{ width: 40, height: 40 }}><Icon size={19} strokeWidth={2} /></span>
              <div className="min-w-0 flex-1">
                <h3 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">{c.title}</h3>
                {c.description && <p className="mt-1 text-sm text-[var(--ca-slate-700)]">{c.description}</p>}
                {c.href && (
                  <Link
                    href={c.href}
                    onClick={() => track(c.kind, c.href!)}
                    className="ca-btn ca-btn-gold ca-focus mt-4"
                  >
                    {c.cta_label || "Learn more"} <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
