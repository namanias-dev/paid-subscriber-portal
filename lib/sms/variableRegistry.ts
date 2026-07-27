/**
 * CANONICAL VARIABLE REGISTRY — the single source of truth mapping a body token
 * to the value that fills it.
 *
 * WHY AN ALIAS TABLE EXISTS
 * -------------------------
 * A DLT-approved template body is a legal artefact: the text we send must be
 * BYTE-IDENTICAL to the registration the provider holds, or the sender ID gets
 * blocked. The approved "Installment Reminder" body (DLT 1777178513223214410)
 * spells its variables `{No_of_Installment}` and `{Fee_in_Rs}` — spellings no
 * other template uses and that our resolver had no value for. Renaming the
 * tokens to match our code would have been the easy fix and is FORBIDDEN.
 *
 * So the mapping goes the other way: this registry names each variable once,
 * canonically, and lists every spelling that must resolve to it. Adding a new
 * DLT template with yet another spelling means adding one alias here — never
 * touching a body.
 *
 * MATCHING is case-insensitive and space/underscore/dot/hyphen-insensitive, so
 * `{No of Installment}`, `{No_of_Installment}` and `{no.of.installment}` all
 * land on the same canonical variable.
 *
 * LOOKUP PRECEDENCE is deliberate and load-bearing: an EXACT key match in the
 * caller's vars always wins over any alias. That is what guarantees every
 * template that rendered before this registry existed renders byte-identically
 * — aliases can only fill a token that would otherwise have resolved to nothing.
 */

/** A value that did not really resolve. Strings are trimmed before the check. */
const UNRESOLVED_TEXT = new Set(["", "undefined", "null", "nan", "none"]);

/**
 * True when a raw variable value is a real, sendable value. Rejects null/undefined,
 * blank strings, NaN, and the string forms of those — `"undefined"` reaching a
 * student's handset is the same defect as `{Fee_in_Rs}` reaching it.
 */
export function isResolvedValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return !UNRESOLVED_TEXT.has(String(v).trim().toLowerCase());
}

/**
 * Canonical form of a token or vars-map key. Lower-cases and folds every
 * word separator we have seen in a DLT body to a single underscore.
 */
export function canonicalizeToken(token: string): string {
  return String(token)
    .trim()
    .toLowerCase()
    .replace(/[\s.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export interface RegisteredVariable {
  /** Canonical key — how the rest of the codebase refers to this variable. */
  key: string;
  label: string;
  /** What fills it, in staff-facing words (shown in the send preview). */
  description: string;
  /**
   * Every other spelling that must resolve to `key`, including the exact
   * DLT-approved token text. Matched case/separator-insensitively.
   */
  aliases: readonly string[];
}

/**
 * The registry. `first_name` deliberately does NOT alias `name`: when a body
 * says "first name" it must get the first name, never the full name.
 */
export const VARIABLE_REGISTRY: readonly RegisteredVariable[] = [
  {
    key: "first_name",
    label: "Student first name",
    description: "The student's first name only — never the full name.",
    aliases: ["firstname", "first name", "student_first_name"],
  },
  {
    key: "no_of_installment",
    label: "Installment number",
    description: "Number of the student's OLDEST UNPAID installment.",
    aliases: ["No of Installment", "No_of_Installment", "installment_no", "installment_number"],
  },
  {
    key: "fee_in_rs",
    label: "Amount due (Rs)",
    description: "Outstanding amount on that installment, digits only (the body already prints \"Rs.\").",
    aliases: ["Fee_in_Rs", "fee_in_rs", "amount", "amount_due"],
  },
  {
    key: "login_url",
    label: "Login / portal URL",
    description: "The rotating portal login link from the SMS variable store.",
    aliases: ["loginurl", "login url"],
  },
  {
    key: "login_code",
    label: "Login code",
    description: "The recipient's own login code. Never shared across recipients.",
    aliases: ["logincode", "login code"],
  },
] as const;

/** canonicalized spelling -> canonical key. Built once at module load. */
const ALIAS_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of VARIABLE_REGISTRY) {
    m.set(canonicalizeToken(v.key), v.key);
    for (const a of v.aliases) {
      const c = canonicalizeToken(a);
      // First registration wins, so an alias can never hijack another
      // variable's canonical key (e.g. `amount` must not shadow `fee_in_rs`
      // if some future entry claims it too).
      if (!m.has(c)) m.set(c, v.key);
    }
  }
  return m;
})();

/** The canonical key a body token maps to, or null when it is not registered. */
export function registryKeyFor(token: string): string | null {
  return ALIAS_INDEX.get(canonicalizeToken(token)) ?? null;
}

export function registeredVariable(key: string): RegisteredVariable | undefined {
  return VARIABLE_REGISTRY.find((v) => v.key === key);
}

/** Every spelling that resolves to a canonical key, canonical form first. */
export function spellingsFor(key: string): string[] {
  const v = registeredVariable(key);
  if (!v) return [key];
  return [v.key, ...v.aliases];
}

export type VarMapInput = Record<string, string | number | null | undefined>;

/**
 * Canonicalized view of a vars map, so an alias lookup is O(1) per token
 * instead of rescanning every key. Earlier keys win on collision, matching the
 * object's own insertion order.
 */
export function buildVarIndex(vars: VarMapInput): Map<string, string | number | null | undefined> {
  const index = new Map<string, string | number | null | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    const c = canonicalizeToken(k);
    if (!index.has(c)) index.set(c, v);
  }
  return index;
}

/**
 * Resolve one body token against a vars map.
 *
 * Order — exact key, then canonicalized key, then every registered alias. The
 * exact-first rule is what keeps existing sends byte-identical.
 */
export function lookupVariable(
  vars: VarMapInput,
  token: string,
  index = buildVarIndex(vars),
): string | number | null | undefined {
  if (Object.prototype.hasOwnProperty.call(vars, token) && isResolvedValue(vars[token])) return vars[token];

  const canonical = canonicalizeToken(token);
  const direct = index.get(canonical);
  if (isResolvedValue(direct)) return direct;

  const key = ALIAS_INDEX.get(canonical);
  if (!key) return undefined;
  for (const spelling of spellingsFor(key)) {
    const v = index.get(canonicalizeToken(spelling));
    if (isResolvedValue(v)) return v;
  }
  return undefined;
}
