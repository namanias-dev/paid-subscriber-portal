"use client";

export default function BookmarkButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={active ? "Remove bookmark" : "Add bookmark"}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition hover:bg-surface"
      style={{ color: active ? "var(--primary)" : "var(--muted)" }}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
