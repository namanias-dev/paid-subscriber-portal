"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import AssistantMessage from "./AssistantMessage";
import Composer from "./Composer";
import { SEED_QUESTIONS } from "@/lib/assistant/router";
import type { ChatTurn, DonePayload } from "./types";

let seq = 0;
const uid = () => `t${Date.now()}_${seq++}`;

export default function ChatDesk() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastUserRef = useRef<string>("");

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        composerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patchLast = useCallback((fn: (t: ChatTurn) => ChatTurn) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || streaming) return;
      lastUserRef.current = message;
      setInput("");

      const history = turns.slice(-6).map((t) => ({ role: t.role, content: t.content }));
      const userTurn: ChatTurn = { id: uid(), role: "user", content: message };
      const botTurn: ChatTurn = { id: uid(), role: "assistant", content: "", streaming: true };
      setTurns((prev) => [...prev, userTurn, botTurn]);
      setStreaming(true);
      scrollToEnd();

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, history }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          patchLast((t) => ({ ...t, streaming: false, error: true, content: (j as { error?: string }).error || `Request failed (${res.status}).` }));
          setStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let evt: { type: string; value?: string; payload?: DonePayload; error?: string };
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            if (evt.type === "token" && evt.value) {
              patchLast((t) => ({ ...t, content: t.content + evt.value }));
              scrollToEnd();
            } else if (evt.type === "done" && evt.payload) {
              patchLast((t) => ({ ...t, streaming: false, payload: evt.payload }));
              scrollToEnd();
            } else if (evt.type === "error") {
              patchLast((t) => ({ ...t, streaming: false, error: true, content: t.content || evt.error || "The assistant hit an error." }));
            }
          }
        }
        patchLast((t) => ({ ...t, streaming: false }));
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          patchLast((t) => ({ ...t, streaming: false, content: t.content || "Stopped." }));
        } else {
          patchLast((t) => ({ ...t, streaming: false, error: true, content: "Network error — check your connection and try again." }));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [turns, streaming, patchLast, scrollToEnd],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const empty = turns.length === 0;

  return (
    <div className="aiva-chat">
      <header className="aiva-chat-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="aiva-desk-mark" aria-hidden>◆</div>
          <div className="min-w-0">
            <div className="truncate font-heading text-[15px] font-extrabold leading-tight text-white">AIVA — your command desk</div>
            <div className="truncate text-[11px] text-muted">Chief of Staff · reads the live business, never touches it</div>
          </div>
        </div>
        <span className="aiva-trust-badge" title="AIVA cannot send, pay, edit, enrol or delete.">
          <span className="neural-live-dot" aria-hidden /> Read-only
        </span>
      </header>

      <div className="aiva-chat-body">
        <div className="aiva-chat-column">
          {empty ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="aiva-empty">
              <div className="aiva-empty-mark" aria-hidden>◆</div>
              <h1 className="aiva-empty-title">Good to see you, Aman.</h1>
              <p className="aiva-empty-sub">
                Ask about collections, overdue payments, webinar conversion, batch fill, enrollments, or any student. Every answer is drawn from the live portal data and links you straight to it.
              </p>
              <div className="aiva-empty-chips">
                {SEED_QUESTIONS.map((q) => (
                  <button key={q} className="aiva-chip-suggest" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="space-y-5 py-6">
              <AnimatePresence initial={false}>
                {turns.map((t) =>
                  t.role === "user" ? (
                    <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="aiva-msg aiva-msg-user">
                      <div className="aiva-msg-user-bubble">{t.content}</div>
                    </motion.div>
                  ) : (
                    <AssistantMessage key={t.id} turn={t} onAsk={send} />
                  ),
                )}
              </AnimatePresence>
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      <div className="aiva-composer-dock">
        <div className="aiva-chat-column">
          <Composer
            ref={composerRef}
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={stop}
            streaming={streaming}
            onArrowUp={() => lastUserRef.current && setInput(lastUserRef.current)}
          />
        </div>
      </div>
    </div>
  );
}
