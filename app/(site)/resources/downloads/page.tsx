import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Download, FileText } from "lucide-react";
import { getPublicDownloadablePdfs } from "@/lib/dataProvider";
import { resourceMetadata } from "@/lib/resourceView";
import { ACADEMY } from "@/lib/config";
import DownloadsExplorer from "@/components/public/resources/DownloadsExplorer";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return resourceMetadata({
    title: `Free UPSC Downloads — Notes, PDFs & Compilations | ${ACADEMY.shortName}`,
    description:
      "Download free UPSC study material by Naman Sir — monthly current-affairs compilations, daily notes, booklists and revision PDFs. Updated regularly.",
    path: "/resources/downloads",
  });
}

export default async function DownloadsPage() {
  const pdfs = await getPublicDownloadablePdfs();

  return (
    <div className="pb-16">
      {/* Hero */}
      <section className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.18)" }} />
        <div className="container-wide relative py-14 sm:py-16">
          <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-300)]">
            <Link href="/" className="hover:text-white">Home</Link><ChevronRight size={13} />
            <Link href="/resources" className="hover:text-white">Resources</Link><ChevronRight size={13} />
            <span className="text-white/90">Downloads</span>
          </nav>
          <p className="ca-eyebrow flex items-center gap-1.5"><Download size={14} strokeWidth={2} /> Free Downloads</p>
          <h1 className="mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl">
            UPSC downloads — notes, PDFs & compilations
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--ca-slate-300)]">
            Every downloadable file shared by the academy, in one place — monthly current-affairs compilations, daily notes and revision material. Free, updated regularly.
          </p>
        </div>
      </section>

      <div className="container-wide py-12">
        {pdfs.length === 0 ? (
          <div className="py-20 text-center">
            <span className="ca-icon-chip ca-icon-chip--light mx-auto mb-4 flex" style={{ width: 56, height: 56 }}>
              <FileText size={24} strokeWidth={1.5} />
            </span>
            <p className="text-[var(--ca-slate-400)]">Fresh downloads are being prepared. Check back soon.</p>
          </div>
        ) : (
          <DownloadsExplorer pdfs={pdfs} />
        )}
      </div>
    </div>
  );
}
