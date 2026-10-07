/**
 * Server and browser must format IST dates identically, or React hydration fails.
 *
 * Node's ICU (Vercel SSR, Chromium) formats en-IN short months as "Sept" and the day
 * period as "am"/"pm"; Safari/WebKit's ICU says "Sep" and "AM"/"PM". CourseCard renders
 * `formatISTDate` on the server and again during hydration, so WebKit hit React #425
 * on / and /courses. These tests load lib/dates under a Safari-like Intl and require
 * the server's output.
 */
import test from "node:test";
import assert from "node:assert/strict";

const RealDTF = Intl.DateTimeFormat;

/** Intl.DateTimeFormat that answers like Safari: "Sep", "AM"/"PM". */
function safariLikeIntl() {
  function Fake(this: unknown, locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
    const real = new RealDTF(locale, options);
    return {
      format: (d?: Date | number) => real.format(d).replace(/\bSept\b/g, "Sep").replace(/\b(am|pm)\b/g, (m) => m.toUpperCase()),
      formatToParts: (d?: Date | number) => real.formatToParts(d).map((p) => ({ ...p, value: p.value.replace(/^Sept$/, "Sep").replace(/^(am|pm)$/, (m) => m.toUpperCase()) })),
      resolvedOptions: () => real.resolvedOptions(),
    };
  }
  return Fake as unknown as typeof Intl.DateTimeFormat;
}

test("IST date/time formatting does not depend on the runtime's ICU data", async () => {
  (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = safariLikeIntl();
  try {
    const dates = await import(`../../lib/dates.ts?safari=${Date.now()}`);
    const sept = "2026-09-07T06:30:00.000Z"; // 7 Sep 2026, 12:00 pm IST
    assert.equal(dates.formatISTDate(sept), "7 Sept 2026");
    assert.equal(dates.formatISTTime(sept), "12:00 pm");
    assert.equal(dates.formatISTDateTime(sept), "7 Sept 2026, 12:00 pm IST");
    assert.equal(dates.formatISTShort(sept), "7 Sept, 12:00 pm");
    assert.equal(dates.formatISTTime("2026-10-04T18:37:00.000Z"), "12:07 am");
    assert.equal(dates.formatISTTime("2026-10-05T07:37:00.000Z"), "1:07 pm");
  } finally {
    (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = RealDTF;
  }
});

test("deterministic output equals Node's en-IN output for every month and hour", async () => {
  const dates = await import("../../lib/dates.ts");
  const med = new RealDTF("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  const time = new RealDTF("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
  // Node 20+ ICU is the reference the server renders with; only compare when this runtime agrees.
  if (med.format(new Date(Date.UTC(2026, 8, 5))) !== "5 Sept 2026") return;
  for (let m = 0; m < 12; m += 1) {
    for (const day of [1, 15, 28]) {
      const d = new Date(Date.UTC(2026, m, day, 20, 45)); // late UTC evening crosses the IST date line
      assert.equal(dates.formatISTDate(d.toISOString()), med.format(d), d.toISOString());
    }
  }
  for (let h = 0; h < 24; h += 1) {
    for (const minute of [0, 7, 59]) {
      const d = new Date(Date.UTC(2026, 9, 5, h, minute));
      assert.equal(dates.formatISTTime(d.toISOString()), time.format(d), d.toISOString());
    }
  }
  assert.equal(dates.formatISTDate(null), "—");
  assert.equal(dates.formatISTDate("nonsense"), "—");
});
