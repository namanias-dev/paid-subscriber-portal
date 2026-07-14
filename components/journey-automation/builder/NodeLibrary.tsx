"use client";

import { useMemo, useState } from "react";
import { NODE_CATALOG, NODE_GROUPS, type NodeCatalogItem } from "./nodeCatalog";
import { BuilderIcon } from "./builderIcons";

export default function NodeLibrary({ disabled }: { disabled?: boolean }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return NODE_CATALOG;
    return NODE_CATALOG.filter((n) => `${n.label} ${n.description} ${n.group}`.toLowerCase().includes(t));
  }, [q]);

  function onDragStart(e: React.DragEvent, item: NodeCatalogItem) {
    if (!item.available || disabled) { e.preventDefault(); return; }
    e.dataTransfer.setData("application/journey-node", item.key);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="ja-panel ja-panel-left p-3">
      <input
        className="ja-lib-search"
        placeholder="Search nodes…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search nodes"
      />
      {disabled && (
        <p className="mt-2 text-[11px] text-muted">Read-only: you don&apos;t have edit permission.</p>
      )}
      {NODE_GROUPS.map((group) => {
        const items = filtered.filter((n) => n.group === group);
        if (!items.length) return null;
        return (
          <div key={group}>
            <div className="ja-lib-group-title">{group}</div>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="ja-lib-item"
                draggable={item.available && !disabled}
                data-disabled={!item.available || disabled}
                onDragStart={(e) => onDragStart(e, item)}
                title={item.available ? item.description : item.comingSoonReason || "Coming soon"}
                aria-disabled={!item.available || disabled}
              >
                <span className="ja-lib-ico" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
                  <BuilderIcon name={item.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ja-lib-name block truncate">{item.label}</span>
                  <span className="ja-lib-desc block truncate">{item.description}</span>
                </span>
                {!item.available && <span className="ja-soon">Soon</span>}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
