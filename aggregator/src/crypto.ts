import { createHash, randomBytes } from "crypto";

export function randomToken(bytes = 24): string {
  return toBase64Url(randomBytes(bytes).toString("base64"));
}

export function sha256Base64Url(input: string): string {
  return toBase64Url(createHash("sha256").update(input).digest("base64"));
}

export function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

export function decodeJwtPayload(token: string): any | null {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(fromBase64Url(payload), "base64").toString("utf8"));
  } catch (_err) {
    return null;
  }
}

function toBase64Url(value: string): string {
  return value.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  return normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
}
