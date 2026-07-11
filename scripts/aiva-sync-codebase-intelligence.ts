/**
 * AIVA — incremental codebase-intelligence sync.
 *
 * On PR / merge / deploy, this:
 *   1. Reads the Git diff from a base ref (default origin/main) to HEAD.
 *   2. Maps changed files to AIVA domains via docs/aiva/CHANGE_IMPACT_RULES.json.
 *   3. Recomputes a manifest hash of docs/aiva/*.
 *   4. In --check mode (CI): fails if a sensitive domain changed but its registry was NOT updated.
 *   5. Optionally records a snapshot in aiva_codebase_snapshots when Supabase env is present.
 *
 * Run:  npx tsx scripts/aiva-sync-codebase-intelligence.ts [--base origin/main] [--check] [--write]
 * No framework required (uses node built-ins; Supabase client loaded lazily).
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

type Rules = {
  domain_paths: Record<string, string[]>;
  ci_fail_conditions: string[];
};

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs", "aiva");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  return def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*");
  return new RegExp("^" + esc);
}

function loadRules(): Rules {
  return JSON.parse(readFileSync(join(DOCS, "CHANGE_IMPACT_RULES.json"), "utf8"));
}

function manifestHash(): string {
  if (!existsSync(DOCS)) return "no-docs";
  const files = readdirSync(DOCS).filter((f) => f.endsWith(".json") || f.endsWith(".md")).sort();
  const h = createHash("sha256");
  for (const f of files) h.update(f).update(readFileSync(join(DOCS, f)));
  return h.digest("hex").slice(0, 16);
}

async function main() {
  const base = arg("base", "origin/main")!;
  const head = sh("git rev-parse HEAD") || "HEAD";
  const range = sh(`git rev-parse --verify ${base}`) ? `${base}...HEAD` : "HEAD~1...HEAD";
  const changed = sh(`git diff --name-only ${range}`).split("\n").filter(Boolean);

  const rules = loadRules();
  const affected = new Set<string>();
  for (const [domain, globs] of Object.entries(rules.domain_paths)) {
    const res = globs.map(globToRegex);
    if (changed.some((f) => res.some((re) => re.test(f)))) affected.add(domain);
  }

  const registryTouched = changed.some((f) => f.startsWith("docs/aiva/"));
  const sensitiveDomains = ["revenue", "enrollments", "auth_rbac", "sms", "events_analytics", "db_schema"];
  const sensitiveChanged = [...affected].filter((d) => sensitiveDomains.includes(d));

  const problems: string[] = [];
  if (sensitiveChanged.length > 0 && !registryTouched) {
    problems.push(
      `Sensitive domain(s) changed [${sensitiveChanged.join(", ")}] but no docs/aiva/ registry was updated. ` +
        `Update the relevant registry and re-run.`,
    );
  }

  const summary = {
    head,
    base,
    changedFiles: changed.length,
    affectedDomains: [...affected],
    manifestHash: manifestHash(),
    status: problems.length ? "fail" : "ok",
    problems,
  };

  console.log("AIVA codebase intelligence sync\n" + JSON.stringify(summary, null, 2));

  if (has("write") && process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(
        (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      await sb.from("aiva_codebase_snapshots").upsert(
        {
          commit_sha: head,
          affected_domains: [...affected],
          manifest_hash: summary.manifestHash,
          status: summary.status,
          validation_results: { problems, changedFiles: changed.length },
        },
        { onConflict: "commit_sha" },
      );
      console.log("Recorded snapshot in aiva_codebase_snapshots.");
    } catch (e) {
      console.warn("Could not write snapshot:", (e as Error).message);
    }
  }

  if (has("check") && problems.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
