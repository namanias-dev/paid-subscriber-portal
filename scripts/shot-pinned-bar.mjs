import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "fixtures/pinned-bar.html");
const outDir = path.resolve(__dirname, "../.tmp/pinned-bar-shots");
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { w: 360, state: "blocked", name: "360-blocked" },
  { w: 360, state: "expiring", name: "360-expiring" },
  { w: 390, state: "blocked", name: "390-blocked-iphone" },
  { w: 414, state: "blocked", name: "414-blocked-long", long: true },
  { w: 768, state: "blocked", name: "768-blocked" },
  { w: 768, state: "expiring", name: "768-expiring" },
  { w: 1280, state: "blocked", name: "1280-blocked" },
  { w: 1280, state: "expiring", name: "1280-expiring" },
  { w: 360, state: "blocked", name: "360-blocked-compact", compact: true },
  { w: 360, state: "blocked", name: "360-blocked-reduced", reduced: true },
  { w: 360, state: "blocked", name: "360-blocked-font200", fontScale: 2 },
];

async function run() {
  const browser = await chromium.launch();
  const failures = [];
  for (const s of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: s.w, height: 820 },
      reducedMotion: s.reduced ? "reduce" : "no-preference",
    });
    if (s.fontScale) {
      await page.addInitScript((scale) => {
        document.documentElement.style.fontSize = `${16 * scale}px`;
      }, s.fontScale);
    }
    const q = new URLSearchParams({ state: s.state });
    if (s.compact) q.set("compact", "1");
    if (s.long === false) q.set("long", "0");
    await page.goto(`file://${file}?${q}`);
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => window.__metrics());
    if (m.textOverflow === "ellipsis") failures.push(`${s.name}: ellipsis`);
    if (m.heroOverflow && s.w < 480) failures.push(`${s.name}: hero overflow`);
    if (m.paidLabel === "Paid") failures.push(`${s.name}: bare Paid`);
    if (Math.abs(m.barTop - m.navBottom) > 2) failures.push(`${s.name}: bar not flush under nav (Δ=${m.barTop - m.navBottom})`);
    if (m.gap < -2) failures.push(`${s.name}: content underlap gap=${m.gap}`);
    await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
    console.log(s.name, m);
    await page.close();
  }
  await browser.close();
  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("OK", SHOTS.length, "shots →", outDir);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
