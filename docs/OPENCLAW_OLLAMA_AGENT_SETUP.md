# OpenClaw + Ollama local agent — setup guide (Phase 5, OPTIONAL)

> **This is entirely optional and OFF the critical path.** The live website runs
> on the deterministic `guided_flow` engine and is **not affected** by anything
> in this guide. You can ignore this document and the site keeps working exactly
> as it does today.

This guide sets up a **local** helper that:

1. runs a **local Ollama model** on your machine/server (never on Vercel), and
2. runs the [`agent-worker/`](../agent-worker/README.md) worker, which uses that
   model to draft short internal suggestions and writes them back to the portal
   as **pending items for a human to review**.

Optionally, an LLM-backed **provider** (`AI_AGENT_PROVIDER=ollama`) can polish
the wording of the chat assistant's replies — but only against a **local**
Ollama, and only with a hard 8s timeout + instant fallback to `guided_flow`.

---

## 0. Safety warning (read before you configure anything)

- **Never set `OLLAMA_BASE_URL` in Vercel Production.** `localhost`/`127.0.0.1`
  is unreachable from Vercel's serverless runtime; the provider is written to
  fall back instantly, but the correct posture is simply to leave it unset.
- **Never set `AI_AGENT_HMAC_SECRET` in Vercel Production.** Setting it *enables*
  the worker endpoints. Only set it on a **Preview** deployment (or a private
  environment) while you experiment, and rotate/remove it afterwards.
- **Keep production on `AI_AGENT_PROVIDER=guided_flow`** (or unset — it defaults
  to `guided_flow`).
- The model is **never** the source of truth. Offers/prices/dates always come
  from the server (`offerResolver`). The worker only ever sends **coarse non-PII
  signals** to the model.

### What each new env var does

| Var | Where | Effect if UNSET (default) |
| --- | --- | --- |
| `AI_AGENT_PROVIDER` | portal | `guided_flow` — deterministic engine (production value). |
| `OLLAMA_BASE_URL` | portal (local only) | Ollama provider is **unavailable** → falls back to `guided_flow`. |
| `OLLAMA_MODEL` | portal + worker | Defaults to `llama3.2`. |
| `OLLAMA_TIMEOUT_MS` | portal + worker | Defaults to `8000` (hard cap). |
| `AI_AGENT_HMAC_SECRET` | portal + worker | Worker endpoints return **404** (surface invisible). |
| `AI_AGENT_HMAC_MAX_SKEW_MS` | portal | Defaults to `300000` (5 min). |

> **Production should have NONE of these set** (other than possibly leaving
> `AI_AGENT_PROVIDER` unset/`guided_flow`).

---

## 1. Install Ollama

macOS (Homebrew) or download from <https://ollama.com/download>:

```bash
brew install ollama
# or: curl -fsSL https://ollama.com/install.sh | sh   # Linux
```

Start the server (listens on `http://127.0.0.1:11434` by default):

```bash
ollama serve
```

## 2. Pull a model

A small instruct model is plenty for wording/summarization:

```bash
ollama pull llama3.2          # ~2GB, good default
# alternatives: ollama pull qwen2.5:3b   |   ollama pull mistral
```

Quick sanity check:

```bash
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "llama3.2",
  "stream": false,
  "messages": [{ "role": "user", "content": "Say hello in 5 words." }]
}'
```

## 3. Install OpenClaw (optional orchestrator)

OpenClaw is an optional scheduler/orchestrator. **If OpenClaw isn't available or
you prefer something simpler, skip it** — the worker is a generic Node process
that any scheduler (cron, pm2, launchd, systemd, or OpenClaw) can invoke.

If you use OpenClaw, point it at the worker's one-shot command:

```bash
# Example OpenClaw job command (adjust path):
cd /path/to/naman-ias-portal/agent-worker && npm run once
```

Whatever the orchestrator, the contract is the same: **run
`npm run once` on a schedule** (or `npm run dev` for a always-on loop).

## 4. Configure the worker

```bash
cd agent-worker
cp .env.example .env
```

Edit `.env`:

```dotenv
PORTAL_BASE_URL=https://naman-ias-git-feature-ai-agent-phase5-naman-ias-academy.vercel.app
AI_AGENT_HMAC_SECRET=<same secret you set on the PORTAL preview>
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
OLLAMA_TIMEOUT_MS=8000
WORKER_TASKS=all
WORKER_INTERVAL_MS=900000
```

Generate a strong secret:

