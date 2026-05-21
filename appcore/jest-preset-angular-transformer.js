const Module = require("module");
const originalLoad = Module._load;

// jest-preset-angular 12 falls back to esbuild-wasm for Angular .mjs files in
// some Node 24 runs, where the WASM service exits before transform completes.
// Native esbuild is already installed by Angular and works on this platform.
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "esbuild-wasm") {
    return require("esbuild");
  }
  return originalLoad.apply(this, arguments);
};

module.exports = require("jest-preset-angular");
