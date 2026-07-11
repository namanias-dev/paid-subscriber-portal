/**
 * Phase 5 verification — Scenarios 16 & 17 (Ollama provider).
 *
 * Runnable dry-run (no real Ollama needed) that proves the guardrail:
 *   16) When Ollama is configured and returns valid polished copy, the provider
 *       improves the WORDING of the guided_flow messages while preserving all
 *       quick replies / cards / step / flow verbatim.
 *   17) When Ollama is unreachable OR times out OR the provider is unset, the
 *       user sees the EXACT guided_flow response with zero failure.
 *
 * We stub global.fetch to simulate Ollama; guided_flow needs no DB (offer
 * resolver returns [] without Supabase). Run:
 *
 *   npx tsx scripts/ai-agent/verify-phase5.ts
 */

import assert from "node:assert";

// Import via the same alias the app uses (tsx reads tsconfig `paths`).
import { getProvider } from "@/lib/ai-agent/providers";
import { runOllama } from "@/lib/ai-agent/providers/ollama";
import { runGuidedFlow } from "@/lib/ai-agent/providers/guidedFlow";
import type { AgentTurnInput } from "@/lib/ai-agent/providers/types";

const deps = { requireConsent: true, hasMarketingConsent: false };
const input: AgentTurnInput = { sessionId: "verify-1", flow: "root", step: "root:menu" };

type FetchImpl = typeof fetch;
const realFetch = global.fetch;

function stubOllama(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): void {
  global.fetch = (async (url: unknown, init?: RequestInit) =>
    handler(String(url), init)) as unknown as FetchImpl;
}
function restoreFetch(): void {
  global.fetch = realFetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function main(): Promise<void> {
  let passed = 0;
  const base = await runGuidedFlow(input, deps);
  assert.ok(base.messages.length > 0, "precondition: guided_flow produced messages");

  // ── Scenario 17a: provider unset → registry returns guided_flow ──────────
  {
    delete process.env.AI_AGENT_PROVIDER;
    delete process.env.OLLAMA_BASE_URL;
    const p = getProvider(process.env.AI_AGENT_PROVIDER);
    assert.strictEqual(p.id, "guided_flow", "unset provider must resolve to guided_flow");
    passed++;
    console.log("PASS 17a: unset provider → guided_flow");
  }

  // ── Scenario 17b: provider=ollama but OLLAMA_BASE_URL unset → falls back ──
  {
    process.env.AI_AGENT_PROVIDER = "ollama";
    delete process.env.OLLAMA_BASE_URL;
    const p = getProvider(process.env.AI_AGENT_PROVIDER);
    assert.strictEqual(p.id, "guided_flow", "ollama without base URL must fall back to guided_flow");
    passed++;
    console.log("PASS 17b: ollama selected but unconfigured → guided_flow");
  }

  // ── Scenario 17c: Ollama configured but UNREACHABLE → base response ───────
  {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:59999"; // nothing listening
    stubOllama(() => Promise.reject(new Error("ECONNREFUSED")));
    const out = await runOllama(input, deps);
    restoreFetch();
    assert.deepStrictEqual(
      out.messages.map((m) => m.text),
      base.messages.map((m) => m.text),
      "unreachable Ollama must yield identical guided_flow messages",
    );
    assert.deepStrictEqual(out.quickReplies, base.quickReplies, "quick replies unchanged");
    passed++;
    console.log("PASS 17c: unreachable Ollama → exact guided_flow response");
  }

  // ── Scenario 17d: Ollama TIMEOUT (never resolves within 8s) → base ────────
  {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.OLLAMA_TIMEOUT_MS = "150"; // shrink the hard timeout for the test
    stubOllama(
      (_, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signal.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    );
    const t0 = Date.now();
    const out = await runOllama(input, deps);
    const elapsed = Date.now() - t0;
    restoreFetch();
    delete process.env.OLLAMA_TIMEOUT_MS;
    assert.deepStrictEqual(
      out.messages.map((m) => m.text),
      base.messages.map((m) => m.text),
      "timeout must yield identical guided_flow messages",
    );
    assert.ok(elapsed < 2000, `timeout fired promptly (elapsed=${elapsed}ms)`);
    passed++;
    console.log(`PASS 17d: Ollama timeout → guided_flow fallback (elapsed=${elapsed}ms)`);
  }

  // ── Scenario 17e: Ollama INVENTS a number → rejected, base returned ───────
  {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    stubOllama(() =>
      jsonResponse({
        message: { content: JSON.stringify({ messages: ["Enroll now for just 4999 rupees!"] }) },
      }),
    );
    const out = await runOllama(input, deps);
    restoreFetch();
    assert.deepStrictEqual(
      out.messages.map((m) => m.text),
      base.messages.map((m) => m.text),
      "output that invents a price/number must be rejected → guided_flow",
    );
    passed++;
    console.log("PASS 17e: invented number rejected → guided_flow");
  }

  // ── Scenario 16: valid polish → wording improves, facts/structure intact ──
  {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    const polished = ["Hi! I'm your UPSC prep guide.", "How can I help you today?"];
    stubOllama((url) => {
      assert.ok(url.includes("/api/chat"), "provider calls Ollama /api/chat");
      return jsonResponse({ message: { content: JSON.stringify({ messages: polished }) } });
    });
    const out = await runOllama(input, deps);
    restoreFetch();

    const changed = out.messages.map((m) => m.text).join(" ") !== base.messages.map((m) => m.text).join(" ");
    assert.ok(changed, "wording should change when a valid polish is returned");
    assert.deepStrictEqual(out.messages.map((m) => m.text), polished, "messages replaced with polished copy");
    // Facts/structure preserved verbatim:
    assert.deepStrictEqual(out.quickReplies, base.quickReplies, "quick replies preserved verbatim");
    assert.deepStrictEqual(out.cards, base.cards, "cards (offer facts) preserved verbatim");
    assert.strictEqual(out.flow, base.flow, "flow preserved");
    assert.strictEqual(out.step, base.step, "step preserved");
    passed++;
    console.log("PASS 16: valid Ollama polish improves wording, preserves facts/structure");
  }

  console.log(`\nAll ${passed} Phase 5 scenario checks passed.`);
}

main().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
