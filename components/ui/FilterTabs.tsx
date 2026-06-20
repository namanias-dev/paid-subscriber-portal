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
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`chip ${opt.id === active ? "chip-active" : ""}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
