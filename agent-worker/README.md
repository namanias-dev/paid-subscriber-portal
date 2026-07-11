# Naman IAS — AI Counselor local worker (OPTIONAL, Phase 5)

A small, standalone Node/TypeScript worker that runs on **your machine or server
— never on Vercel**. It uses a **local Ollama model** to draft short, internal
suggestions (lead prioritization notes, follow-up drafts, offer summaries,
gentle payment-recovery nudges) and writes them back to the portal as **pending
suggestions for a human to review**.

## Safety model (read this first)

- This worker **cannot affect the live website**. It only calls the HMAC-gated
  `/api/ai-agent/worker/*` endpoints, which are **disabled (404)** unless
  `AI_AGENT_HMAC_SECRET` is set on the portal.
- It only ever sends **coarse, non-PII signals** to the model (temperature,
  score, target year, city category, offer interest). **Never** phone / email /
  name / free text.
- The model is **never a source of truth**. Offers/prices/dates come from the
  portal's `offerResolver` and are stored verbatim; the model only writes
  human-facing summaries.
- **Nothing is auto-sent.** Everything the worker writes lands in `ai_followups`
  as `status: "pending"` (or in `ai_agent_settings`) for a counselor to review.
- The worker **never opens a public endpoint** and **never exposes Ollama to the
  internet**.

## This is a separate project

`agent-worker/` has its own `package.json` / `tsconfig.json` and is **excluded
from the Next.js build** (see the repo root `tsconfig.json` `exclude`). Installing
its dependencies does not touch the site.

## Quick start

```bash
cd agent-worker
cp .env.example .env      # then fill in AI_AGENT_HMAC_SECRET (+ PORTAL_BASE_URL)
npm install
npm run typecheck         # tsc --noEmit
npm run ping              # signed connectivity check against the portal
npm run once              # run every enabled task once, then exit
npm run dev               # 24/7 scheduler (Ctrl-C to stop)
```

See [`../docs/OPENCLAW_OLLAMA_AGENT_SETUP.md`](../docs/OPENCLAW_OLLAMA_AGENT_SETUP.md)
for installing Ollama, pulling a model, wiring OpenClaw/cron/pm2/launchd, an
optional Cloudflare Tunnel, and running 24/7.

## Environment

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `PORTAL_BASE_URL` | yes | — | HTTPS URL of the portal (preview/prod). |
| `AI_AGENT_HMAC_SECRET` | yes | — | Must match the portal's secret exactly. |
| `OLLAMA_BASE_URL` | no | `http://127.0.0.1:11434` | Local Ollama server. |
| `OLLAMA_MODEL` | no | `llama3.2` | Any pulled Ollama model tag. |
| `OLLAMA_TIMEOUT_MS` | no | `8000` | Hard per-call timeout (capped at 8s). |
| `WORKER_TASKS` | no | `all` | Comma list or `all`. |
| `WORKER_INTERVAL_MS` | no | `900000` | 24/7 loop interval (min 60s). |

## Tasks

| Task | What it does |
| --- | --- |
| `summarizeHotLeads` | One-line priority note per hot/warm lead → pending suggestions. |
| `generateFollowupSuggestions` | Draft next-step per warm lead → pending suggestions. |
| `refreshOfferKnowledge` | Summarize live offers → `ai_agent_settings["ai_offer_knowledge"]`. |
| `watchAbandonedPayments` | Gentle recovery draft for interested-but-not-converted leads. |

## CLI

```bash
tsx src/index.ts                          # 24/7, all enabled tasks
tsx src/index.ts --once                   # run once, then exit
tsx src/index.ts --task=ping --once       # signed health check only
tsx src/index.ts --task=refreshOfferKnowledge   # single task on the interval
```

Every task is wrapped in try/catch — one failure never crashes the loop, and if
Ollama is down the tasks simply produce no output.