```bash
openssl rand -hex 32
```

Set the **same** value as `AI_AGENT_HMAC_SECRET` on the portal **Preview**
environment (Vercel → Project → Settings → Environment Variables → Preview), then
redeploy the preview so it picks up the secret.

Install deps:

```bash
npm install
npm run typecheck
```

## 5. Health check (signed ping)

```bash
npm run ping        # tsx src/index.ts --task=ping --once
```

- `Portal ping OK.` → HMAC secret + clock are correct and endpoints are enabled.
- `404` warning → the portal has **no** `AI_AGENT_HMAC_SECRET` set (endpoints
  disabled — the safe default). Set it on the preview to enable.
- `401` → secret mismatch or clock skew > 5 min. Fix the secret / sync the clock.

## 6. Run the worker

```bash
npm run once        # run every enabled task once, then exit
npm run dev         # 24/7 scheduler (interval from WORKER_INTERVAL_MS)
```

Suggestions land in the portal's **AI Counsellor** admin dashboard
(`ai_followups`, status `pending`) and `ai_agent_settings["ai_offer_knowledge"]`.
**Nothing is auto-sent.**

## 7. (Optional) Enable the wording-polish provider

Only on a **local** or **preview** environment (never production):

```dotenv
AI_AGENT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

The message route will then run `guided_flow` first (authoritative), and ask the
local model to re-word only the message bubbles. On timeout/unreachable/invalid
output it returns the exact `guided_flow` response — see Scenarios 16 & 17 in
`docs/` / the provider source `lib/ai-agent/providers/ollama.ts`.

---

## 8. Optional: expose the portal to a remote worker via Cloudflare Tunnel

If the worker runs on a different machine than the portal (e.g. the portal is a
local dev server), you can use a Cloudflare Tunnel to reach it. **You do NOT need
this for the normal case** where the worker calls the already-public Vercel
preview URL. **Never tunnel Ollama itself to the internet.**

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Protect it with **both** the HMAC signature (already enforced) **and** a
Cloudflare Access policy or a static protected header, e.g. require a header that
your worker sends and Cloudflare validates at the edge. The HMAC check is the
real security boundary; the tunnel header is defense-in-depth.

> Security note: the worker endpoints are already HMAC-gated and disabled without
> a secret. A tunnel only changes *reachability*, not authorization. Do not rely
> on obscurity — keep the secret strong and rotate it.

---

## 9. Run 24/7

### launchd (macOS)

Create `~/Library/LaunchAgents/com.namanias.agentworker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.namanias.agentworker</string>
    <key>WorkingDirectory</key><string>/path/to/naman-ias-portal/agent-worker</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string><string>-lc</string>
      <string>npm run dev</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/agentworker.out.log</string>
    <key>StandardErrorPath</key><string>/tmp/agentworker.err.log</string>
  </dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.namanias.agentworker.plist   # start
launchctl unload ~/Library/LaunchAgents/com.namanias.agentworker.plist # stop
```

### pm2 (cross-platform)

```bash
npm install -g pm2
cd agent-worker
pm2 start "npm run dev" --name ai-agent-worker
pm2 logs ai-agent-worker      # view logs
pm2 restart ai-agent-worker   # restart
pm2 stop ai-agent-worker      # stop
pm2 delete ai-agent-worker    # remove
pm2 save && pm2 startup       # survive reboots
```

### cron (one-shot on a schedule)

```cron
*/15 * * * * cd /path/to/naman-ias-portal/agent-worker && /usr/local/bin/npm run once >> /tmp/agentworker.log 2>&1
```

---

## 10. Stop / restart / disable

- **Stop the worker**: Ctrl-C (foreground), or the pm2/launchd stop commands
  above.
- **Fully disable the whole feature**: remove `AI_AGENT_HMAC_SECRET` from the
  portal environment and redeploy. The worker endpoints return 404 again and the
  worker can do nothing.
- **Disable only the wording polish**: set `AI_AGENT_PROVIDER=guided_flow` (or
  unset it) and unset `OLLAMA_BASE_URL`.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Ping returns 404 | Portal has no `AI_AGENT_HMAC_SECRET` | Set it on the preview + redeploy. |
| Ping returns 401 | Secret mismatch / clock skew | Re-copy the secret; sync clock (NTP). |
| No model output | Ollama not running / model not pulled | `ollama serve`; `ollama pull llama3.2`. |
| Chat wording unchanged | Provider not `ollama` or Ollama down | Expected fallback — this is by design. |
