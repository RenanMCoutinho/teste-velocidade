const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const host = "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
const rootDir = path.resolve(__dirname, "../../public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

function sendJson(response, statusCode, payload) {
  setSecurityHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function serveFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  const stream = fs.createReadStream(filePath);

  stream.on("error", () => {
    sendJson(response, 404, { error: "Arquivo nao encontrado." });
  });

  setSecurityHeaders(response);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });

  stream.pipe(response);
}

function streamDownload(response, durationSeconds) {
  const chunkSize = 256 * 1024;
  const chunk = Buffer.alloc(chunkSize, 97);
  const endsAt = Date.now() + Math.max(1, durationSeconds) * 1000;

  setSecurityHeaders(response);
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store",
    "Transfer-Encoding": "chunked",
  });

  function writeChunk() {
    if (Date.now() >= endsAt || response.destroyed) {
      response.end();
      return;
    }

    const canContinue = response.write(chunk);
    if (canContinue) {
      setImmediate(writeChunk);
      return;
    }

    response.once("drain", writeChunk);
  }

  writeChunk();
}

function handleUpload(request, response) {
  let totalBytes = 0;

  request.on("data", (chunk) => {
    totalBytes += chunk.length;
  });

  request.on("end", () => {
    sendJson(response, 200, { receivedBytes: totalBytes });
  });

  request.on("error", () => {
    sendJson(response, 500, { error: "Falha ao receber upload." });
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/ping") {
    setSecurityHeaders(response);
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (pathname === "/download") {
    const duration = Number(requestUrl.searchParams.get("duration")) || 4;
    streamDownload(response, duration);
    return;
  }

  if (pathname === "/upload" && request.method === "POST") {
    handleUpload(request, response);
    return;
  }

  let relativePath = pathname === "/" ? "/index.html" : pathname;
  relativePath = relativePath.replace(/^\/+/, "");
  const filePath = path.join(rootDir, relativePath);

  if (!filePath.startsWith(rootDir)) {
    sendJson(response, 403, { error: "Acesso negado." });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: "Arquivo nao encontrado." });
      return;
    }

    serveFile(response, filePath);
  });
});

server.listen(port, host, () => {
  console.log(`Servidor em http://${host}:${port}`);
});
