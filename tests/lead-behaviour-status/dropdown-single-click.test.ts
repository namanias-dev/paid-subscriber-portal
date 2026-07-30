/**
 * Documents the Lead CRM status-dropdown single-click contract.
 *
 * Root cause (pre-fix): LeadDetail called setStatus() then onChanged()/reload()
 * immediately. useAdminData.reload set loading=true → page rendered LoadingBlock →
 * LeadDetail unmounted before PATCH resolved → remount re-inited from stale
 * lead.status → first click appeared to fail.
 *
 * The fix keeps local leads state, awaits the PATCH, patches the list from the
 * server response, and never forces a loading unmount on status change.
 */

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE = join(process.cwd(), "app/admin/leads/page.tsx");

describe("lead status dropdown — single-click contract", () => {
  const src = readFileSync(PAGE, "utf8");

  test("setStatus awaits the PATCH and returns the server lead", () => {
    assert.match(src, /async function setStatus\(lead: Lead, status: LeadStatus\): Promise<Lead \| null>/);
    assert.match(src, /await fetch\(`\/api\/admin\/leads\/\$\{lead\.id\}`/);
    assert.match(src, /const updated = json\.lead as Lead/);
    assert.match(src, /setLeads\(\(prev\) => prev\.map/);
  });

  test("does not call reload\(\) or onChanged\(\) from the status select path", () => {
    // The buggy line was: onChange={(e) => { ... setStatus(lead, s); onChanged(); }}
    assert.doesNotMatch(
      src,
      /onChange=\{\(e\) => \{[^}]*setStatus\(lead,\s*s\);[^}]*onChanged\(\)/,
    );
    // Status change handler must await and revert on failure
    assert.match(src, /async function onStatusChange\(next: LeadStatus\)/);
    assert.match(src, /const updated = await setStatus\(lead, next\)/);
    assert.match(src, /if \(!updated\) setLocalStatus\(prev\)/);
  });

  test("loading gate does not blank the page once leads are present", () => {
    assert.match(src, /if \(loading && leads\.length === 0\) return <LoadingBlock \/>/);
  });
});
