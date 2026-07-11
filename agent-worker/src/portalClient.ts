/**
 * Portal client — the worker's ONLY channel to the portal. Every request is
 * HMAC-signed over its raw JSON body and sent over HTTPS to the
 * /api/ai-agent/worker/* endpoints. The worker never opens a public endpoint of
 * its own and never exposes Ollama to the internet.
 */
import { buildSignedHeaders } from "./security/hmac.js";
import { log } from "./logger.js";
import type { WorkerConfig } from "./config.js";

export interface MinimizedLead {
  id: string;
  temperature: string;
  score: number;
  status: string;
  target_year: number | null;
  city: string | null;
  offer_interest: unknown[];
  last_seen_at: string;
  created_at: string;
}

export interface LiveOffer {
  type: "course" | "webinar";
  id: string;
  title: string;
  mode: string | null;
  price: number;
  duration: string | null;
  link: string;
}

export interface OffersResponse {
  courses: LiveOffer[];
  webinars: LiveOffer[];
  generated_at: string;
}

export interface SuggestionItem {
  lead_id?: string;
  session_id?: string;
  text: string;
}

export class PortalClient {
  constructor(private cfg: WorkerConfig) {}

  private async post<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T | null> {
    const raw = JSON.stringify(body ?? {});
    const headers = buildSignedHeaders(this.cfg.hmacSecret, raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.cfg.portalBaseUrl}${path}`, {
        method: "POST",
        headers,
        body: raw,
        signal: controller.signal,
      });
      if (res.status === 404) {
        log.warn("Worker endpoints are disabled on the portal (404). Is AI_AGENT_HMAC_SECRET set there?", { path });
        return null;
      }
      if (res.status === 401) {
        log.error("HMAC rejected (401). Check the shared secret + system clock.", { path });
        return null;
      }
      if (!res.ok) {
        log.warn("Portal returned a non-OK status.", { path, status: res.status });
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      log.error("Portal request failed.", { path, error: String(err) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Signed health check. */
  async ping(): Promise<boolean> {
    const res = await this.post<{ ok?: boolean }>("/api/ai-agent/worker/ping", { ping: true });
    return !!res?.ok;
  }

  async getLeads(kind: "hot" | "warm" | "hot_warm" | "all", limit = 25): Promise<MinimizedLead[]> {
    const res = await this.post<{ ok?: boolean; leads?: MinimizedLead[] }>(
      "/api/ai-agent/worker/leads",
      { kind, limit },
    );
    return res?.leads ?? [];
  }

  async getOffers(): Promise<OffersResponse | null> {
    const res = await this.post<{ ok?: boolean; offers?: OffersResponse }>(
      "/api/ai-agent/worker/offers",
      {},
    );
    return res?.offers ?? null;
  }

  async postSuggestions(payload: {
    suggestions?: SuggestionItem[];
    offer_knowledge?: Record<string, unknown>;
  }): Promise<boolean> {
    const res = await this.post<{ ok?: boolean }>("/api/ai-agent/worker/suggestions", payload);
    return !!res?.ok;
  }
}
