// Captures the real PassForge UI in each state the film needs.
//   desktop  → Vite dev server with the in-memory mock backend (desktop/src/api-mock.ts)
//   extension → packages/passforge-extension/dist with stubbed chrome.* APIs and a
//               fake loopback backend, so no running app is required.
// Writes shots/<name>.png (2× DPR) and shots/shots.json with element boxes in CSS
// px, which the film uses to aim the animated cursor.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const shotsDir = path.join(here, "shots");
fs.mkdirSync(shotsDir, { recursive: true });
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DESKTOP_URL = "http://localhost:1420";
const EXT_PORT = 4174;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = { desktop: { width: 1180, height: 760, shots: {} }, extension: { width: 340, shots: {} } };

// ---------------------------------------------------------------- servers
async function waitFor(url, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startVite() {
  const proc = spawn(
    process.execPath,
    [path.join(root, ".yarn/releases/yarn-4.14.1.cjs"), "workspace", "passforge-desktop", "dev"],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"], detached: true },
  );
  return () => {
    try {
      process.kill(-proc.pid);
    } catch {}
  };
}

function startExtensionServer() {
  const dist = path.join(root, "packages/passforge-extension/dist");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = http
    .createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(dist, rel === "/" ? "index.html" : rel);
      if (!file.startsWith(dist) || !fs.existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(EXT_PORT);
  return () => server.close();
}

// ---------------------------------------------------------------- helpers
async function box(page, finder) {
  const handle = await page.evaluateHandle(finder);
  const el = handle.asElement();
  if (!el) throw new Error(`element not found: ${finder}`);
  const b = await el.boundingBox();
  return { el, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
}
const byText = (text, tag = "button") =>
  new Function(
    `return [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)}) && e.offsetParent !== null)`,
  );
const byLabel = (label) =>
  new Function(`return document.querySelector('[aria-label=${JSON.stringify(label)}]')`);
const byLabelPrefix = (prefix) =>
  new Function(`return document.querySelector('[aria-label^=${JSON.stringify(prefix)}]')`);

async function click(page, finder) {
  const { el, box: b } = await box(page, finder);
  await el.click();
  await sleep(350);
  return b;
}

/** Cosmetic: the mock backend reports port 0 / version "mock". */
async function polish(page) {
  await page.evaluate(() => {
    const swap = [
      ["127.0.0.1:0", "127.0.0.1:53473"],
      ["vmock", "v12.0.0"],
      ["PassForge mock algorithm server · 1.0.0", "PassForge reference server · 12.0.0"],
      ["PassForge mock algorithm server", "PassForge reference server"],
    ];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode())
      for (const [a, b] of swap) if (n.nodeValue.includes(a)) n.nodeValue = n.nodeValue.replaceAll(a, b);
    document.activeElement?.blur?.();
  });
}

async function shoot(page, group, name, targets = {}, opts = {}) {
  await sleep(250);
  await polish(page);
  const file = path.join(shotsDir, `${name}.png`);
  // Extension: clip to the popup's own height (no scrolling, stable boxes).
  const height = opts.fullPage
    ? Math.ceil(await page.evaluate(() => document.querySelector(".popup").getBoundingClientRect().bottom))
    : manifest[group].height;
  await page.screenshot({ path: file, ...(opts.fullPage ? { clip: { x: 0, y: 0, width: 340, height } } : {}) });
  manifest[group].shots[name] = { file: `${name}.png`, height, targets };
  console.log(`  ${group}/${name}`);
}

// ---------------------------------------------------------------- desktop
async function captureDesktop(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1180, height: 760, deviceScaleFactor: 2 });
  await page.goto(DESKTOP_URL, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[placeholder="Master password"]');
  await page.type('input[placeholder="Master password"]', "correct horse battery staple", { delay: 0 });
  await shoot(page, "desktop", "d0-lock");
  await click(page, byText("Unlock Vault"));
  await page.waitForFunction(() => document.body.innerText.includes("github.com"));

  const entry = await click(page, byText("github.com"));
  await page.waitForSelector('[aria-label="Backend connected"]');
  const reveal = (await box(page, byLabel("Reveal password"))).box;
  const chip = (await box(page, byLabelPrefix("Backend "))).box;
  const copy = (await box(page, byLabel("Copy password"))).box;
  await shoot(page, "desktop", "d1-connected", { entry, reveal, chip, copy });

  await click(page, byLabel("Reveal password"));
  await page.waitForFunction(() => !document.body.innerText.includes("Reveal or copy to generate"));
  await shoot(page, "desktop", "d2-revealed", { chip, reveal, copy });

  await click(page, byLabelPrefix("Backend "));
  await page.waitForFunction(() => document.body.innerText.includes("PassForge local backend"));
  const disconnect = (await box(page, byText("Disconnect"))).box;
  await shoot(page, "desktop", "d3-servers-connected", { disconnect });

  await click(page, byText("Disconnect"));
  const close = (await box(page, byText("Close"))).box;
  const connect = (await box(page, byText("Connect"))).box;
  await shoot(page, "desktop", "d4-servers-disconnected", { close, connect });

  await click(page, byText("Close"));
  await shoot(page, "desktop", "d5-gate", { copy, chip });
  await click(page, byLabel("Copy password"));
  await page.waitForFunction(() => document.body.innerText.includes("Not connected to the PassForge backend"));
  const gate = (await box(page, () => document.querySelector('[data-testid="backend-gate"]'))).box;
  await shoot(page, "desktop", "d6-copy-refused", { copy, gate, chip });

  // Reconnect and pick an algorithm server.
  await click(page, byLabelPrefix("Backend "));
  await click(page, byText("Connect"));
  await page.waitForFunction(() => document.body.innerText.includes("connected"));
  await page.type('[aria-label="Algorithm server URL"]', "http://127.0.0.1:8790");
  await click(page, byText("Add server"));
  await page.waitForSelector('[data-testid="algorithm-server-row"]');
  await sleep(400);
  const use = (await box(page, () => document.querySelector('[data-testid="algorithm-server-row"] button:not([aria-label])'))).box;
  await shoot(page, "desktop", "d7-server-added", { use });
  await click(page, () => document.querySelector('[data-testid="algorithm-server-row"] button:not([aria-label])'));
  await page.waitForFunction(() => document.querySelector('[data-testid="algorithm-server-row"]').innerText.includes("Disconnect"));
  await shoot(page, "desktop", "d8-server-active", { close: (await box(page, byText("Close"))).box });

  await click(page, byText("Close"));
  await click(page, () => document.querySelector('[aria-label="Reveal password"], [aria-label="Conceal password"]'));
  await page.waitForFunction(() => !document.body.innerText.includes("Reveal or copy to generate"));
  const footer = (await box(page, () => document.querySelector("footer"))).box;
  await shoot(page, "desktop", "d9-server-mode", { footer, reveal });
  await page.close();
}

// ---------------------------------------------------------------- extension
function extensionStubs() {
  const entry = {
    id: "e1", site: "github.com", login: "dev@passforge.io", counter: 2, folder_id: "f1",
    profile: {
      site: "github.com", login: "dev@passforge.io", counter: 2, salt_fields: [],
      options: { lowercase: true, uppercase: true, digits: true, symbols: true, length: 16 },
    },
  };
  const store = {};
  window.chrome = {
    runtime: {
      lastError: undefined,
      sendNativeMessage(_host, msg, cb) {
        const result = {
          ping: { version: "12.0.0" },
          api_info: { port: 53473, token: "demo" },
          search: [entry],
          get_entry: entry,
        }[msg.op];
        setTimeout(() => cb({ status: "ok", result }), 40);
      },
    },
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => Object.assign(store, o),
      },
    },
    tabs: { query: (_q, cb) => cb([{ url: "https://github.com/login" }]) },
  };
  let settings = {
    defaultCrypto: { iterations: 100000, keylen: 32, digest: "sha256" },
    idleLockSeconds: 60, clipboardClearSeconds: 30,
    generation: { mode: "serverless" }, knownServers: ["http://127.0.0.1:8790"],
  };
  const info = {
    protocol: "passforge-remote-v1", name: "PassForge reference server", version: "12.0.0",
    default_algorithm: "argon2id-v1",
    algorithms: [
      { id: "argon2id-v1", description: "Argon2id m=64MiB t=3 p=1", portable: true },
      { id: "pbkdf2-sha512-v1", description: "PBKDF2-HMAC-SHA512", portable: true },
    ],
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("http://127.0.0.1:53473")) return realFetch(url, init);
    const p = new URL(url).pathname;
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (p === "/api/health") return json({ version: "12.0.0", locked: false });
    if (p === "/api/fingerprint")
      return json([{ icon: "fa-rocket", color: "#009191" }, { icon: "fa-heart", color: "#FF6CB6" }, { icon: "fa-flask", color: "#6DB5FE" }]);
    if (p === "/api/generate") return json({ password: "q7#Lm9!vRt2&Xw4k" });
    if (p === "/api/server-info") return json(info);
    if (p === "/api/settings") {
      if (init.method === "PUT") settings = JSON.parse(init.body);
      return json(settings);
    }
    return new Response("{}", { status: 404 });
  };
}

