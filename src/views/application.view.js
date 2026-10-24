"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { rootDirectory } = require("../config/environment");
const { ApiError } = require("../models/errors");

const publicDirectory = path.join(rootDirectory, "public");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function view(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "Método não permitido." });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(response, 400, { error: "Caminho de arquivo inválido." });
  }

  const relative = pathname === "/" ? "views/index.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(publicDirectory, relative);
  if (!filename.startsWith(`${publicDirectory}${path.sep}`) ||
      relative.split(/[\\/]/).some((part) => part.startsWith("."))) {
    return sendJson(response, 404, { error: "Arquivo não encontrado." });
  }

  let content;
  try {
    content = await fs.promises.readFile(filename);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      return sendJson(response, 404, { error: "Arquivo não encontrado." });
    }
    throw error;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

module.exports = { view };
