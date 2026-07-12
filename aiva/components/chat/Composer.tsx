"use client";

import { forwardRef, useEffect, useRef } from "react";

/** The pinned, refined composer: auto-growing textarea, send + streaming-stop, keyboard-first. */
const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSend: () => void;
    onStop: () => void;
    streaming: boolean;
    onArrowUp: () => void;
  }
>(function Composer({ value, onChange, onSend, onStop, streaming, onArrowUp }, ref) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="aiva-composer">
      <div className="aiva-composer-inner">
        <textarea
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
          }}
          className="aiva-composer-input"
          placeholder="Ask AIVA about collections, overdue, webinars, batches, a student…"
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!streaming) onSend();
            } else if (e.key === "ArrowUp" && value === "") {
              e.preventDefault();
              onArrowUp();
            }
          }}
          aria-label="Message AIVA"
        />
        {streaming ? (
          <button className="aiva-send is-stop" onClick={onStop} aria-label="Stop generating">
            <span className="aiva-send-square" aria-hidden />
          </button>
        ) : (
          <button className="aiva-send" onClick={onSend} disabled={!value.trim()} aria-label="Send message">
            ↑
          </button>
        )}
      </div>
      <div className="aiva-composer-hint">
        AIVA is read-only · it can show and link, never send or change · <kbd>Enter</kbd> to send · <kbd>⌘K</kbd> to focus
      </div>
    </div>
  );
});

export default Composer;