async function captureExtension(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 340, height: 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(extensionStubs);
  await page.goto(`http://localhost:${EXT_PORT}/index.html`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.innerText.includes("backend disconnected"));
  await sleep(300);
  const serversTab = (await box(page, byText("Servers", '[role="tab"]'))).box;
  const generateBtn = (await box(page, byText("Generate", "button.action"))).box;
  await shoot(page, "extension", "e1-disconnected", { serversTab, generateBtn }, { fullPage: true });

  await click(page, byText("Servers", '[role="tab"]'));
  const connect = (await box(page, byText("Connect"))).box;
  await shoot(page, "extension", "e2-servers-disconnected", { connect }, { fullPage: true });

  await click(page, byText("Connect"));
  await page.waitForFunction(() => document.body.innerText.includes("Built-in (serverless)"));
  await sleep(400);
  const generateTab = (await box(page, byText("Generate", '[role="tab"]'))).box;
  await shoot(page, "extension", "e3-servers-connected", { generateTab }, { fullPage: true });

  await click(page, byText("Generate", '[role="tab"]'));
  await page.type('input[type="password"]', "correct horse battery staple");
  await sleep(400);
  const gen = (await box(page, byText("Generate", "button.action"))).box;
  await shoot(page, "extension", "e4-ready", { generateBtn: gen }, { fullPage: true });
  await click(page, byText("Generate", "button.action"));
  await page.waitForFunction(() => document.querySelector(".pw").textContent.includes("q7#"));
  await shoot(page, "extension", "e5-generated", { generateBtn: gen }, { fullPage: true });
  await page.close();
}

// ---------------------------------------------------------------- main
const stopVite = startVite();
const stopExt = startExtensionServer();
try {
  await waitFor(DESKTOP_URL);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
  console.log("capturing desktop…");
  await captureDesktop(browser);
  console.log("capturing extension…");
  await captureExtension(browser);
  await browser.close();
  fs.writeFileSync(path.join(shotsDir, "shots.json"), JSON.stringify(manifest, null, 2));
  console.log(`wrote ${shotsDir}/shots.json`);
} finally {
  stopVite();
  stopExt();
}
