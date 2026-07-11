/**
 * Worker configuration, read from the process environment (see .env.example).
 * The worker runs OUTSIDE Vercel; these values live on the operator's machine.
 */

function read(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

function readInt(key: string, fallback: number): number {
  const v = read(key);
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface WorkerConfig {
  portalBaseUrl: string;
  hmacSecret: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  tasks: string[];
  intervalMs: number;
}

const ALL_TASKS = [
  "summarizeHotLeads",
  "generateFollowupSuggestions",
  "refreshOfferKnowledge",
  "watchAbandonedPayments",
];

export function loadConfig(): WorkerConfig {
  const portalBaseUrl = read("PORTAL_BASE_URL");
  const hmacSecret = read("AI_AGENT_HMAC_SECRET");

  if (!portalBaseUrl) throw new Error("PORTAL_BASE_URL is required (see .env.example).");
  if (!hmacSecret) throw new Error("AI_AGENT_HMAC_SECRET is required and must match the portal.");

  const tasksRaw = (read("WORKER_TASKS") || "all").toLowerCase();
  const tasks =
    tasksRaw === "all"
      ? ALL_TASKS
      : tasksRaw
          .split(",")
          .map((t) => t.trim())
          .filter((t) => ALL_TASKS.includes(t));

  return {
    portalBaseUrl: portalBaseUrl.replace(/\/+$/, ""),
    hmacSecret,
    ollamaBaseUrl: (read("OLLAMA_BASE_URL") || "http://127.0.0.1:11434").replace(/\/+$/, ""),
    ollamaModel: read("OLLAMA_MODEL") || "llama3.2",
    ollamaTimeoutMs: Math.min(readInt("OLLAMA_TIMEOUT_MS", 8000), 8000),
    tasks: tasks.length ? tasks : ALL_TASKS,
    intervalMs: Math.max(readInt("WORKER_INTERVAL_MS", 900_000), 60_000),
  };
}

export { ALL_TASKS };
