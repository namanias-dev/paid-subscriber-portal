#!/usr/bin/env node
/**
 * Production release helper. See docs/PRODUCTION_RELEASE.md.
 *
 *   npm run release:check                       live SHA, candidate diff, write-guard env, tests, typecheck, build
 *   npm run release:smoke -- <deployment-url>   read-only route smoke (protected previews via `vercel curl`)
 *   npm run release:prod -- <preview-url>       record rollback target, promote the tested preview, verify
 *   npm run release:verify -- <sha>             live SHA + public/changed-route smoke + error logs
 *   npm run release:rollback -- <deployment>    re-promote a known-good deployment, verify
 *
 * Every HTTP call here is GET. Nothing writes to Supabase, R2, Shiprocket,
 * Delhivery or Eazypay. Exits non-zero when the release is unhealthy.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const SCOPE = "naman-ias-academy";
const SITE = "https://www.namanias.com";
const PUBLIC_ROUTES = ["/", "/notes", "/notes/cart", "/notes/checkout", "/notes/track", "/courses"];
// Admin routes must answer 200 with the gated shell (no session). Feature routes join via RELEASE_ROUTES.
const ADMIN_ROUTES = ["/admin", "/admin/notes", "/admin/notes/analytics?range=30d"];
const ERROR_MARKERS = /application error|internal server error/i;

const [, , command, arg] = process.argv;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✔ ${message}`);
}

async function liveSha() {
  const res = await fetch(`${SITE}/api/version`, { cache: "no-store" });
  const body = await res.json();
  return String(body.version || "");
}

function routes() {
  const extra = (process.env.RELEASE_ROUTES || "").split(",").map((r) => r.trim()).filter(Boolean);
  return [...PUBLIC_ROUTES, ...ADMIN_ROUTES, ...extra];
}

/** GET a path on a deployment. Protected previews go through `vercel curl` (uses the CLI login). */
function get(base, path) {
  const viaCli = base !== SITE;
  const out = viaCli
    ? spawnSync("vercel", ["curl", path, "--deployment", base, "--scope", SCOPE, "--", "-s", "-w", "\n%{http_code}"], { encoding: "utf8" })
    : spawnSync("curl", ["-s", "-w", "\n%{http_code}", `${base}${path}`], { encoding: "utf8" });
  const text = out.stdout || "";
  const cut = text.lastIndexOf("\n");
  return { status: Number(text.slice(cut + 1)), body: text.slice(0, cut) };
}

function smoke(base) {
  let healthy = true;
  for (const path of routes()) {
    const { status, body } = get(base, path);
    const bad = status >= 500 || status === 0 || ERROR_MARKERS.test(body);
    if (bad) healthy = false;
    console.log(`${bad ? "✖" : "✔"} ${String(status).padEnd(4)} ${path}`);
  }
  const version = get(base, "/api/version");
  console.log(`  version ${version.body.trim()}`);
  return { healthy, version: version.body };
}

function errorLogs(since) {
  const out = spawnSync("vercel", ["logs", "--environment", "production", "--since", since, "--level", "error", "--non-interactive", "--scope", SCOPE], { encoding: "utf8" });
  const lines = (out.stdout || "").split("\n").filter((line) => /\d{2}:\d{2}:\d{2}/.test(line));
  return lines;
}

