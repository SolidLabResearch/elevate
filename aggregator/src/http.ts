import { IncomingMessage, ServerResponse } from "http";

export async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return body ? (JSON.parse(body) as T) : ({} as T);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload).toString(),
    ...corsHeaders(),
    ...headers
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body).toString(),
    ...corsHeaders(),
    ...headers
  });
  res.end(body);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, corsHeaders());
  res.end();
}

export function sendRedirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, { location, ...corsHeaders(), ...headers });
  res.end();
}

export function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: "not_found" });
}

export function methodNotAllowed(res: ServerResponse, allowed: string[]): void {
  sendJson(res, 405, { error: "method_not_allowed" }, { allow: allowed.join(", ") });
}

export function getRequestUrl(req: IncomingMessage, baseUrl: string): URL {
  return new URL(req.url || "/", baseUrl);
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, accept, authorization",
    "access-control-expose-headers": "location, link, etag, accept-post"
  };
}
