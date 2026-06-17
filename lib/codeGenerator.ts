/**
 * Generate an access code in the form NS-[4 digits]-[4 letters].
 * e.g. "Priya Sharma" -> "NS-8472-PRIY"
 */
export function generateAccessCode(name: string): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const letters = (name || "USER")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, "X");
  return `NS-${digits}-${letters}`;
}
