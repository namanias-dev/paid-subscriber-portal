/**
 * SEV1 incident halt — public-site restoration outranks automation.
 * Cleared on Phase 3 close-out (bf9337d3 follow-up): public green, access
 * reminders being armed. Re-flip to true only for a new SEV1.
 */
export const SEV1_HALT_HEAVY_CRONS = false;

export function heavyCronHalted(): boolean {
  if (process.env.SEV1_RESUME_CRONS === "1") return false;
  if (process.env.SEV1_HALT_CRONS === "0") return false;
  return SEV1_HALT_HEAVY_CRONS || process.env.SEV1_HALT_CRONS === "1";
}
