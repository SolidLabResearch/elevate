import path from "path";

const Module = require("module");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown
) {
  if (request === "@elevate/shared" || request.startsWith("@elevate/shared/")) {
    const suffix = request === "@elevate/shared" ? "" : request.slice("@elevate/shared/".length);
    const mapped = path.resolve(__dirname, "../../appcore/modules/shared", suffix);
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
