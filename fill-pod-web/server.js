const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const DEFAULT_PORT = Number(process.env.PORT || 4317);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_ISSUER_URL = process.env.SOLID_ISSUER_URL || "http://rs.local:3000";
const CLIENT_ID_URL = process.env.SOLID_CLIENT_ID_URL || null;
const PUBLIC_DIR = path.join(__dirname, "public");
const LOGO_PATH = path.join(__dirname, "../resources/elevate_logo.svg");
const TRUSTFLOWS_CLIENT_ROOT = resolveTrustflowsClientRoot();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload, contentType = "application/json; charset=utf-8") {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function isPathInside(filePath, rootPath) {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function serveStatic(req, res, pathname) {
  let filePath;

  if (pathname === "/assets/elevate_logo.svg") {
    filePath = LOGO_PATH;
  } else if (pathname.startsWith("/vendor/trustflows-client/")) {
    if (!TRUSTFLOWS_CLIENT_ROOT) {
      sendText(res, 500, "trustflows-client dependency is not installed");
      return;
    }

    const relativePath = pathname.slice("/vendor/trustflows-client/".length);
    filePath = path.resolve(TRUSTFLOWS_CLIENT_ROOT, relativePath);

    if (!isPathInside(filePath, TRUSTFLOWS_CLIENT_ROOT)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (!path.extname(filePath) && fs.existsSync(`${filePath}.js`)) {
      filePath = `${filePath}.js`;
    }
  } else {
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    filePath = path.resolve(PUBLIC_DIR, relativePath);

    if (!isPathInside(filePath, PUBLIC_DIR)) {
      sendText(res, 403, "Forbidden");
      return;
    }
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const extension = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Content-Length": content.length
    });
    res.end(content);
  });
}

function resolveTrustflowsClientRoot() {
  const candidates = [
    path.join(__dirname, "../appcore/node_modules/trustflows-client"),
    path.join(__dirname, "../desktop/node_modules/trustflows-client")
  ];

  return candidates.find(candidate => fs.existsSync(path.join(candidate, "dist/index.js"))) || null;
}

function getRequestOrigin(req) {
  return `http://${req.headers.host}`;
}

function getClientIdUrl(req) {
  return CLIENT_ID_URL || `${getRequestOrigin(req)}/client-id.jsonld`;
}

function sendClientId(req, res) {
  const origin = getRequestOrigin(req);
  const clientIdUrl = getClientIdUrl(req);
  sendJson(
    res,
    200,
    {
      "@context": "https://www.w3.org/ns/solid/oidc-context.jsonld",
      client_id: clientIdUrl,
      client_name: "Elevate Fill Pod",
      redirect_uris: [`${origin}/`, `${origin}/index.html`],
      post_logout_redirect_uris: [`${origin}/`, `${origin}/index.html`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid webid offline_access",
      token_endpoint_auth_method: "none"
    },
    "application/ld+json; charset=utf-8"
  );
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/config") {
      sendJson(res, 200, {
        defaultIssuerUrl: DEFAULT_ISSUER_URL,
        clientIdUrl: getClientIdUrl(req)
      });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/client-id.jsonld") {
      sendClientId(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, requestUrl.pathname);
      return;
    }

    sendText(res, 405, "Method not allowed");
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function listen(port, allowFallback = true) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });

  server.on("error", error => {
    if (error.code === "EADDRINUSE" && allowFallback) {
      listen(port + 1, true);
      return;
    }

    throw error;
  });

  server.listen(port, DEFAULT_HOST, () => {
    const address = server.address();
    const visibleHost = address.address === "127.0.0.1" ? "localhost" : address.address;
    console.log(`Fill Pod web UI running at http://${visibleHost}:${address.port}`);
    console.log(`Default Solid issuer: ${DEFAULT_ISSUER_URL}`);
    console.log(`Client ID: ${CLIENT_ID_URL || `http://${visibleHost}:${address.port}/client-id.jsonld`}`);
  });
}

listen(DEFAULT_PORT, !process.env.PORT);
