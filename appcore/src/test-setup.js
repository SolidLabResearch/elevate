// Polyfills for browser APIs needed by libraries like jose
const { TextEncoder, TextDecoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
