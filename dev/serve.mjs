/**
 * Tiny static server for the renderer preview (dev/preview.html).
 * Not part of the released module.
 *
 *   node dev/serve.mjs            then open http://localhost:5179/dev/preview.html
 *
 * The preview needs the same PIXI build Foundry ships. Point FOUNDRY_APP at
 * your Foundry "resources/app" folder if it is not in the default location.
 * FOUNDRY_DATA is optional and only used to borrow the system's display font.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT) || 5179;
const foundryApp = process.env.FOUNDRY_APP
  ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const foundryData = process.env.FOUNDRY_DATA
  ?? join(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data");

const vendor = {
  "/vendor/pixi.min.js": join(foundryApp, "node_modules", "pixi.js", "dist", "pixi.min.js"),
  // Foundry always loads Amiri before the canvas draws; it is the module's fallback display face.
  "/vendor/amiri-regular.woff2": join(foundryApp, "public", "fonts", "amiri", "amiri-regular.woff2"),
  "/vendor/amiri-bold.woff2": join(foundryApp, "public", "fonts", "amiri", "amiri-bold.woff2"),
  "/vendor/handlebars.min.js": join(foundryApp, "node_modules", "handlebars", "dist", "handlebars.min.js")
};
// Whole folders borrowed from the Foundry install (icons for the interface preview).
const vendorFolders = {
  "/vendor/fontawesome/": join(foundryApp, "public", "fonts", "fontawesome")
};
void foundryData;

const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".hbs": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let file = vendor[url.pathname];
  for (const [prefix, folder] of Object.entries(vendorFolders)) {
    if (file || !url.pathname.startsWith(prefix)) continue;
    const inside = resolve(folder, normalize(decodeURIComponent(url.pathname.slice(prefix.length))));
    if (inside.startsWith(folder + sep)) file = inside;
  }
  if (!file) {
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    file = resolve(root, rel || "dev/preview.html");
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }).end(`Not found: ${url.pathname}`);
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Vampire Relationships preview: http://localhost:${port}/dev/preview.html`);
});