async function check() {
  if (existsSync(".env.local") || process.env.NEXT_PUBLIC_SUPABASE_URL) {
    fail("Supabase env is present. Tests must run in demo mode so they cannot touch the production database. Move .env.local aside.");
    return;
  }
  if (process.env.ALLOW_TEST_DB_WRITES === "1" || process.env.NOTES_STORE_SHIPPING_WRITES === "1") {
    fail("A production write override is set (ALLOW_TEST_DB_WRITES / NOTES_STORE_SHIPPING_WRITES). Unset it for release checks.");
    return;
  }
  const live = await liveSha();
  sh("git", ["fetch", "--quiet", "--all", "--prune"]);
  const head = sh("git", ["rev-parse", "HEAD"]);
  console.log(`live ${live} · candidate ${head.slice(0, 12)} · branch ${sh("git", ["branch", "--show-current"])}`);
  try {
    sh("git", ["merge-base", "--is-ancestor", live, "HEAD"]);
    ok("candidate contains the live production commit");
  } catch {
    fail(`candidate does not contain live ${live}. Start from the live SHA.`);
    return;
  }
  const removed = sh("git", ["diff", "--name-only", "--diff-filter=D", live, "HEAD"]).split("\n").filter(Boolean);
  const sensitive = removed.filter((file) => /^(app|lib|supabase\/migrations|components)\//.test(file));
  if (sensitive.length) fail(`candidate deletes live files, review before shipping:\n  ${sensitive.join("\n  ")}`);
  else ok("no app/lib/component/migration files removed versus live");
  const added = sh("git", ["diff", "--name-only", "--diff-filter=A", live, "HEAD", "--", "supabase/migrations"]).split("\n").filter(Boolean);
  if (added.length) console.log(`  new migrations (apply before promoting, additive only):\n  ${added.join("\n  ")}`);
  for (const [label, cmd, args] of [
    ["typecheck", "npx", ["tsc", "--noEmit"]],
    ["tests", "npm", ["test", "--silent"]],
    ["build", "npm", ["run", "build", "--silent"]],
  ]) {
    const run = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const output = `${run.stdout}\n${run.stderr}`;
    const fails = [...output.matchAll(/^✖ (.+?) \([\d.]+ms\)$/gm)].map((m) => m[1]);
    console.log(`${run.status === 0 ? "✔" : "•"} ${label} exit ${run.status}${fails.length ? ` · ${fails.length} failing tests (compare with the live SHA baseline)` : ""}`);
    if (label !== "tests" && run.status !== 0) fail(`${label} failed`);
  }
}

function deployment(idOrUrl) {
  const key = String(idOrUrl).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const d = JSON.parse(sh("vercel", ["api", `/v13/deployments/${key}`, "--scope", SCOPE]));
  return { id: d.id, state: d.readyState, sha: d.meta?.githubCommitSha || "", target: d.target || "preview" };
}

async function prod(previewUrl) {
  if (!previewUrl) return fail("usage: release:prod -- <tested preview deployment url>");
  const before = await liveSha();
  const current = sh("vercel", ["inspect", SITE, "--scope", SCOPE]).match(/id\s+(dpl_\w+)/)?.[1];
  console.log(`rollback target ${current} (${before})`);
  const startedAt = new Date().toISOString();
  if (deployment(previewUrl).state !== "READY") return fail("candidate preview is not READY; not promoting");
  const promote = spawnSync("vercel", ["promote", previewUrl, "--scope", SCOPE, "--yes"], { encoding: "utf8", stdio: "inherit" });
  if (promote.status !== 0) return fail("promote failed; production unchanged");
  const candidate = deployment(previewUrl);
  if (candidate.state !== "READY") return fail(`candidate is ${candidate.state}, not READY; not promoting`);
  await verify(candidate.sha, startedAt, current);
}

async function verify(expectedSha, since = "15m", rollbackTarget = null) {
  let live = "";
  for (let i = 0; i < 36; i += 1) {
    live = await liveSha();
    if (!expectedSha || live && expectedSha.startsWith(live.slice(0, 7))) break;
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (expectedSha && !expectedSha.startsWith(live.slice(0, 7))) fail(`live ${live} is not the expected ${expectedSha}`);
  else ok(`live version ${live}`);
  const { healthy } = smoke(SITE);
  if (!healthy) fail("production smoke failed");
  const errors = errorLogs(since);
  if (errors.length) fail(`${errors.length} error-level log lines since ${since}:\n  ${errors.slice(0, 10).join("\n  ")}`);
  else ok(`no error-level runtime logs since ${since}`);
  if (process.exitCode && rollbackTarget) {
    console.error(`rolling back to ${rollbackTarget}`);
    await rollback(rollbackTarget);
  }
}

async function rollback(target) {
  if (!target) return fail("usage: release:rollback -- <known-good deployment id or url>");
  const run = spawnSync("vercel", ["rollback", target, "--scope", SCOPE, "--yes"], { encoding: "utf8", stdio: "inherit" });
  if (run.status !== 0) return fail("rollback failed");
  const { healthy } = smoke(SITE);
  if (!healthy) fail("rollback smoke failed");
}

if (command === "check") await check();
else if (command === "smoke") {
  if (!arg) fail("usage: release:smoke -- <deployment url>");
  else if (!smoke(arg).healthy) fail("smoke failed");
} else if (command === "prod") await prod(arg);
else if (command === "verify") await verify(arg);
else if (command === "rollback") await rollback(arg);
else fail("commands: check | smoke <url> | prod <preview-url> | verify [sha] | rollback <deployment>");
