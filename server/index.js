import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { appConfig } from "./config.js";
import { getDb } from "./db.js";
import { registerApi } from "./api.js";
import { startLiveSync } from "./live.js";
import { registerAuth } from "./auth.js";

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
await app.register(cors, { origin: false });
app.addHook("onRequest", async (request, reply) => {
  if (
    request.headers.origin &&
    request.headers.origin !== `http://127.0.0.1:${appConfig.port}` &&
    request.headers.origin !== `http://localhost:${appConfig.port}` &&
    request.headers.origin !== process.env.TOKEN_MONITOR_PUBLIC_ORIGIN
  )
    return reply
      .code(403)
      .send({ error: "Only this local dashboard can access the API." });
});
getDb();
registerAuth(app);
registerApi(app);
registerStatic(app);
let stopSync;
app.addHook("onClose", async () => stopSync?.());

try {
  await app.listen({
    port: appConfig.port,
    host: process.env.TOKEN_MONITOR_HOST || "127.0.0.1",
  });
  stopSync = startLiveSync(app.log);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function registerStatic(app) {
  const distDir = path.join(process.cwd(), "dist");
  app.get("/", async (_request, reply) =>
    sendStatic(reply, distDir, "index.html"),
  );
  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.callNotFound();
    const cleanPath = decodeURIComponent(request.url.split("?")[0]).replace(
      /^\/+/,
      "",
    );
    const candidate = path.normalize(path.join(distDir, cleanPath));
    if (!candidate.startsWith(distDir + path.sep))
      return reply.code(403).send("Forbidden");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return sendStatic(reply, distDir, cleanPath);
    return sendStatic(reply, distDir, "index.html");
  });
}

function sendStatic(reply, distDir, relativePath) {
  const fullPath = path.join(distDir, relativePath);
  if (!fs.existsSync(fullPath))
    return reply.code(404).send("Run npm.cmd run build first.");
  reply.header("content-type", mimeType(fullPath));
  return fs.createReadStream(fullPath);
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}
