/** Minimal React.cache shim for Node scripts that import Next/dataProvider. */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react") {
    const react = originalLoad.apply(this, arguments);
    if (typeof react.cache !== "function") {
      react.cache = (fn) => fn;
    }
    return react;
  }
  return originalLoad.apply(this, arguments);
};
