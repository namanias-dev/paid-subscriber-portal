import { requireApiSession } from "@/lib/guard";
import { writeAudit } from "@/lib/audit";
import { runTurn } from "@/lib/assistant/engine";
import type { ChatMessage } from "@/lib/assistant/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/assistant/chat — the read-only executive assistant. Super-Admin only, rate-limited.
 * Streams an NDJSON event sequence: meta → token* → done. Every answer is composed from
 * whitelisted data tools (see lib/assistant), so numbers reconcile and nothing is hallucinated.
 * AIVA performs NO writes here; the only DB writes in this project are the best-effort audit log.
 */

const MAX_MESSAGE = 2000;
const RATE_LIMIT = 20; // requests
const RATE_WINDOW = 60_000; // per minute, per admin (best-effort, per-instance)
const hits = new Map<string, number[]>();

function rateLimited(adminId: string): boolean {
  const now = Date.now();
  const arr = (hits.get(adminId) || []).filter((t) => now - t < RATE_WINDOW);
  arr.push(now);
  hits.set(adminId, arr);
  return arr.length > RATE_LIMIT;
}

function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw.slice(-8)) {
    const role = (item as { role?: string })?.role;
    const content = (item as { content?: string })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      out.push({ role, content: content.slice(0, MAX_MESSAGE) });
    }
  }
  return out;
}

export async function POST(req: Request) {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;

  if (rateLimited(gate.session.admin_id)) {
    return new Response(JSON.stringify({ ok: false, error: "Rate limit exceeded. Please slow down." }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  let body: { message?: string; history?: unknown };
  try {
    body = (await req.json()) as { message?: string; history?: unknown };
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body." }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const message = String(body.message || "").slice(0, MAX_MESSAGE).trim();
  const history = sanitizeHistory(body.history);
  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: "message is required" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const started = Date.now();
  const encoder = new TextEncoder();
  const write = (obj: unknown) => encoder.encode(JSON.stringify(obj) + "\n");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const turn = await runTurn(message, history);
        controller.enqueue(write({ type: "meta", planner: turn.planner, refused: turn.refused, readOnly: true }));

        // Stream the answer token-by-token (word chunks) for a live typing feel.
        const tokens = turn.answer.match(/\S+\s*|\s+/g) || [turn.answer];
        for (const t of tokens) {
          controller.enqueue(write({ type: "token", value: t }));
          if (tokens.length < 400) await new Promise((r) => setTimeout(r, 8));
        }

        controller.enqueue(
          write({
            type: "done",
            payload: {
              tool: turn.tool,
              figures: turn.figures,
              rows: turn.rows,
              rowsTotal: turn.rowsTotal,
              drill: turn.drill,
              links: turn.links,
              provenance: turn.provenance,
              notes: turn.notes,
              followups: turn.followups,
              refused: turn.refused,
            },
          }),
        );

        await writeAudit({
          actor_id: gate.session.admin_id,
          actor_username: gate.session.username,
          action: "assistant:chat",
          outcome: "read",
          meta: { q: message.slice(0, 200), tool: turn.tool, planner: turn.planner, refused: turn.refused, latencyMs: Date.now() - started },
        });
      } catch (e) {
        controller.enqueue(write({ type: "error", error: e instanceof Error ? e.message : "assistant failed" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
