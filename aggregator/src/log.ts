type LogDetails = Record<string, unknown>;

export const log = {
  info(message: string, details?: LogDetails): void {
    write("info", message, details);
  },

  warn(message: string, details?: LogDetails): void {
    write("warn", message, details);
  },

  error(message: string, details?: LogDetails): void {
    write("error", message, details);
  }
};

function write(level: "info" | "warn" | "error", message: string, details?: LogDetails): void {
  const line = `[aggregator] ${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  if (details) {
    const safeDetails = redact(details);
    if (level === "error") {
      console.error(line, safeDetails);
      return;
    }
    if (level === "warn") {
      console.warn(line, safeDetails);
      return;
    }
    console.log(line, safeDetails);
    return;
  }

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redact(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldRedact(key)) {
      output[key] = entry ? "[redacted]" : entry;
    } else {
      output[key] = redact(entry);
    }
  }
  return output;
}

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized.startsWith("has")) {
    return false;
  }
  if (normalized.includes("format") || normalized.endsWith("endpoint") || normalized.endsWith("server")) {
    return false;
  }
  return (
    normalized === "authorization" ||
    normalized === "authorizationheader" ||
    normalized === "code" ||
    normalized === "state" ||
    normalized === "ticket" ||
    normalized.includes("secret") ||
    normalized.includes("verifier") ||
    normalized.includes("challenge") ||
    normalized.includes("token")
  );
}
