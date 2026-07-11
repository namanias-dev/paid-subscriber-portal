/** Tiny structured console logger (timestamped). No PII should ever be logged. */
function line(level: string, msg: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[${ts}] ${level} ${msg}${suffix}`);
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => line("INFO", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => line("WARN", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => line("ERROR", msg, extra),
};
