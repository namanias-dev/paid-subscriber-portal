import type { Learner } from "./entitlements";
import type { ActionActor } from "./adminGuard";

export const COMMENT_MAX_LEN = 2000;
export const EDIT_WINDOW_MS = 15 * 60 * 1000; // students may edit/delete their own for 15 min
export const POST_MIN_GAP_MS = 8000; // anti-spam: min gap between a user's comments

/**
 * Stable author key for a viewer. Students/buyers are keyed by canonical
 * students.id when present, else by phone; staff by their admin actor id. Used
 * both to stamp new comments and to detect "my own" comments for edit/delete.
 */
export function viewerAuthorId(learner: Learner, actor: ActionActor | null): string {
  if (learner.kind === "staff") return actor?.id || learner.phone;
  return learner.studentId || `phone:${learner.phone}`;
}

/** Sanitize comment input: collapse control chars, trim, enforce length. */
export function sanitizeCommentBody(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return s.slice(0, COMMENT_MAX_LEN);
}

/** Map a staff role label to a student-facing badge. */
export function staffBadge(role: string | null | undefined): "Admin" | "Faculty" {
  return (role || "").toLowerCase().includes("admin") ? "Admin" : "Faculty";
}
