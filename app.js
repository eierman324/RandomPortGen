// RandomPortGen – Frontend-Logik
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_SETTINGS = "rpg.settings";
  const STORE_HISTORY = "rpg.history";

  // ---------- Speicher (robust gegen gesperrten localStorage) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };

  const DEFAULTS = {
    preset: "safe", min: 1024, max: 32767, count: 1, consecutive: false, project: "",
    avoidKnown: true, avoidHistory: true, avoidEphemeral: true, onlyFree: true, nice: false, tab: "env",
  };
  const settings = { ...DEFAULTS, ...store.get(STORE_SETTINGS, {}) };
  let history = store.get(STORE_HISTORY, []);

  let backend = null;          // Systeminfos vom lokalen Server, null = kein Server
  let current = [];            // [{port, status, detail}]
  let rollId = 0;              // verhindert, dass alte Scans neue Ergebnisse überschreiben

  // ---------- Zufall ----------
  function cryptoRandom() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  }
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Regeln ----------
  function isNice(p) {
    const s = String(p);
    if (s.length < 4) return false;
    if (/^(\d)\1+$/.test(s)) return true;                                  // 7777, 22222
    if (s === [...s].reverse().join("")) return true;                       // 12321, 4554
    if (s.length % 2 === 0 && /^(\d\d)\1+$/.test(s)) return true;         // 4242
    const d = [...s].map(Number);
    const asc = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
    const desc = d.every((v, i) => i === 0 || v === d[i - 1] - 1);
    if (asc || desc) return true;                                           // 1234, 54321
    if (/^\d{1,2}000$/.test(s) || /^[1-9]0{3,}$/.test(s)) return true;      // 13000
    if (s === "31337" || s === "1337" || s === "8008") return true;
    return false;
  }

  function inRanges(p, ranges) {
    return ranges.some(([a, b]) => p >= a && p <= b);
  }

  function rangeOf(p) {
    return IANA_RANGES.find((r) => p >= r.min && p <= r.max);
  }

  function historySet() {
    return new Set(history.map((h) => h.port));
  }

  // Liefert eine Funktion, die sagt, ob ein Port erlaubt ist.
  function makeValidator({ useHistory, exclude = new Set() }) {
    const hist = useHistory && settings.avoidHistory ? historySet() : new Set();
    const excluded = backend ? backend.excluded : [];
    const eph = settings.avoidEphemeral && backend && backend.ephemeral ? [backend.ephemeral] : [];
    return (p) =>
      p >= settings.min && p <= settings.max &&
      !BROWSER_BLOCKED.has(p) &&
      !(settings.avoidKnown && KNOWN_PORTS[p]) &&
      !hist.has(p) &&
      !exclude.has(p) &&
      !inRanges(p, excluded) &&
      !inRanges(p, eph) &&
      !(settings.nice && !isNice(p));
  }

  // Wählt `count` Ports aus allen erlaubten aus.
  function pick(count, consecutive, valid, rand) {
    const candidates = [];
    for (let p = settings.min; p <= settings.max; p++) if (valid(p)) candidates.push(p);

    if (consecutive && count > 1) {
      const ok = new Set(candidates);
      const starts = candidates.filter((s) => {
        for (let i = 1; i < count; i++) if (!ok.has(s + i)) return false;
        return true;
      });
      if (!starts.length) return null;
      const s = starts[Math.floor(rand() * starts.length)];
      return Array.from({ length: count }, (_, i) => s + i);
    }

    if (candidates.length < count) return null;
    // Teilweises Fisher-Yates: der erste Port hängt nur vom ersten Zufallswert ab,
    // dadurch bleibt er bei einem Projektnamen gleich, auch wenn die Anzahl steigt.
    const out = [];
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rand() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      out.push(candidates[i]);
    }
    return out;
  }

  // ---------- Scan ----------
  async function scan(ports) {
    if (!ports.length) return [];
    if (backend) {
      const res = await fetch(`/api/check?ports=${ports.join(",")}`, { cache: "no-store" });
      return res.json();
    }
    return Promise.all(ports.map(browserProbe));
  }

  // Ohne Server: versuchen, http://127.0.0.1:PORT zu laden.
  async function browserProbe(port) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      await fetch(`http://127.0.0.1:${port}/`, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      return { port, status: "likely-used", detail: "" };
    } catch (e) {
      // Keine Antwort in 1,5 s: Da nimmt wohl etwas die Verbindung an, spricht aber kein HTTP.
      if (e.name === "AbortError") return { port, status: "likely-used", detail: "" };
      return { port, status: "likely-free", detail: "" };
    } finally {
      clearTimeout(timer);
    }
  }

  const STATUS_LABEL = {
    checking: "prüfe…", free: "wahrscheinlich frei", used: "belegt", reserved: "reserviert",
    "likely-free": "wahrscheinlich frei", "likely-used": "wahrscheinlich belegt", unknown: "–",
  };
  const isTaken = (s) => s === "used" || s === "reserved" || s === "likely-used";

  // ---------- Generieren ----------
  async function roll() {
    const id = ++rollId;
    readInputs();
    const count = settings.count;
    const project = settings.project.trim();
    const rand = project ? mulberry32(fnv1a(project.toLowerCase())) : cryptoRandom;

    // Projektmodus ist deterministisch: Verlauf und Scan-Ergebnisse ändern die Auswahl nicht.
    const ports = pick(count, settings.consecutive, makeValidator({ useHistory: !project }), rand);
    if (!ports) return showError("Keine passenden Ports in diesem Bereich. Bereich vergrößern oder Filter lockern.");
    showError("");

    current = ports.map((port) => ({ port, status: "checking", detail: "" }));
    renderPorts();

    let results = await scan(ports);
    if (id !== rollId) return;

    // Belegte Ports ersetzen (nur im Zufallsmodus)
    if (!project && settings.onlyFree) {
      const bad = new Set();
      for (let round = 0; round < 8; round++) {
        const used = results.filter((r) => isTaken(r.status));
        if (!used.length) break;
        used.forEach((r) => bad.add(r.port));
        const keep = results.filter((r) => !bad.has(r.port));
        const exclude = new Set([...bad, ...keep.map((r) => r.port)]);
        const valid = makeValidator({ useHistory: true, exclude });

        if (settings.consecutive && count > 1) {
          const block = pick(count, true, valid, cryptoRandom);
          if (!block) break;
          results = await scan(block);
        } else {
          const extra = pick(count - keep.length, false, valid, cryptoRandom);
          if (!extra) break;
          results = [...keep, ...(await scan(extra))];
        }
        if (id !== rollId) return;
      }
    }

    current = results;
    renderPorts();
    addHistory(current.map((r) => r.port), project);
  }

  async function rescan() {
    if (!current.length) return;
    const id = ++rollId;
    current = current.map((r) => ({ ...r, status: "checking" }));
    renderPorts();
    const results = await scan(current.map((r) => r.port));
    if (id !== rollId) return;
    current = results;
    renderPorts();
  }

  // ---------- Darstellung ----------
  function renderPorts() {
    const list = $("ports");
    list.classList.toggle("multi", current.length > 1);
    list.replaceChildren(...current.map((r) => {
      const li = document.createElement("li");
      li.className = "port-row";

      const num = document.createElement("button");
      num.className = "port-num";
      num.textContent = r.port;
      num.title = "Klicken zum Kopieren";
      num.addEventListener("click", () => copy(String(r.port)));

      const meta = document.createElement("div");
      meta.className = "port-meta";
      const pill = document.createElement("span");
      pill.className = `pill ${r.status}`;
      pill.textContent = STATUS_LABEL[r.status] || r.status;
      pill.title = r.detail || "";
      meta.append(pill);

      const info = document.createElement("span");
      info.className = "muted small";
      const parts = [rangeOf(r.port).name];
      if (KNOWN_PORTS[r.port]) parts.push(`üblich für ${KNOWN_PORTS[r.port]}`);
      if (r.detail && r.status !== "free" && r.status !== "checking") parts.push(r.detail);
      info.textContent = parts.join(" · ");
      meta.append(info);

      li.append(num, meta);
      return li;
    }));

    $("resultTitle").textContent = current.length > 1 ? "Deine Ports" : "Dein Port";
    const project = settings.project.trim();
    $("modeNote").textContent = project ? `fest für „${project}“` : "zufällig";
    renderSnippet();
  }

  function showError(msg) {
    $("error").textContent = msg;
    $("error").hidden = !msg;
    if (msg) { current = []; renderPorts(); }
  }

  // ---------- Snippets ----------
  const SNIPPETS = {
    env: { label: ".env", make: (ps) => ps.length === 1 ? `PORT=${ps[0]}` : ps.map((p, i) => `PORT_${i + 1}=${p}`).join("\n") },
    docker: { label: "Docker", make: (ps) => `docker run ${ps.map((p) => `-p ${p}:${p}`).join(" ")} mein-image` },
    compose: {
      label: "Compose",
      make: (ps) => "services:\n" + ps.map((p, i) => `  ${svcName(i, ps.length)}:\n    ports:\n      - "${p}:${p}"`).join("\n"),
    },
    vite: { label: "Vite", make: (ps) => `// vite.config.js\nexport default defineConfig({\n  server: { port: ${ps[0]}, strictPort: true },\n});` },
    node: { label: "Node", make: (ps) => `const PORT = process.env.PORT || ${ps[0]};\napp.listen(PORT, () => console.log(\`http://localhost:\${PORT}\`));` },
    python: { label: "Python", make: (ps) => `python -m http.server ${ps[0]}\n# FastAPI\nuvicorn main:app --port ${ps[0]}\n# Flask\nflask run --port ${ps[0]}` },
    check: {
      label: "Prüfbefehl",
      make: (ps) => `# Windows (PowerShell)\n${ps.map((p) => `netstat -ano | findstr :${p}`).join("\n")}\n\n# Linux / macOS\n${ps.map((p) => `lsof -nP -iTCP:${p} -sTCP:LISTEN`).join("\n")}`,
    },
    api: {
      label: "API",
      make: (ps) => `# Freie Ports direkt im Terminal (lokaler Server muss laufen)\ncurl "http://localhost:27183/api/port?count=${ps.length}&min=${settings.min}&max=${settings.max}"\n\n# PowerShell\nirm "http://localhost:27183/api/port?count=${ps.length}&min=${settings.min}&max=${settings.max}"`,
    },
  };
  const svcName = (i, n) => (n === 1 ? "app" : ["frontend", "api", "db", "cache", "worker"][i] || `service${i + 1}`);

  function renderTabs() {
    $("snippetTabs").replaceChildren(...Object.entries(SNIPPETS).map(([key, s]) => {
      const b = document.createElement("button");
      b.className = "tab";
      b.role = "tab";
      b.textContent = s.label;
      b.setAttribute("aria-selected", String(settings.tab === key));
      b.addEventListener("click", () => { settings.tab = key; save(); renderTabs(); renderSnippet(); });
      return b;
    }));
  }

  function renderSnippet() {
    const ps = current.map((r) => r.port);
    const s = SNIPPETS[settings.tab] || SNIPPETS.env;
    $("snippet").firstElementChild.textContent = ps.length ? s.make(ps) : "Erst würfeln.";
  }

  // ---------- Bereich ----------
  function renderPresets() {
    $("presets").replaceChildren(...Object.entries(PRESETS).map(([key, p]) => {
      const b = document.createElement("button");
      b.className = "seg";
      b.role = "radio";
      b.textContent = p.label;
      b.setAttribute("aria-checked", String(settings.preset === key));
      b.addEventListener("click", () => {
        settings.preset = key;
        if (p.min !== null) { settings.min = p.min; settings.max = p.max; }
        writeInputs(); save(); renderPresets(); roll();
      });
      return b;
    }));
    const p = PRESETS[settings.preset];
    $("rangeHint").textContent = settings.preset === "custom"
      ? `${settings.min}–${settings.max} · eigener Bereich`
      : p.hint;
  }

  function writeInputs() {
    $("min").value = settings.min;
    $("max").value = settings.max;
    $("count").value = settings.count;
    $("consecutive").checked = settings.consecutive;
    $("project").value = settings.project;
    for (const k of ["avoidKnown", "avoidHistory", "avoidEphemeral", "onlyFree", "nice"]) $(k).checked = settings[k];
  }

  function readInputs() {
    const clamp = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), lo), hi) : fb);
    let min = clamp(Number($("min").value), 1, 65535, settings.min);
    let max = clamp(Number($("max").value), 1, 65535, settings.max);
    if (min > max) [min, max] = [max, min];
    if (min !== settings.min || max !== settings.max) {
      const match = Object.entries(PRESETS).find(([, p]) => p.min === min && p.max === max);
      settings.preset = match ? match[0] : "custom";
    }
    settings.min = min;
    settings.max = max;
    settings.count = clamp(Number($("count").value), 1, 20, 1);
    settings.consecutive = $("consecutive").checked;
    settings.project = $("project").value;
    for (const k of ["avoidKnown", "avoidHistory", "avoidEphemeral", "onlyFree", "nice"]) settings[k] = $(k).checked;
    writeInputs();
    renderPresets();
    save();
  }

  function save() { store.set(STORE_SETTINGS, settings); }

  // ---------- Verlauf ----------
  function addHistory(ports, project) {
    const now = Date.now();
    for (const port of ports) {
      history = history.filter((h) => !(h.port === port && h.project === project));
      history.unshift({ port, project, ts: now });
    }
    history = history.slice(0, 200);
    store.set(STORE_HISTORY, history);
    renderHistory();
  }

  function renderHistory() {
    const list = $("history");
    if (!history.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Noch nichts gewürfelt.";
      return list.replaceChildren(li);
    }
    const fmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });
    list.replaceChildren(...history.map((h) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.textContent = h.port;
      b.title = "Kopieren";
      b.addEventListener("click", () => copy(String(h.port)));
      li.append(b);
      if (h.project) {
        const s = document.createElement("span");
        s.className = "proj";
        s.textContent = h.project;
        li.append(s);
      }
      const t = document.createElement("time");
      t.textContent = fmt.format(h.ts);
      li.append(t);
      return li;
    }));
  }

  // ---------- Nachschlagen ----------
  async function lookup(port) {
    const dl = $("lookupResult");
    const rows = [];
    const add = (k, v) => rows.push([k, v]);
    const r = rangeOf(port);
    add("Bereich", `${r.name} – ${r.note}`);
    add("Bekannt als", KNOWN_PORTS[port] || "–");
    add("Browser", BROWSER_BLOCKED.has(port) ? "Gesperrt (ERR_UNSAFE_PORT) – Websites darauf laden nicht" : "Erlaubt");
    if (backend && backend.ephemeral) {
      add("Ephemeral", inRanges(port, [backend.ephemeral]) ? `Ja (System nutzt ${backend.ephemeral.join("–")})` : "Nein");
    }
    if (backend && backend.platform === "win32") {
      const hit = backend.excluded.find(([a, b]) => port >= a && port <= b);
      add("Windows-Reservierung", hit ? `Ja, im Block ${hit[0]}–${hit[1]}` : "Nein");
    }
    add("Status", "prüfe…");
    renderFacts(dl, rows);

    let res;
    if (BROWSER_BLOCKED.has(port) && !backend) {
      res = { status: "unknown", detail: "" };
    } else {
      [res] = await scan([port]);
    }
    const label = STATUS_LABEL[res.status] || res.status;
    rows[rows.length - 1] = ["Status", res.detail ? `${label} – ${res.detail}` : label];

    if (backend && res.status === "used") {
      try {
        const who = await (await fetch(`/api/who?port=${port}`)).json();
        if (who.processes.length) add("Prozess", who.processes.map((p) => `${p.name} (PID ${p.pid})`).join(", "));
      } catch {}
    }
    renderFacts(dl, rows);
  }

  function renderFacts(dl, rows) {
    dl.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  // ---------- System ----------
  function renderSystem() {
    const box = $("systemInfo");
    const badge = $("scanBadge");
    if (!backend) {
      // Ohne lokalen Server gibt es keine Systeminfos: Abzeichen und Karte ausblenden
      badge.hidden = true;
      box.closest(".card").hidden = true;
      return;
    }
    badge.textContent = "Lokaler Scanner aktiv";
    badge.className = "badge ok";

    const names = { win32: "Windows", linux: "Linux", darwin: "macOS" };
    box.innerHTML = "";
    const p1 = document.createElement("p");
    p1.textContent = `${names[backend.platform] || backend.platform} · ${backend.hostname}`;
    box.append(p1);

    const p2 = document.createElement("p");
    p2.textContent = backend.ephemeral
      ? `Ephemeral-Bereich: ${backend.ephemeral[0]}–${backend.ephemeral[1]}`
      : "Ephemeral-Bereich: unbekannt";
    box.append(p2);

    if (backend.platform === "win32") {
      const p3 = document.createElement("p");
      p3.textContent = backend.excluded.length
        ? `Von Windows reserviert (Hyper-V, WSL, Docker) – ${backend.excluded.length} Blöcke, werden automatisch gemieden:`
        : "Keine von Windows reservierten Portbereiche gefunden.";
      box.append(p3);
      if (backend.excluded.length) {
        const wrap = document.createElement("div");
        wrap.className = "ranges";
        for (const [a, b] of backend.excluded) {
          const s = document.createElement("span");
          s.textContent = a === b ? a : `${a}–${b}`;
          wrap.append(s);
        }
        box.append(wrap);
      }
      const p4 = document.createElement("p");
      p4.className = "small";
      p4.innerHTML = "Selbst nachsehen: <code>netsh interface ipv4 show excludedportrange protocol=tcp</code>";
      box.append(p4);
    }
  }

  async function detectBackend() {
    if (location.protocol === "file:") return null;
    try {
      const res = await fetch("/api/info", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.platform ? data : null;
    } catch { return null; }
  }

  // ---------- Hilfen ----------
  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1400);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(`Kopiert: ${text.length > 40 ? text.slice(0, 40) + "…" : text}`);
  }

  // ---------- Ereignisse ----------
  function bind() {
    $("roll").addEventListener("click", roll);
    $("rescan").addEventListener("click", rescan);
    $("copyAll").addEventListener("click", () => current.length && copy(current.map((r) => r.port).join(", ")));
    $("copySnippet").addEventListener("click", () => copy($("snippet").textContent));
    $("clearHistory").addEventListener("click", () => {
      history = [];
      store.set(STORE_HISTORY, history);
      renderHistory();
    });

    for (const id of ["min", "max", "count", "consecutive", "avoidKnown", "avoidHistory", "avoidEphemeral", "onlyFree", "nice"]) {
      $(id).addEventListener("change", roll);
    }
    let projectTimer;
    $("project").addEventListener("input", () => {
      clearTimeout(projectTimer);
      projectTimer = setTimeout(roll, 300);
    });

    $("lookupForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const p = Number($("lookupPort").value);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) lookup(p);
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (["input", "textarea", "select", "button"].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") { e.preventDefault(); roll(); }
      if (e.key === "c" || e.key === "C") $("copyAll").click();
    });
  }

  async function init() {
    writeInputs();
    renderPresets();
    renderTabs();
    renderHistory();
    bind();
    backend = await detectBackend();
    renderSystem();
    roll();
  }

  init();
})();
