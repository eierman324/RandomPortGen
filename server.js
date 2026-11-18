// RandomPortGen – lokaler Server ohne Abhängigkeiten.
// Liefert die Website aus und scannt Ports auf diesem Rechner.
// Start: node server.js   →   http://localhost:27183

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT) || 27183;
const HOST = "127.0.0.1"; // bewusst nur lokal erreichbar
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------- Port-Prüfung ----------

// Versucht, den Port auf einer Adresse zu belegen.
function tryBind(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", (err) => resolve(err.code || "ERROR"));
    srv.listen({ port, host, exclusive: true }, () => {
      srv.close(() => resolve("OK"));
    });
  });
}

// Prüft, ob schon etwas auf dem Port lauscht.
function tryConnect(port, host, timeout = 250) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (result) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeout, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

async function checkPort(port) {
  // Erst lauschende Dienste suchen (findet auch Dienste, die nur auf 127.0.0.1 / ::1 hören)
  if (await tryConnect(port, "127.0.0.1")) return { port, status: "used", detail: "Ein Dienst antwortet auf 127.0.0.1" };
  if (await tryConnect(port, "::1")) return { port, status: "used", detail: "Ein Dienst antwortet auf ::1" };

  // Dann selbst belegen (findet reservierte Ports und Dienste auf anderen Interfaces)
  for (const host of ["0.0.0.0", "127.0.0.1", "::"]) {
    const res = await tryBind(port, host);
    if (res === "OK") continue;
    if (res === "EADDRINUSE") return { port, status: "used", detail: `Belegt (${host})` };
    if (res === "EACCES") return { port, status: "reserved", detail: `Vom System gesperrt oder reserviert (${host})` };
    if (res === "EAFNOSUPPORT" || res === "EADDRNOTAVAIL") continue; // kein IPv6 vorhanden
    return { port, status: "unknown", detail: `Fehler ${res} (${host})` };
  }
  return { port, status: "free", detail: "" };
}

async function checkPorts(ports) {
  const results = [];
  const BATCH = 32;
  for (let i = 0; i < ports.length; i += BATCH) {
    results.push(...(await Promise.all(ports.slice(i, i + BATCH).map(checkPort))));
  }
  return results;
}

// ---------- Systeminfos ----------

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

let infoCache = null;
async function systemInfo() {
  if (infoCache) return infoCache;
  const info = { platform: process.platform, hostname: os.hostname(), ephemeral: null, excluded: [] };

  if (process.platform === "win32") {
    const dyn = await run("netsh", ["int", "ipv4", "show", "dynamicport", "tcp"]);
    const start = dyn.match(/(?:Startport|Start Port)\s*:\s*(\d+)/i);
    const count = dyn.match(/(?:Anzahl der Ports|Number of Ports)\s*:\s*(\d+)/i);
    if (start && count) info.ephemeral = [Number(start[1]), Number(start[1]) + Number(count[1]) - 1];

    const ex = await run("netsh", ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"]);
    for (const m of ex.matchAll(/^\s*(\d+)\s+(\d+)/gm)) info.excluded.push([Number(m[1]), Number(m[2])]);
  } else if (process.platform === "linux") {
    try {
      const [a, b] = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number);
      info.ephemeral = [a, b];
    } catch {}
  } else if (process.platform === "darwin") {
    const a = (await run("sysctl", ["-n", "net.inet.ip.portrange.first"])).trim();
    const b = (await run("sysctl", ["-n", "net.inet.ip.portrange.last"])).trim();
    if (a && b) info.ephemeral = [Number(a), Number(b)];
  }

  infoCache = info;
  setTimeout(() => (infoCache = null), 60_000); // reservierte Bereiche können sich ändern
  return info;
}

// Welcher Prozess hält einen Port?
async function whoUses(port) {
  if (process.platform === "win32") {
    const out = await run("netstat", ["-ano"]);
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const local = cols[1] || "";
      if (!local.endsWith(":" + port)) continue;
      const pid = cols[cols.length - 1];
      if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    const procs = [];
    for (const pid of pids) {
      const csv = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      const name = (csv.match(/^"([^"]+)"/m) || [])[1];
      procs.push({ pid: Number(pid), name: name || "?" });
    }
    return procs;
  }
  const out = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const procs = [];
  for (const line of out.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length > 1) procs.push({ pid: Number(cols[1]), name: cols[0] });
  }
  return procs;
}

// ---------- Zufall (für die Text-API) ----------

require("./public/ports.js"); // setzt globalThis.BROWSER_BLOCKED und KNOWN_PORTS

async function apiCandidates(min, max) {
  const info = await systemInfo();
  // Ephemeral-Bereich nur meiden, wenn der gewünschte Bereich nicht komplett darin liegt
  const avoidEph = info.ephemeral && min < info.ephemeral[0];
  const ranges = [...info.excluded, ...(avoidEph ? [info.ephemeral] : [])];
  const list = [];
  for (let p = min; p <= max; p++) {
    if (BROWSER_BLOCKED.has(p) || KNOWN_PORTS[p]) continue;
    if (ranges.some(([a, b]) => p >= a && p <= b)) continue;
    list.push(p);
  }
  return list;
}

function sample(list, count, skip) {
  const pool = list.filter((p) => !skip.has(p));
  const out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// ---------- HTTP ----------

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function parsePorts(str) {
  return [...new Set(String(str || "").split(",").map(Number))]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
    .slice(0, 500);
}

const server = http.createServer(async (req, res) => {
  // Schutz gegen DNS-Rebinding: nur Zugriffe über localhost zulassen
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return send(res, 403, { error: "forbidden host" });

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/api/info") return send(res, 200, await systemInfo());

    if (url.pathname === "/api/check") {
      const ports = parsePorts(url.searchParams.get("ports"));
      return send(res, 200, await checkPorts(ports));
    }

    if (url.pathname === "/api/who") {
      const port = parsePorts(url.searchParams.get("port"))[0];
      if (!port) return send(res, 400, { error: "port fehlt" });
      return send(res, 200, { port, processes: await whoUses(port) });
    }

    // Einfache Text-API: curl http://localhost:27183/api/port?count=3&min=1024&max=32767
    if (url.pathname === "/api/port") {
      const count = Math.min(Math.max(Number(url.searchParams.get("count")) || 1, 1), 50);
      const min = Math.max(Number(url.searchParams.get("min")) || 1024, 1);
      const max = Math.min(Number(url.searchParams.get("max")) || 32767, 65535);
      if (min > max) return send(res, 400, "min > max\n", "text/plain; charset=utf-8");
      const list = await apiCandidates(min, max);
      const found = [];
      const tried = new Set();
      for (let round = 0; round < 10 && found.length < count; round++) {
        const cands = sample(list, (count - found.length) * 2, tried);
        if (!cands.length) break;
        cands.forEach((p) => tried.add(p));
        for (const r of await checkPorts(cands)) if (r.status === "free" && found.length < count) found.push(r.port);
      }
      if (!found.length) return send(res, 404, "Kein freier Port im Bereich gefunden\n", "text/plain; charset=utf-8");
      return send(res, 200, found.join("\n") + "\n", "text/plain; charset=utf-8");
    }

    // Statische Dateien
    let file = decodeURIComponent(url.pathname);
    if (file === "/") file = "/index.html";
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden", "text/plain");
    fs.readFile(full, (err, data) => {
      if (err) return send(res, 404, "not found", "text/plain");
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (err) {
    send(res, 500, { error: String(err && err.message) });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} ist belegt. Starte mit anderem Port: PORT=12345 node server.js`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`RandomPortGen läuft auf http://localhost:${PORT}`);
});
