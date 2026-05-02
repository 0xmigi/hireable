import { createServer } from "node:http";
import { promises as fs, createReadStream, watch } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "..");
const dashboardFile = path.join(workspace, "dashboard", "index.html");
const buildScript = path.join(here, "build-dashboard.mjs");
const port = Number(process.env.PORT || 4174);

let buildPromise = null;
let pending = false;
const reloadClients = new Set();

function buildDashboard() {
  if (buildPromise) {
    pending = true;
    return buildPromise;
  }
  buildPromise = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [buildScript], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Dashboard build failed with exit code ${code}`));
    });
  }).finally(() => {
    buildPromise = null;
    if (pending) {
      pending = false;
      buildDashboard().then(broadcastReload).catch((error) => console.error(error));
    }
  });
  return buildPromise;
}

function broadcastReload() {
  for (const response of reloadClients) {
    try { response.write("data: reload\n\n"); } catch { /* ignore */ }
  }
}

const liveReloadSnippet = `<script>(()=>{const es=new EventSource("/__reload");es.onmessage=()=>location.reload();es.onerror=()=>es.close();})();</script>`;

async function readDashboard() {
  const html = await fs.readFile(dashboardFile, "utf8");
  return html.replace("</body>", `${liveReloadSnippet}</body>`);
}

await buildDashboard();

const MIME = {
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function serveStatic(request, response) {
  const url = decodeURIComponent(request.url.split("?")[0]);
  const requested = path.join(workspace, url);
  const resolved = path.resolve(requested);
  // Path traversal guard.
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return true;
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return false;
    const ext = path.extname(resolved).toLowerCase();
    response.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": "no-cache",
    });
    createReadStream(resolved).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  if (request.url === "/__reload") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    response.write(": connected\n\n");
    reloadClients.add(response);
    request.on("close", () => reloadClients.delete(response));
    return;
  }
  // Dashboard at root.
  if (request.url === "/" || request.url === "/index.html") {
    try {
      const html = await readDashboard();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error.stack || error));
    }
    return;
  }
  // Anything else: try as a static file inside the workspace.
  const served = await serveStatic(request, response);
  if (!served) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const ignored = new Set([".git", ".obsidian", "dashboard", "node_modules"]);
const watchedExts = new Set([".md", ".mdx", ".pdf", ".mjs", ".js"]);
const debounceMs = 200;
let debounceTimer = null;

function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      await buildDashboard();
      broadcastReload();
    } catch (error) {
      console.error(error);
    }
  }, debounceMs);
}

async function watchTree(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return; }
  try {
    watch(dir, (_event, filename) => {
      if (!filename) return;
      if (filename.startsWith(".")) return;
      const ext = path.extname(filename).toLowerCase();
      if (watchedExts.has(ext)) scheduleRebuild();
    });
  } catch { /* unsupported; skip */ }
  for (const entry of entries) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    await watchTree(path.join(dir, entry.name));
  }
}

await watchTree(workspace);

server.listen(port, "127.0.0.1", () => {
  console.log(`  hireable dashboard ready: http://localhost:${port}`);
});
