/**
 * Blocks synthetic/test payment (and related) writes against the live database.
 * Primary gate: NODE_ENV=production (Vercel). Also refuses when a live Supabase URL
 * is configured so local unit tests cannot pollute production (ALLOW_TEST_DB_WRITES=1 to override).
 */
const PLACEHOLDER_PHONES = new Set([
  "9999999999",
  "0000000000",
  "1111111111",
]);

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function isLiveSupabaseConfigured(): boolean {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  return url.length > 0;
}

export function looksLikeTestPayment(input: {
  student_name?: string | null;
  phone?: string | null;
  email?: string | null;
  reference_no?: string | null;
  item_slug?: string | null;
  item?: string | null;
}): boolean {
  const name = (input.student_name || "").trim().toLowerCase();
  const phone = (input.phone || "").replace(/\D/g, "").slice(-10);
  const email = (input.email || "").trim().toLowerCase();
  const ref = (input.reference_no || "").trim().toUpperCase();
  const slug = (input.item_slug || "").trim().toLowerCase();

  if (PLACEHOLDER_PHONES.has(phone)) return true;
  if (/^(test|demo|sample)(\s|$)/i.test(name) || name === "test student") return true;
  if (ref.startsWith("NAMAN-TEST")) return true;
  if (slug === "test-webinar" || slug.startsWith("test-")) return true;
  if (email.endsWith("@guest.namanias.com") && (name.includes("test") || PLACEHOLDER_PHONES.has(phone))) return true;
  if (email.startsWith("test@") || email.startsWith("demo@") || email.includes("+test@")) return true;
  return false;
}

/**
 * Throws when a test-shaped record would be written to live data.
 * Call at the top of createPayment / ensureBuyer (live path only).
 */
export function assertNotTestWriteInProduction(
  kind: "payment" | "buyer",
  input: {
    student_name?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    reference_no?: string | null;
    item_slug?: string | null;
    item?: string | null;
  },
): void {
  const probe = {
    student_name: input.student_name || input.name,
    phone: input.phone,
    email: input.email,
    reference_no: input.reference_no,
    item_slug: input.item_slug,
    item: input.item,
  };
  if (!looksLikeTestPayment(probe)) return;
  if (process.env.ALLOW_TEST_DB_WRITES === "1") return;
  // Prefer NODE_ENV=production; also block against a configured live Supabase URL
  // so NODE_ENV=test scripts cannot insert NAMAN-TEST* into production.
  if (!isProductionRuntime() && !isLiveSupabaseConfigured()) return;
  const err = new Error(
    `Refusing to create test ${kind} against live data (phone=${probe.phone || "?"} name=${probe.student_name || "?"}). Use demo mode, unset Supabase URL, or ALLOW_TEST_DB_WRITES=1.`,
  );
  err.name = "TestRecordBlockedError";
  throw err;
}
