/** Structured Telegram logs for Vercel — never includes the bot token. */

export function tgLog(
  stage: string,
  detail: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const line = JSON.stringify({
    scope: "telegram",
    stage,
    ...detail,
    ts: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
