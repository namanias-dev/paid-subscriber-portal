import React from "react";

/**
 * Minimal, dependency-free markdown renderer for assistant answers. Supports **bold**,
 * _italic_, `code`, "- " bullet lists and "> " notes. Renders via React elements only (no
 * dangerouslySetInnerHTML), so it is XSS-safe by construction.
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null) nodes.push(<strong key={`${keyBase}-b${i}`} className="text-white">{m[2]}</strong>);
    else if (m[3] != null) nodes.push(<em key={`${keyBase}-i${i}`} className="text-muted not-italic opacity-80">{m[3]}</em>);
    else if (m[4] != null) nodes.push(<code key={`${keyBase}-c${i}`} className="aiva-inline-code">{m[4]}</code>);
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderRich(text: string): React.ReactNode {
  const lines = String(text || "").split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets.slice();
    bullets = [];
    blocks.push(
      <ul key={`ul${key++}`} className="my-1.5 space-y-1">
        {items.map((b, idx) => (
          <li key={idx} className="flex gap-2 text-[13.5px] leading-relaxed text-ink">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-royal/80" aria-hidden />
            <span>{renderInline(b, `li${key}-${idx}`)}</span>
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    if (line.trim() === "") continue;
    if (line.startsWith("> ")) {
      blocks.push(
        <p key={`bq${key++}`} className="aiva-answer-note">
          {renderInline(line.slice(2), `bq${key}`)}
        </p>,
      );
      continue;
    }
    blocks.push(
      <p key={`p${key++}`} className="text-[14.5px] leading-relaxed text-ink">
        {renderInline(line, `p${key}`)}
      </p>,
    );
  }
  flushBullets();
  return <div className="space-y-2">{blocks}</div>;
}
