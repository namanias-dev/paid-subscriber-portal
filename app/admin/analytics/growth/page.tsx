"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import GrowthIntelligence from "@/components/admin/analytics/GrowthIntelligence";

export default function GrowthIntelligencePage() {
  return (
    <div className="space-y-5 pb-16">
      <Link href="/admin/analytics" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft size={15} /> Business Analytics
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Growth Intelligence</h1>
        <p className="text-sm text-muted">
          Acquisition vs conversion attribution by source, plus a campaign link generator so every
          reel, post and channel becomes measurable.
        </p>
      </div>
      <GrowthIntelligence />
    </div>
  );
}
