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
    <div className="flex flex-wrap gap-1.5">
      {replies.map((r) => {
        const primary = r.kind === "primary";
        const ghost = r.kind === "ghost";
        return (
          <button
            key={r.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(r)}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
            style={
              primary
                ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
                : ghost
                ? { background: "transparent", color: "var(--ink2)", borderColor: "var(--line)" }
                : { background: "var(--primary-tint)", color: "var(--primary)", borderColor: "transparent" }
            }
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
