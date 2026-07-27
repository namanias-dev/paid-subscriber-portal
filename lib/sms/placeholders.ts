/**
 * THE placeholder pattern and the helpers built on it — one regex, one place.
 *
 * This module exists because the pattern had drifted into four private copies.
 * The original incident was caused by `/\{([a-z_]+)\}/g`, which only matches
 * all-lowercase tokens: the DLT-approved "Installment Reminder" body
 * (`{No_of_Installment}`, `{Fee_in_Rs}`) parsed as if it had three variables
 * instead of five, and a real student received the raw braces. Fixing the copy
 * in the send path left identical copies in the DLT export sheet, the Mission
 * Control template editor and the docs generator, each free to drift again.
 *
 * Deliberately dependency-light (only ./variableRegistry, which imports
 * nothing) so a client component can import it without pulling the seed
 * template bodies into the browser bundle.
 */
import { registryKeyFor } from "./variableRegistry";

/**
 * Matches ANY `{...}` token: spaces, capitals, digits, dots, underscores.
 *
 * Declared as a source string and compiled on demand rather than exported as a
 * shared RegExp object, because a single `/g` instance carries mutable
 * `lastIndex` state — sharing one across modules makes `.exec`/`.test` return
 * different answers depending on who called it last.
 */
export const PLACEHOLDER_PATTERN = "\\{([^{}]+)\\}";

/** A fresh, unshared matcher. Use this instead of writing the literal again. */
export function placeholderRe(): RegExp {
  return new RegExp(PLACEHOLDER_PATTERN, "g");
}

/**
 * Replace every `{token}`. The replacer receives the inner token text and the
 * full `{token}` match, so a caller can leave a token untouched by returning it.
 */
export function replacePlaceholders(
  body: string,
  replacer: (token: string, full: string) => string,
): string {
  return body.replace(placeholderRe(), (full, token: string) => replacer(token, full));
}

/** Ordered list of variable occurrences (DLT slots — duplicates kept in order). */
export function variableSlots(body: string): string[] {
  return [...body.matchAll(placeholderRe())].map((m) => m[1]!);
}

/** Unique variables in first-seen order (stored on the template). */
export function uniqueVariables(body: string): string[] {
  return [...new Set(variableSlots(body))];
}

/**
 * The literal text between placeholders — what must byte-match an approved DLT
 * body once the variable slots are masked out.
 *
 * Note for anyone tempted to `body.split(placeholderRe())` directly: the
 * pattern has a capture group, and `String.split` interleaves captured groups
 * into its result, so a raw split yields [text, token, text, token, …]. The
 * even indices are the fixed segments.
 */
export function fixedSegments(body: string): string[] {
  return body.split(placeholderRe()).filter((_, i) => i % 2 === 0);
}

/**
 * Canonical variable catalogue — the only tokens the send pipeline can resolve
 * (mirrors SmsVariable in ./types + the variable store). A self-serve template
 * body MAY use other {tokens}, but they are flagged as "unknown" (a warning, not
 * a hard block) because nothing fills them, so they would render empty / mark a
 * recipient as missing-vars at send time.
 */
export const KNOWN_VARIABLES: readonly string[] = [
  "name", "first_name", "mobile", "login_code", "login_url",
  "item_name", "item_short", "amount", "payment_status",
  "webinar_date", "webinar_time", "support_number",
] as const;

/**
 * Body {tokens} that are NOT in the canonical catalogue (first-seen order).
 * Alias-aware: a DLT-approved spelling such as `{No_of_Installment}` resolves
 * through the registry to a known variable, so it is NOT reported as unknown.
 */
export function unknownVariables(body: string): string[] {
  return uniqueVariables(body).filter(
    (v) => !KNOWN_VARIABLES.includes(v) && registryKeyFor(v) === null,
  );
}
