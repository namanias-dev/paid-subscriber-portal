export interface OfferCountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  showSeconds: boolean;
  ended: boolean;
}

export function splitOfferRemaining(ms: number): OfferCountdownParts {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, showSeconds: false, ended: true };
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds, showSeconds: days < 1, ended: false };
}
