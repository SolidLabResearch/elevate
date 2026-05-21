import { webcrypto } from "crypto";

const globalScope = globalThis as typeof globalThis & { crypto?: Crypto };

if (!globalScope.crypto?.getRandomValues) {
  Object.defineProperty(globalScope, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: false
  });
}
