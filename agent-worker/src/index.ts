/**
 * Entry point + scheduler for the OPTIONAL local AI Counselor worker.
 *
 * Usage (via package.json scripts or OpenClaw/cron/pm2/launchd):
 *   tsx src/index.ts            # 24/7: ping, run enabled tasks, repeat every interval
 *   tsx src/index.ts --once     # run each enabled task once, then exit
 *   tsx src/index.ts --task=ping --once            # signed connectivity check only
 *   tsx src/index.ts --task=refreshOfferKnowledge  # run a single task on the interval
 *
 * The worker connects to the portal ONLY via HMAC-signed HTTPS. It never opens a
 * public endpoint and never exposes Ollama to the internet. It CANNOT affect the
 * live website: the portal endpoints are disabled unless AI_AGENT_HMAC_SECRET is
 * set, and everything the worker writes is a pending suggestion for human review.
 */
import { loadConfig, ALL_TASKS } from "./config.js";
import { PortalClient } from "./portalClient.js";
import { OllamaClient } from "./ollamaClient.js";
import { log } from "./logger.js";
import type { Task, TaskContext } from "./tasks/context.js";
import { summarizeHotLeads } from "./tasks/summarizeHotLeads.js";
import { generateFollowupSuggestions } from "./tasks/generateFollowupSuggestions.js";
import { refreshOfferKnowledge } from "./tasks/refreshOfferKnowledge.js";
import { watchAbandonedPayments } from "./tasks/watchAbandonedPayments.js";

const TASKS: Record<string, Task> = {
  summarizeHotLeads,
  generateFollowupSuggestions,
  refreshOfferKnowledge,
  watchAbandonedPayments,
};

interface Args {
  once: boolean;
  task: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { once: false, task: null };
  for (const a of argv.slice(2)) {
    if (a === "--once") out.once = true;
    else if (a.startsWith("--task=")) out.task = a.slice("--task=".length).trim();
  }
  return out;
}

async function runOnce(ctx: TaskContext, only: string | null): Promise<void> {
  const names = only
    ? [only]
    : ctx.cfg.tasks.filter((t) => ALL_TASKS.includes(t));

  for (const name of names) {
    const task = TASKS[name];
    if (!task) {
      log.warn("Unknown task — skipping.", { name });
      continue;
    }
    try {
      log.info("Running task.", { name });
      await task(ctx);
    } catch (err) {
      // A task failure must never crash the loop.
      log.error("Task threw — continuing.", { name, error: String(err) });
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const cfg = loadConfig();
  const portal = new PortalClient(cfg);
  const ollama = new OllamaClient(cfg);
  const ctx: TaskContext = { cfg, portal, ollama };

  // 1) Signed connectivity check. If the portal rejects us, don't hammer it.
  const reachable = await portal.ping();
  if (!reachable) {
    log.error("Portal ping failed — check PORTAL_BASE_URL, AI_AGENT_HMAC_SECRET, and that the portal has the secret set.");
    if (args.once || args.task === "ping") process.exit(1);
  } else {
    log.info("Portal ping OK.");
  }

  if (args.task === "ping") {
    process.exit(reachable ? 0 : 1);
  }

  // 2) Warn (don't fail) if Ollama is unreachable — tasks self-skip gracefully.
  if (!(await ollama.isReachable())) {
    log.warn("Ollama is not reachable — tasks will run but produce no model output until it's up.", {
      url: cfg.ollamaBaseUrl,
    });
  }

  if (args.once) {
    await runOnce(ctx, args.task);
    log.info("Done (--once). Exiting.");
    return;
  }

  // 3) 24/7 loop.
  log.info("Starting scheduler.", { intervalMs: cfg.intervalMs, tasks: args.task ? [args.task] : cfg.tasks });
  await runOnce(ctx, args.task);
  setInterval(() => {
    void runOnce(ctx, args.task);
  }, cfg.intervalMs);
}

main().catch((err) => {
  log.error("Fatal worker error.", { error: String(err) });
  process.exit(1);
});
