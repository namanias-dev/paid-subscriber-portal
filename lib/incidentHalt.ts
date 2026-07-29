/**
 * SEV1 incident halt — public-site restoration outranks automation.
 * Flip to false only after public routes are green for 15+ minutes AND
 * kill_switch is confirmed in DB.
 */
export const SEV1_HALT_HEAVY_CRONS = true;

export function heavyCronHalted(): boolean {
  if (process.env.SEV1_RESUME_CRONS === "1") return false;
  if (process.env.SEV1_HALT_CRONS === "0") return false;
  return SEV1_HALT_HEAVY_CRONS || process.env.SEV1_HALT_CRONS === "1";
}
