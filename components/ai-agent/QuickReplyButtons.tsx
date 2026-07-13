"use client";

/** The tappable quick-reply chips beneath the latest agent message. */
import type { QuickReply } from "@/lib/ai-agent/providers/types";

export default function QuickReplyButtons({
  replies,
  disabled,
  onSelect,
}: {
  replies: QuickReply[];
  disabled?: boolean;
  onSelect: (reply: QuickReply) => void;
}) {
  if (!replies || replies.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {replies.map((r) => {
        const variant = r.kind === "primary" ? "cac-chip--primary" : r.kind === "ghost" ? "cac-chip--ghost" : "cac-chip--default";
        return (
          <button
            key={r.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(r)}
            className={`cac-chip ${variant}`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
