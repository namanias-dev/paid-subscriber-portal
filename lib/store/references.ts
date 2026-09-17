/**
 * Notes Store reference namespace. ISOLATION LAYER 4 of 4 (primary).
 *
 * The store shares the Eazypay merchant AND the Eazypay return URL with course
 * payments, because ICICI will not issue a second return URL or SubMerchantId.
 * The reference namespace is therefore what keeps the two money domains apart at
 * the routing layer:
 *
 *   store references ALWAYS start with `NIASN-N-`
 *   course references start with NAMAN- / OFF- / LEGACY- / SAARTHI-
 *
 * That prefix set was verified exhaustively against production before this was
 * written: across all 2,429 rows in public.payments the only first segments are
 * NAMAN (1,982), OFF (194), LEGACY (172) and SAARTHI (81). `NIASN` collides with
 * nothing, historically or structurally.
 *
 * Every store entry point re-checks the prefix. The callback route rejects a
 * non-store reference, the store Verify cron selects only store references, and
 * a store reference seen on a course path is recorded and alerted rather than
 * silently ignored — silent misrouting is the failure that takes weeks to find.
 */

/** The one true prefix. Nothing else may be treated as a store reference. */
export const STORE_REFERENCE_PREFIX = "NIASN-N-";

/** Anchored so a course reference containing the substring can never match. */
const STORE_REFERENCE_RE = /^NIASN-N-[A-Z0-9]{4,}-[A-Z0-9]{2,}$/;

/**
 * Prefix test used by routing and by the cron filters. Deliberately loose about
 * the tail (a hand-typed admin reference should still route to the store) but
 * strict about the prefix, which is the isolation guarantee.
 */
export function isStoreReference(reference: string | null | undefined): boolean {
  const ref = (reference || "").trim().toUpperCase();
  return ref.startsWith(STORE_REFERENCE_PREFIX) && ref.length > STORE_REFERENCE_PREFIX.length;
}

/** Strict shape test, for validating what we ourselves generated. */
export function isWellFormedStoreReference(reference: string | null | undefined): boolean {
  return STORE_REFERENCE_RE.test((reference || "").trim().toUpperCase());
}

/**
 * The SQL prefix pattern for store reference queries, so the store cron and the
 * store ledger use one definition rather than a literal sprinkled about.
 */
export const STORE_REFERENCE_SQL_LIKE = `${STORE_REFERENCE_PREFIX}%`;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1

function randomToken(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Build a store payment reference: `NIASN-N-<base36 ts>-<random6>`.
 *
 * Uniqueness has three independent guarantees, in ascending strength: a
 * millisecond timestamp, six random characters from a 31-character alphabet, and
 * a unique index on store_order_payments.reference_no. Callers still retry on
 * the (vanishingly unlikely) insert conflict — the same belt-and-braces the
 * course path uses.
 *
 * Length stays well inside Eazypay's reference field: 8 + 9 + 1 + 6 ≈ 24 chars.
 */
export function makeStoreReference(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `${STORE_REFERENCE_PREFIX}${ts}-${randomToken(6)}`;
}
