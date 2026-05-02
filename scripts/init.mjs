#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const stateDir = path.join(cwd, ".hireable");
const pidFile = path.join(stateDir, "dashboard.json");
const logFile = path.join(stateDir, "dashboard.log");
const serveScript = path.join(cwd, "scripts", "serve-dashboard.mjs");

async function readPid() {
  try { return JSON.parse(await fs.readFile(pidFile, "utf8")); } catch { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => server.close(() => resolve(port)));
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function openInBrowser(url) {
  setTimeout(() => {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }, 400);
}

async function start({ open = true } = {}) {
  try { await fs.access(serveScript); }
  catch {
    console.error(`✗ Missing ${serveScript}. Run this from a hireable workspace (cwd should contain scripts/serve-dashboard.mjs).`);
    process.exit(1);
  }

  await fs.mkdir(stateDir, { recursive: true });

  const existing = await readPid();
  if (existing && isAlive(existing.pid)) {
    const url = `http://localhost:${existing.port}`;
    console.log(`✓ Dashboard already running at ${url} (PID ${existing.pid})`);
    if (open) openInBrowser(url);
    return existing;
  }

  const port = await findFreePort(4174);
  const logHandle = await fs.open(logFile, "a");
  const child = spawn(process.execPath, [serveScript], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  });
  child.unref();
  await logHandle.close();

  const meta = { pid: child.pid, port, workspace: cwd, startedAt: new Date().toISOString() };
  await fs.writeFile(pidFile, JSON.stringify(meta, null, 2));

  const url = `http://localhost:${port}`;
  console.log(`✓ Started dashboard at ${url} (PID ${child.pid})`);
  console.log(`  logs: ${logFile}`);
  if (open) openInBrowser(url);
  return meta;
}

async function stop() {
  const meta = await readPid();
  if (!meta) {
    console.log("• No dashboard pidfile found.");
    return;
  }
  if (!isAlive(meta.pid)) {
    console.log(`• Dashboard PID ${meta.pid} is not running. Cleaning up pidfile.`);
    await fs.rm(pidFile, { force: true });
    return;
  }
  try { process.kill(meta.pid, "SIGTERM"); } catch { /* ignore */ }
  await fs.rm(pidFile, { force: true });
  console.log(`✓ Stopped dashboard (PID ${meta.pid}) for ${meta.workspace}`);
}

async function status() {
  const meta = await readPid();
  if (!meta) { console.log("• No dashboard registered for this workspace."); return; }
  const alive = isAlive(meta.pid);
  console.log(`${alive ? "✓ running" : "✗ dead"}  PID ${meta.pid}  port ${meta.port}  started ${meta.startedAt}`);
  if (!alive) console.log("  Run `node scripts/init.mjs` to revive.");
}

const cmd = process.argv[2] || "start";
const flags = new Set(process.argv.slice(3));
const main = {
  start: () => start({ open: !flags.has("--no-open") }),
  stop,
  status,
};

if (!main[cmd]) {
  console.error(`Unknown command: ${cmd}\nUsage: node scripts/init.mjs [start|stop|status] [--no-open]`);
  process.exit(1);
}

main[cmd]().catch((err) => { console.error("✗", err.message || err); process.exit(1); });
