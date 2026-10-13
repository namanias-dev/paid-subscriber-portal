import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { headObject, publicCdnUrl, r2Configured } from "@/lib/r2";
import {
  estimateCatalogueGb,
  listBandwidthCriticalMediaKeys,
  mediaCdnConfigured,
} from "@/lib/cost/mediaBandwidth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HEAD-only catalogue probe for Fast Origin Transfer forensics.
 * Auth: CRON_SECRET (same as other /api/ops/* tools).
 *
 * Never streams object bodies — metadata only.
 */
export async function GET(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cdnConfigured = mediaCdnConfigured();
  const entries = listBandwidthCriticalMediaKeys();
  const objects: {
    id: string;
    kind: string;
    key: string;
    bytes: number | null;
    wouldRedirectToCdn: boolean;
  }[] = [];

  if (r2Configured()) {
    for (const entry of entries) {
      const head = await headObject(entry.key);
      objects.push({
        id: entry.id,
        kind: entry.kind,
        key: entry.key,
        bytes: head?.contentLength ?? null,
        wouldRedirectToCdn: !!publicCdnUrl(entry.key),
      });
    }
  }

  const known = objects.map((o) => o.bytes).filter((n): n is number => n != null);
  const heavy = objects.filter((o) => o.kind === "teaching_full" || o.kind === "physical_full");
  const heavyBytes = heavy.map((o) => o.bytes).filter((n): n is number => n != null);

  return NextResponse.json(
    {
      ok: true,
      cdnConfigured,
      r2Configured: r2Configured(),
      catalogueObjectCount: entries.length,
      probed: objects.length,
      catalogueTotalGbOnce: Number(estimateCatalogueGb(known).toFixed(3)),
      heavyVideoTotalGbOnce: Number(estimateCatalogueGb(heavyBytes).toFixed(3)),
      guidance: cdnConfigured
        ? "CDN base is set — browsers should hit CDN URLs; /media should 308."
        : "CDN base UNSET — public media streams through Vercel /media (Fast Origin Transfer).",
      objects,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
