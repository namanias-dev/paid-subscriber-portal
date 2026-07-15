"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_ACCENT, NODE_ICON } from "./nodeCatalog";
import { BuilderIcon } from "./builderIcons";
import { outputHandles, branchDisplayLabel } from "@/lib/journey-automation/builderGraphMap";

export interface JourneyNodeData extends Record<string, unknown> {
  nodeType: string;
  title: string;
  subtitle?: string;
  description?: string;
  hasError?: boolean;
  errorHint?: string;
  isTrigger?: boolean;
  isTerminal?: boolean;
  /** Output handle ids this node exposes (condition/branch). Empty => single. */
  handles?: string[];
}

const HANDLE_TINT: Record<string, string> = { yes: "#16a34a", no: "#dc2626" };

/** Sticky-note annotation — non-executable, no handles. */
function NoteNode({ data, selected }: { data: JourneyNodeData; selected: boolean }) {
  return (
    <div
      className="ja-note-card"
      style={{ boxShadow: selected ? "0 0 0 2px var(--gold), 0 10px 30px rgba(10,31,68,0.14)" : "0 6px 18px rgba(10,31,68,0.10)" }}
    >
      <div className="ja-note-tag"><BuilderIcon name="StickyNote" size={12} /> Note</div>
      <div className="ja-note-body">{data.description || data.subtitle || "Double-click to edit this note"}</div>
    </div>
  );
}

function JourneyNodeInner({ data, selected }: NodeProps) {
  const d = data as JourneyNodeData;
  if (d.nodeType === "note") return <NoteNode data={d} selected={!!selected} />;

  const accent = NODE_ACCENT[d.nodeType] ?? "var(--primary)";
  const icon = NODE_ICON[d.nodeType] ?? "Zap";
  const handles = d.handles ?? outputHandles({ type: d.nodeType, config: {} });
  const labelled = handles.length > 0;

  return (
    <div
      className="ja-node"
      style={{
        borderColor: d.hasError ? "var(--danger)" : selected ? accent : "var(--line)",
        boxShadow: selected ? `0 0 0 2px ${accent}33, 0 10px 30px rgba(10,31,68,0.12)` : "0 6px 18px rgba(10,31,68,0.08)",
        paddingBottom: labelled ? 20 : undefined,
      }}
    >
      {!d.isTrigger && <Handle type="target" position={Position.Top} className="ja-handle" />}

      <div className="ja-node-row">
        <span className="ja-node-icon" style={{ background: `${accent}1a`, color: accent }}>
          <BuilderIcon name={icon} size={15} />
        </span>
        <div className="ja-node-text">
          <div className="ja-node-title">{d.title}</div>
          {d.subtitle ? <div className="ja-node-sub">{d.subtitle}</div> : null}
        </div>
        {d.hasError ? <span className="ja-node-err" title={d.errorHint || "This node has issues to fix"}>!</span> : null}
      </div>

      {d.description ? <div className="ja-node-desc">{d.description}</div> : null}

      {/* Output handles */}
      {!d.isTerminal && !labelled && (
        <Handle type="source" position={Position.Bottom} className="ja-handle" title="Drag to the next step" />
      )}
      {labelled && (
        <div className="ja-node-handles">
          {handles.map((h, i) => {
            const left = ((i + 1) / (handles.length + 1)) * 100;
            const tint = HANDLE_TINT[h] ?? accent;
            return (
              <div key={h} className="ja-hslot" style={{ left: `${left}%` }}>
                <span className="ja-hlabel" style={{ color: tint, borderColor: `${tint}55`, background: `${tint}12` }}>
                  {branchDisplayLabel(h)}
                </span>
                <Handle
                  id={h}
                  type="source"
                  position={Position.Bottom}
                  className="ja-handle ja-handle-lg"
                  style={{ left: `${left}%`, background: tint }}
                  title={`${branchDisplayLabel(h)} path — drag to the next step`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const JourneyNode = memo(JourneyNodeInner);
