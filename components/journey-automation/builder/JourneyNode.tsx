"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_ACCENT, NODE_ICON } from "./nodeCatalog";
import { BuilderIcon } from "./builderIcons";

export interface JourneyNodeData extends Record<string, unknown> {
  nodeType: string;
  title: string;
  subtitle?: string;
  hasError?: boolean;
  isTrigger?: boolean;
  isTerminal?: boolean;
}

function JourneyNodeInner({ data, selected }: NodeProps) {
  const d = data as JourneyNodeData;
  const accent = NODE_ACCENT[d.nodeType] ?? "var(--primary)";
  const icon = NODE_ICON[d.nodeType] ?? "Zap";
  return (
    <div
      className="ja-node"
      style={{
        borderColor: d.hasError ? "var(--danger)" : selected ? accent : "var(--line)",
        boxShadow: selected ? `0 0 0 2px ${accent}33, 0 10px 30px rgba(10,31,68,0.12)` : "0 6px 18px rgba(10,31,68,0.08)",
      }}
    >
      {!d.isTrigger && (
        <Handle type="target" position={Position.Top} className="ja-handle" />
      )}
      <div className="ja-node-row">
        <span className="ja-node-icon" style={{ background: `${accent}1a`, color: accent }}>
          <BuilderIcon name={icon} size={15} />
        </span>
        <div className="ja-node-text">
          <div className="ja-node-title">{d.title}</div>
          {d.subtitle ? <div className="ja-node-sub">{d.subtitle}</div> : null}
        </div>
        {d.hasError ? <span className="ja-node-err" title="This node has validation issues">!</span> : null}
      </div>
      {!d.isTerminal && (
        <Handle type="source" position={Position.Bottom} className="ja-handle" />
      )}
    </div>
  );
}

export const JourneyNode = memo(JourneyNodeInner);
