"use client";

export interface TabOption {
  id: string;
  label: string;
}

export default function FilterTabs({
  options,
  active,
  onChange,
}: {
  options: TabOption[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {options.map((opt) => {
        const isActive = opt.id === active;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className="whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition"
            style={{
              minHeight: 40,
              background: isActive
                ? "linear-gradient(135deg,#c9a84c,#e8c96a)"
                : "transparent",
              color: isActive ? "#0a1628" : "var(--muted)",
              borderColor: isActive ? "transparent" : "var(--border)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
