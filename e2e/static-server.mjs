// Serves the web build of the customer app (apps/mobile/dist-web) for browser tests.
// Local test use only: no caching, no directory listing, single-page fallback to index.html.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../apps/mobile/dist-web");
const port = Number(process.env.PORT ?? 8081);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

if (!existsSync(join(root, "index.html"))) {
  console.error(`No web build at ${root}. Run: pnpm --filter @beans/mobile export:web`);
  process.exit(1);
}

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  let file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html");
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "localhost", () => console.log(`customer app on http://localhost:${port}`));
