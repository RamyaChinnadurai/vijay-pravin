// Local preview with the API functions: `npm run dev` (PORT defaults to 3000).
// Mirrors vercel.json: clean URLs, the /calendar/:slug rewrite and /api/* functions.
// Reads an untracked .env if present; without Google credentials the API uses mock free/busy.

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain" };

const resolveStatic = (pathname) => {
  if (/^\/calendar\/(15min|30min|podcast)\/?$/.test(pathname)) return path.join(root, "calendar.html");
  const p = path.normalize(path.join(root, decodeURIComponent(pathname)));
  if (!p.startsWith(root) || /[\\/](\.|api[\\/]_lib|node_modules)/.test(p.slice(root.length))) return null;
  for (const candidate of [p, `${p}.html`, path.join(p, "index.html")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const api = /^\/api\/([a-z-]+(?:\/[a-z-]+)?)$/.exec(pathname);
  if (api) {
    const file = path.join(root, "api", `${api[1]}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    try {
      return await require(file)(req, res);
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      return res.end("Internal error");
    }
  }
  if (pathname.endsWith(".html")) {
    res.writeHead(308, { Location: pathname.replace(/(index)?\.html$/, "") || "/" });
    return res.end();
  }
  const file = resolveStatic(pathname);
  if (!file) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
