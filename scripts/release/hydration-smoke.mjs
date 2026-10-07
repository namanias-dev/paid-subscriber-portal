#!/usr/bin/env node
/**
 * Read-only WebKit + Chromium hydration smoke. See docs/PRODUCTION_RELEASE.md.
 *
 *   npm run release:hydration -- [base-url]     default https://www.namanias.com
 *
 * Loads the critical public routes at phone and desktop widths and fails on any React
 * hydration error (production builds report #418/#423/#425; dev builds print the
 * text), on any uncaught page error, and on horizontal overflow. Only GET/HEAD requests
 * leave the browser; everything else is aborted. Nothing is typed, so no cart, lead or
 * order can be created. Protected Vercel previews need VERCEL_BYPASS (a protection
 * bypass token) or the local `next start` URL.
 *
 * Playwright is not a project dependency. Install it once outside the repo
 * (`npm i -g playwright && npx playwright install webkit chromium`) or point
 * PLAYWRIGHT_MODULE at an install.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] || "https://www.namanias.com").replace(/\/$/, "");
const ROUTES = (process.env.HYDRATION_ROUTES || "/,/courses,/notes,/notes/checkout").split(",").map((r) => r.trim()).filter(Boolean);
const WIDTHS = (process.env.HYDRATION_WIDTHS || "390,1280").split(",").map(Number);
const ENGINES = (process.env.HYDRATION_ENGINES || "webkit,chromium").split(",");
const HYDRATION = /Minified React error #(418|423|425)\b|Hydration failed|did not match|server rendered HTML|Text content does not match|hydrated but some attributes/i;

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean);
  for (const name of candidates) {
    try {
      return await import(name);
    } catch {
      try {
        return createRequire(import.meta.url)(name);
      } catch { /* try next */ }
    }
  }
  console.error("✖ Playwright not found. Install it outside the repo (npm i -g playwright && npx playwright install webkit chromium) or set PLAYWRIGHT_MODULE.");
  process.exit(2);
}

const pw = await loadPlaywright();
let failures = 0;
for (const engineName of ENGINES) {
  const engine = pw[engineName];
  if (!engine) continue;
  const browser = await engine.launch();
  for (const width of WIDTHS) {
    const headers = process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS } : undefined;
    const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: headers });
    await context.route("**/*", (route) => {
      const request = route.request();
      if (/eazypay|icicibank/.test(request.url())) return route.abort();
      if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort();
      return route.continue();
    });
    for (const path of ROUTES) {
      const page = await context.newPage();
      const problems = [];
      page.on("pageerror", (error) => problems.push(HYDRATION.test(error.message) ? `hydration: ${error.message.slice(0, 120)}` : `pageerror: ${error.message.slice(0, 120)}`));
      page.on("console", (message) => {
        if (message.type() === "error" && HYDRATION.test(message.text())) problems.push(`hydration: ${message.text().slice(0, 120)}`);
      });
      let status = 0;
      try {
        const response = await page.goto(BASE + path, { waitUntil: "load", timeout: 60_000 });
        status = response?.status() || 0;
        await page.waitForTimeout(2500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
      } catch (error) {
        problems.push(`load: ${String(error.message).split("\n")[0]}`);
      }
      if (status >= 400) problems.push(`HTTP ${status}`);
      const unique = [...new Set(problems)];
      if (unique.length) failures += 1;
      console.log(`${unique.length ? "✖" : "✔"} ${engineName.padEnd(8)} ${String(width).padEnd(5)} ${path}${unique.length ? `  ${unique.join(" | ")}` : ""}`);
      await page.close();
    }
    await context.close();
  }
  await browser.close();
}
if (failures) {
  console.error(`✖ ${failures} route/viewport combination(s) failed`);
  process.exit(1);
}
console.log("✔ no hydration or page errors");
