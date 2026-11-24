import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createZeroCovenantApp } from "./app.js";

const app = createZeroCovenantApp();

const distClientDir = resolve(process.cwd(), "dist/client");
if (existsSync(distClientDir)) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  const indexHtmlPath = resolve(distClientDir, "index.html");
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/health") {
      return c.json({ ok: false, error: "Not found" }, 404);
    }
    return c.html(readFileSync(indexHtmlPath, "utf8"));
  });
}

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ZeroCovenant listening on http://0.0.0.0:${info.port}`);
});
