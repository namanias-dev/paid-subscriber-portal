/**
 * Test-only preload shim.
 *
 * `lib/dataProvider.ts` imports `cache` from `react` (Server Component
 * memoization). Outside of the React Server Component runtime `cache` is
 * `undefined`, so any test that imports from `dataProvider.ts` blows up at
 * module load with `TypeError: (0 , import_react.cache) is not a function`.
 *
 * This shim patches the `react` module's `cache` export to a plain
 * identity-style function BEFORE any test module is loaded, using Node's
 * `module.register` loader hook. It only runs when explicitly wired via
 * `--import ./scripts/_react-cache-shim.mjs` from `package.json` → `test`,
 * so it never touches production or Next.js builds.
 *
 * The replacement `cache` returns the passed fn unchanged. Tests never
 * exercise the memoization semantics (each test builds its own inputs), so
 * a no-op wrapper is sufficient and keeps the code paths under test
 * byte-identical to production.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const reactMod = require("react");
if (typeof reactMod.cache !== "function") {
  Object.defineProperty(reactMod, "cache", {
    configurable: true,
    writable: true,
    value: /** @template T */ function passthroughCache(fn) {
      return fn;
    },
  });
}
