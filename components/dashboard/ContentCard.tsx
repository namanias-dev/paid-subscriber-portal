"use client";

import { CONTENT_META, contentLink } from "@/lib/contentMeta";
import AppIcon from "@/components/ui/AppIcon";
import { formatDate } from "@/lib/dates";
import BookmarkButton from "@/components/ui/BookmarkButton";
import type { ContentItem } from "@/lib/types";

export default function ContentCard({
  item,
  bookmarked,
  completed,
  locked,
  onBookmark,
  onComplete,
  onOpen,
}: {
  item: ContentItem;
  bookmarked: boolean;
  completed: boolean;
  locked?: boolean;
  onBookmark: () => void;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const meta = CONTENT_META[item.type];
  const link = contentLink(item);

  return (
    <div className={`card card-hover relative p-4 ${locked ? "overflow-hidden" : ""}`}>
      <div className={locked ? "pointer-events-none select-none blur-sm" : ""}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="ca-icon-chip ca-icon-chip--light shrink-0" style={{ width: 40, height: 40 }}><AppIcon name={meta.icon} size={20} /></span>
            <div>
              <h4 className="text-base leading-snug">{item.title}</h4>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {item.subject && <span className="pill pill-gray">{item.subject}</span>}
                {item.paper && <span className="pill pill-gray">{item.paper}</span>}
                <span className="pill pill-blue">{meta.label}</span>
              </div>
            </div>
          </div>
          {!locked && <BookmarkButton active={bookmarked} onToggle={onBookmark} />}
        </div>

        {item.description && <p className="mt-3 text-sm text-ink2">{item.description}</p>}

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{formatDate(item.date)}</span>
          {item.duration && <span>{item.duration}</span>}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={onOpen} className="btn btn-primary flex-1 text-sm">
              {meta.action} →
            </a>
          ) : (
            <span className="btn btn-secondary flex-1 cursor-default text-sm opacity-60">Coming soon</span>
          )}
          <button
            onClick={onComplete}
            aria-label="Mark complete"
            className="flex h-11 w-11 items-center justify-center rounded-xl border text-lg transition hover:bg-surface"
            style={{ borderColor: completed ? "var(--success)" : "var(--line)", color: completed ? "var(--success)" : "var(--muted)" }}
          >
            {completed ? "✓" : "○"}
          </button>
        </div>
      </div>

      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/70 backdrop-blur-sm">
          <span className="text-2xl">🔒</span>
          <a href="/dashboard/profile" className="btn btn-secondary text-xs">Renew to Access</a>
        </div>
      )}
    </div>
  );
}
