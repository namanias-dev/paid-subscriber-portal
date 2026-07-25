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

/**
 * Second shim: a global `React` for JSX in component tests.
 *
 * `tsconfig.json` sets `"jsx": "preserve"` because Next.js owns the JSX
 * transform in the real build. The test loader has no such owner, so it falls
 * back to the CLASSIC runtime and emits `React.createElement(...)` — while the
 * components themselves, written for Next's automatic runtime, never import
 * React. Rendering one in a test then dies with `ReferenceError: React is not
 * defined`.
 *
 * Exposing React globally here fixes that for tests without touching
 * `tsconfig.json`, which would alter how the production bundle is compiled.
 * The components under test stay byte-identical to what ships.
 */
if (typeof globalThis.React === "undefined") {
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    writable: true,
    value: reactMod,
  });
}
