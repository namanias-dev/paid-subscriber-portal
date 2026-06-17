"use client";

import { CONTENT_META, contentLink } from "@/lib/contentMeta";
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
    <div className={`card card-hover p-4 ${locked ? "overflow-hidden" : ""}`}>
      <div className={locked ? "pointer-events-none select-none blur-sm" : ""}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{meta.icon}</span>
            <div>
              <h4 className="font-heading text-base leading-snug text-text">
                {item.title}
              </h4>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {item.subject && (
                  <span className="rounded-full bg-[rgba(26,58,107,0.6)] px-2 py-0.5 text-[11px] text-muted">
                    {item.subject}
                  </span>
                )}
                {item.paper && (
                  <span className="rounded-full bg-[rgba(26,58,107,0.6)] px-2 py-0.5 text-[11px] text-muted">
                    {item.paper}
                  </span>
                )}
                <span className="rounded-full bg-[rgba(201,168,76,0.12)] px-2 py-0.5 text-[11px] text-gold-light">
                  {meta.label}
                </span>
              </div>
            </div>
          </div>
          {!locked && <BookmarkButton active={bookmarked} onToggle={onBookmark} />}
        </div>

        {item.description && (
          <p className="mt-3 text-sm text-muted">{item.description}</p>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{formatDate(item.date)}</span>
          {item.duration && <span>{item.duration}</span>}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOpen}
              className="btn-gold flex-1 text-sm"
            >
              {meta.action} →
            </a>
          ) : (
            <span className="btn-outline flex-1 cursor-default text-sm opacity-60">
              Coming soon
            </span>
          )}
          <button
            onClick={onComplete}
            aria-label="Mark complete"
            className="flex h-11 w-11 items-center justify-center rounded-lg border text-lg transition hover:bg-white/5"
            style={{
              borderColor: completed ? "var(--success)" : "var(--border)",
              color: completed ? "var(--success)" : "var(--muted)",
            }}
          >
            {completed ? "✓" : "○"}
          </button>
        </div>
      </div>

      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-[rgba(10,22,40,0.7)] backdrop-blur-sm">
          <span className="text-2xl">🔒</span>
          <a href="/dashboard/profile" className="btn-outline text-xs">
            Renew to Access
          </a>
        </div>
      )}
    </div>
  );
}
