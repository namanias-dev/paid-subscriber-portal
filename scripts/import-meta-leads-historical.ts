/**
 * One-time / on-demand historical Meta Lead Ads import.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/import-meta-leads-historical.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/import-meta-leads-historical.ts --apply
 *
 * Requires META_LEADS_ENABLED=true and all Meta secrets + META_PAGE_ID.
 * Idempotent via leadgen_id unique constraint.
 */

import { listFormLeads, listPageLeadForms, missingMetaConfig } from "../lib/meta/leadAds";
import { ingestCapturedGraphLead } from "../lib/meta/ingestMetaLead";
import { findActiveLeadByPhone } from "../lib/dataProvider";
import { normalizeIndianMobile, normPhone } from "../lib/phone";
import { phoneKeyFromRaw } from "../lib/marketing/legacyLeadMatch";
import { mapFieldData } from "../lib/meta/leadAds";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");
  const missing = missingMetaConfig();
  const pageId = process.env.META_PAGE_ID;
  if (missing.length) {
    console.error("Missing config:", missing.join(", "));
    process.exit(1);
  }
  if (!pageId) {
    console.error("META_PAGE_ID required");
    process.exit(1);
  }

  const started = Date.now();
  const forms = await listPageLeadForms(pageId);
  console.log(`Forms on page ${pageId}: ${forms.length}`);

  const byCampaign = new Map<string, number>();
  const byForm = new Map<string, number>();
  let total = 0;
  let wouldCreate = 0;
  let wouldAttach = 0;
  let alreadyHavePhone = 0;

  type Row = { formId: string; formName: string; graph: Record<string, unknown> };
  const rows: Row[] = [];

  for (const form of forms) {
    // Graph returns newest first; paginate reasonably (historical bulk).
    const leads = await listFormLeads(form.id, { maxPages: 50 });
    byForm.set(form.name, (byForm.get(form.name) || 0) + leads.length);
    for (const g of leads) {
      total += 1;
      const camp = typeof g.campaign_name === "string" ? g.campaign_name : "(unknown)";
      byCampaign.set(camp, (byCampaign.get(camp) || 0) + 1);
      rows.push({ formId: form.id, formName: form.name, graph: g });

      const fields = mapFieldData(
        Array.isArray(g.field_data)
          ? (g.field_data as Array<{ name: string; values?: string[] }>)
          : [],
      );
      const norm = normalizeIndianMobile(fields.phone_number || "");
      const digits = norm.ok && norm.digits10 ? norm.digits10 : normPhone(fields.phone_number) || "";
      const key = phoneKeyFromRaw(digits) || (digits.length === 10 ? digits : "");
      if (key) {
        const existing = await findActiveLeadByPhone(key);
        if (existing) {
          alreadyHavePhone += 1;
          wouldAttach += 1;
        } else {
          wouldCreate += 1;
        }
      }
    }
  }

  console.log("\n=== DRY RUN SUMMARY ===");
  console.log({ total, wouldCreate, wouldAttach, alreadyHavePhone, forms: forms.length });
  console.log("Per form:", Object.fromEntries(byForm));
  console.log("Per campaign:", Object.fromEntries(byCampaign));
  console.log(`Scan runtime: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (dryRun && !apply) {
    console.log("\nDry run only. Re-run with --apply to ingest.");
    return;
  }

  const counts = {
    created: 0,
    attached_existing: 0,
    duplicate: 0,
    failed: 0,
    pending_retry: 0,
  };
  const applyStart = Date.now();
  for (const row of rows) {
    const r = await ingestCapturedGraphLead(
      pageId,
      { ...row.graph, form_id: row.formId },
      { source: "historical_import", form_name: row.formName },
    );
    if (r.outcome in counts) counts[r.outcome as keyof typeof counts] += 1;
  }
  console.log("\n=== APPLY RESULT ===");
  console.log(counts);
  console.log(`Apply runtime: ${((Date.now() - applyStart) / 1000).toFixed(1)}s`);
  console.log(`Total runtime: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
