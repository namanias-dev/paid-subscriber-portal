/** Telegram bot env helpers. Never throw — callers gate on botConfigured(). */

function trim(v: string | undefined | null): string | null {
  const s = (v || "").trim();
  return s ? s : null;
}

export function botToken(): string | null {
  return trim(process.env.TELEGRAM_BOT_TOKEN);
}

export function webhookSecret(): string | null {
  return trim(process.env.TELEGRAM_WEBHOOK_SECRET);
}

export function botUsername(): string | null {
  const u = trim(process.env.TELEGRAM_BOT_USERNAME);
  return u ? u.replace(/^@/, "") : null;
}

export function botConfigured(): boolean {
  return !!botToken();
}

export function apiBase(): string | null {
  const token = botToken();
  if (!token) return null;
  return `https://api.telegram.org/bot${token}`;
}
