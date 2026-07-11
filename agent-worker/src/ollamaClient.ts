/**
 * Ollama client — talks to the LOCAL Ollama server only. Every call has a hard
 * timeout and never throws: on any error it returns null and the caller skips
 * the suggestion. The model is ONLY ever asked to summarize / word non-PII
 * signals into short internal notes for a human — it is never a source of truth.
 */
import { log } from "./logger.js";
import type { WorkerConfig } from "./config.js";

export class OllamaClient {
  constructor(private cfg: WorkerConfig) {}

  /**
   * Ask the model for a SHORT plain-text completion. Returns null on
   * timeout/unreachable/error. `maxChars` trims the result defensively.
   */
  async summarize(system: string, user: string, maxChars = 500): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.ollamaTimeoutMs);
    try {
      const res = await fetch(`${this.cfg.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.cfg.ollamaModel,
          stream: false,
          options: { temperature: 0.4, num_predict: 300 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        log.warn("Ollama returned non-OK.", { status: res.status });
        return null;
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data?.message?.content;
      if (!content || typeof content !== "string") return null;
      return content.trim().slice(0, maxChars);
    } catch (err) {
      log.warn("Ollama call failed (timeout/unreachable) — skipping.", { error: String(err) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Best-effort reachability probe. */
  async isReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${this.cfg.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
