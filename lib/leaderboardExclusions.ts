/**
 * Staff / internal accounts to HIDE from the admin Performance Leaderboard.
 *
 * Excluded by STABLE `students.id` — never by name. Name matching is unsafe here:
 * the DB has multiple real students called "Naman" and "Pankaj" (e.g. Naman with
 * other phones, "Pankaj Yadav"), so a name filter would wrongly drop real
 * students. Each id below was resolved from the live DB to the exact person.
 *
 * Scope: this ONLY affects the leaderboard view and its counts (ranking +
 * paid/non-paying split). It does NOT delete or alter these accounts, and does
 * NOT touch their performance data anywhere else (their own /performance page,
 * attempts, results, etc. are untouched).
 *
 * To hide/unhide someone later, just add/remove their `students.id` here.
 *
 * Note on the schema's `is_staff`: that flag lives on `buyers` and is only set
 * for AUTO-PROVISIONED staff TEST accounts — neither person below carries it, so
 * it can't cover these real-person staff accounts. An explicit id allow-list is
 * therefore the correct, maintainable mechanism.
 */
export const LEADERBOARD_EXCLUDED_STUDENT_IDS: ReadonlySet<string> = new Set<string>([
  "f9fc0901-64e4-468c-aa87-be9232da60cc", // Naman Sharma (academy owner) — phone 9988791797
  "1b339bee-9734-4b0b-8d5c-337057525c87", // Pankaj Dhiman (staff)         — phone 8988483945
]);
