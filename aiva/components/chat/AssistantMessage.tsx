"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useDrill } from "@/components/drill/DrillProvider";
import OpenInPortal from "@/components/portal/OpenInPortal";
import EvidenceRows from "./EvidenceRows";
import { renderRich } from "./rich";
import type { ChatTurn } from "./types";

/** One assistant answer: grounded text → collapsible Evidence → portal links → follow-up chips. */
export default function AssistantMessage({ turn, onAsk }: { turn: ChatTurn; onAsk: (q: string) => void }) {
  const { openDrill } = useDrill();
  const [open, setOpen] = useState(false);
  const p = turn.payload;
  const hasEvidence = !!p && p.rows.length > 0;
  const hasMore = !!p?.drill && p.rowsTotal > p.rows.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="aiva-msg aiva-msg-assistant"
    >
      <div className="aiva-msg-avatar" aria-hidden>◆</div>
      <div className="aiva-msg-body">
        <div className="aiva-answer">
          {renderRich(turn.content)}
          {turn.streaming ? <span className="aiva-caret" aria-hidden /> : null}
        </div>

        {hasEvidence ? (
          <div className="aiva-evidence">
            <button className="aiva-evidence-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <span className={`aiva-evidence-chev ${open ? "is-open" : ""}`} aria-hidden>▸</span>
              Evidence · {p!.rowsTotal} record{p!.rowsTotal === 1 ? "" : "s"}
            </button>
            {open ? (
              <div className="aiva-evidence-body">
                <EvidenceRows rows={p!.rows} />
                {hasMore ? (
                  <button
                    className="aiva-btn-ghost mt-2 w-full !py-2 text-xs"
                    onClick={() => openDrill({ domain: p!.drill!.domain, metric: p!.drill!.metric, label: p!.drill!.label })}
                  >
                    See all {p!.rowsTotal} records (search + paginate)
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {p && p.links.length > 0 ? (
          <div className="mt-3">
            <div className="aiva-label mb-1.5">Open in portal</div>
            <OpenInPortal links={p.links} />
          </div>
        ) : null}

        {p && p.followups.length > 0 && !turn.streaming ? (
          <div className="aiva-followups">
            {p.followups.map((f) => (
              <button key={f} className="aiva-chip-suggest" onClick={() => onAsk(f)}>
                {f}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
