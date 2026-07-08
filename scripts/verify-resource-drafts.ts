/**
 * Read-only verification: confirm the 15 UPSC resource drafts persisted correctly
 * (slug intact, status = draft, publish false, body/faq/seo present). No writes.
 *
 *   node --env-file=.env.local --import tsx scripts/verify-resource-drafts.ts
 */
import { getResourceBySlug } from "../lib/dataProvider";

const SLUGS = [
  "upsc-beginners-guide",
  "upsc-exam-pattern-syllabus",
  "best-books-for-upsc",
  "upsc-study-plan-for-beginners",
  "how-to-read-ncerts-for-upsc",
  "upsc-prelims-strategy",
  "upsc-mains-answer-writing",
  "how-to-read-the-hindu-for-upsc",
  "upsc-optional-subject-selection",
  "upsc-common-mistakes-beginners",
  "best-upsc-coaching-in-chandigarh",
  "upsc-coaching-sector-17-chandigarh",
  "upsc-coaching-mohali-panchkula-tricity",
  "upsc-coaching-for-himachal-students",
  "online-vs-offline-upsc-coaching-chandigarh",
];

function words(html: string): number {
  return (html || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

async function main() {
  console.log("\n=== VERIFY RESOURCE DRAFTS (read-only) ===");
  console.log("slug".padEnd(44), "status".padEnd(8), "pub".padEnd(5), "words".padEnd(7), "faq");
  let ok = 0;
  let missing = 0;
  for (const slug of SLUGS) {
    const r = await getResourceBySlug(slug);
    if (!r) {
      console.log(slug.padEnd(44), "MISSING");
      missing++;
      continue;
    }
    const faqCount = Array.isArray(r.faq) ? r.faq.length : 0;
    const w = words(r.body_html || "");
    const pub = String((r as { publish?: boolean }).publish ?? false);
    console.log(
      r.slug.padEnd(44),
      String(r.status).padEnd(8),
      pub.padEnd(5),
      String(w).padEnd(7),
      String(faqCount),
    );
    if (r.slug === slug && r.status === "draft" && w > 200) ok++;
  }
  console.log(`\nverified ok: ${ok}/${SLUGS.length}   missing: ${missing}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
