// Renders film.html to out/passforge-demo.mp4 (1920×1080, 30 fps, synthesized soundtrack).
//   node render.mjs                 full render (needs shots/ from capture.mjs, ffmpeg on PATH)
//   node render.mjs --stills 3,45   out/still-<t>.png only (quick visual checks)
//   node render.mjs --audio         out/soundtrack.wav only
//   node render.mjs --serve         serve this folder on :4175 for live preview (film.html?play)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const FPS = 30, DURATION = 120, SR = 44100, PORT = 4175;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Must match CLICKS / scene times in film.html.
const CLICKS = [45.5, 55.4, 59.0, 61.8, 65.0, 76.4, 79.9, 82.3, 85.5, 88.2, 104.0];
const WHOOSH = [7.4, 19.4, 36.5, 73.5, 93.3, 109.4];
const DISCONNECT = 59.0, RECONNECT = 82.3;

/* ------------------------------------------------------------------ static server */
function serve() {
  const types = { ".html": "text/html", ".png": "image/png", ".json": "application/json", ".js": "text/javascript" };
  return http
    .createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(here, rel === "/" ? "film.html" : rel);
      if (!file.startsWith(here) || !fs.existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(PORT);
}

/* ------------------------------------------------------------------ soundtrack (92 bpm, D minor) */
function soundtrack() {
  const N = SR * DURATION;
  const bus = () => new Float32Array(N);
  const pad = bus(), pluck = bus(), bass = bus(), drums = bus(), fx = bus();
  const midi = (m) => 440 * 2 ** ((m - 69) / 12);
  let seed = 11;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;
  const wave = (type, p) => { p -= Math.floor(p); return type === "saw" ? 2 * p - 1 : type === "tri" ? 4 * Math.abs(p - 0.5) - 1 : Math.sin(2 * Math.PI * p); };
  function note(buf, t, dur, f, o = {}) {
    const { type = "sine", vol = 0.2, a = 0.01, d = 0.1, s = 0.7, r = 0.2, voices = 1, detune = 0.006, cutoff = 0 } = o;
    const i0 = Math.floor(t * SR), len = Math.floor((dur + r) * SR);
    const ph = Array.from({ length: voices }, (_, v) => v / voices);
    let y = 0;
    for (let i = 0; i < len && i0 + i < N; i++) {
      const tt = i / SR;
      const env = tt < a ? tt / a : tt < a + d ? 1 - (1 - s) * ((tt - a) / d) : tt < dur ? s : s * Math.max(0, 1 - (tt - dur) / r);
      let x = 0;
      for (let v = 0; v < voices; v++) { ph[v] += (f * (1 + (voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune : 0))) / SR; x += wave(type, ph[v]); }
      x /= Math.sqrt(voices);
      if (cutoff) { y += (1 - Math.exp((-2 * Math.PI * cutoff) / SR)) * (x - y); x = y; }
      if (i0 + i >= 0) buf[i0 + i] += x * env * vol;
    }
  }
  const kick = (t, vol = 0.8) => { let p = 0; for (let i = 0; i < 0.3 * SR; i++) { const tt = i / SR; p += (48 + 90 * Math.exp(-tt * 30)) / SR; const k = Math.floor(t * SR) + i; if (k < N) drums[k] += Math.sin(2 * Math.PI * p) * Math.exp(-tt * 10) * vol; } };
  const hat = (t, vol = 0.07) => { let y = 0; for (let i = 0; i < 0.04 * SR; i++) { const n = noise(); y += 0.6 * (n - y); const k = Math.floor(t * SR) + i; if (k < N) drums[k] += (n - y) * Math.exp(-i / SR * 80) * vol; } };
  const clap = (t, vol = 0.18) => { let y = 0; for (let i = 0; i < 0.18 * SR; i++) { const n = noise(); y += 0.3 * (n - y); const k = Math.floor(t * SR) + i; if (k < N) drums[k] += (n - y) * Math.exp(-i / SR * 22) * vol; } };
  const swell = (t0, t1, f0, f1, vol, decay = false) => { let y = 0; for (let i = Math.floor(t0 * SR); i < t1 * SR && i < N; i++) { const k = (i / SR - t0) / (t1 - t0), fc = f0 * (f1 / f0) ** k; y += (1 - Math.exp((-2 * Math.PI * fc) / SR)) * (noise() - y); fx[i] += y * vol * (decay ? Math.exp(-k * 4) : k * k); } };
  const tick = (t) => { for (let i = 0; i < 0.03 * SR; i++) { const tt = i / SR, k = Math.floor(t * SR) + i; if (k < N) fx[k] += (Math.sin(2 * Math.PI * 2400 * tt) * 0.5 + noise() * 0.5) * Math.exp(-tt * 260) * 0.35; } };

  const BEAT = 60 / 92, BAR = BEAT * 4;
  const CH = [[62, 65, 69], [58, 62, 65], [65, 69, 72], [60, 64, 67]]; // Dm Bb F C
  const ROOT = [38, 34, 41, 36];
  const grooveOn = (t) => (t >= 36.5 && t < DISCONNECT) || (t >= RECONNECT && t < 109.4);
  const nBars = Math.ceil(DURATION / BAR);
  for (let b = 0; b < nBars; b++) {
    const t0 = b * BAR, c = b % 4;
    if (t0 > 118) break;
    const dark = t0 >= DISCONNECT - BAR && t0 < RECONNECT - BAR / 2;
    CH[c].forEach((m) => note(pad, t0, BAR, midi(m), { type: "saw", voices: 4, detune: 0.01, vol: 0.05, a: 1.2, d: 0.4, s: 0.9, r: 1.2, cutoff: dark ? 380 : t0 < 8 ? 700 : 1300 }));
    note(bass, t0, BAR * 0.95, midi(ROOT[c] - 12), { vol: dark ? 0.12 : 0.22, a: 0.2, s: 1, r: 0.4 });
    if (t0 >= 8 && !dark) for (let s = 0; s < 8; s++) {
      const m = CH[c][s % 3] + 12 + (s % 4 === 3 ? 12 : 0);
      note(pluck, t0 + s * BEAT / 2, BEAT * 0.45, midi(m), { type: "tri", vol: t0 < 20 ? 0.035 : 0.05, a: 0.003, d: 0.12, s: 0.15, r: 0.15 });
    }
    for (let q = 0; q < 4; q++) {
      const tq = t0 + q * BEAT;
      if (!grooveOn(tq)) continue;
      kick(tq, 0.7);
      if (q % 2) clap(tq);
      hat(tq + BEAT / 2);
    }
  }
  swell(0.2, 0.8, 300, 4000, 0.12); kick(0.6, 0.9); swell(0.6, 3.5, 6000, 800, 0.12, true);
  for (const w of WHOOSH) swell(w - 0.9, w + 0.1, 400, 7000, 0.11);
  for (const c of CLICKS) tick(c);
  // disconnect: power-down sweep; reconnect: rising chime
  { let p = 0; for (let i = 0; i < 1.2 * SR; i++) { const tt = i / SR; p += (520 * Math.exp(-tt * 3.2) + 40) / SR; const k = Math.floor(DISCONNECT * SR) + i; fx[k] += Math.sin(2 * Math.PI * p) * 0.16 * Math.exp(-tt * 2.2); } }
  [74, 78, 81, 86].forEach((m, i) => note(fx, RECONNECT + i * 0.07, 0.5, midi(m), { vol: 0.07, a: 0.005, d: 0.2, s: 0.3, r: 0.6 }));
  // "No password." stinger
  note(fx, 65.6, 1.6, midi(38), { type: "saw", voices: 3, vol: 0.12, a: 0.01, s: 0.6, r: 1.2, cutoff: 500 }); kick(65.6, 1.0);
  // outro chord
  [62, 65, 69, 74].forEach((m) => note(pad, 110.3, 7.5, midi(m), { type: "saw", voices: 5, detune: 0.01, vol: 0.06, a: 0.3, s: 0.9, r: 2.2, cutoff: 1500 }));
  note(bass, 110.3, 7.5, midi(26), { vol: 0.25, a: 0.2, s: 1, r: 2 }); kick(110.3, 1.0);

  const reverb = (buf, mix) => {
    const combs = [1557, 1617, 1491, 1422, 1277].map((n) => ({ b: new Float32Array(n), i: 0 }));
    const o = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (const c of combs) { const y = c.b[c.i]; c.b[c.i] = buf[i] + y * 0.84; c.i = (c.i + 1) % c.b.length; s += y; } o[i] = buf[i] + (s / 5) * mix; }
    return o;
  };
  const padV = reverb(pad, 0.6), pluckV = reverb(pluck, 0.35), fxV = reverb(fx, 0.25);
  const L = new Float32Array(N), R = new Float32Array(N);
  const d = Math.floor(BEAT * 0.75 * SR);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, i / (0.5 * SR), (N - i) / (2 * SR));
    const pl = pluckV[i] + (i >= d ? pluckV[i - d] * 0.35 : 0);
    const pr_ = pluckV[i] + (i >= 2 * d ? pluckV[i - 2 * d] * 0.25 : 0);
    L[i] = (padV[i] * 1.1 + pl + bass[i] + drums[i] + fxV[i]) * fade;
    R[i] = (padV[i] * 0.9 + pr_ + bass[i] + drums[i] + fxV[i]) * fade;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.4); R[i] = Math.tanh(R[i] * 1.4); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const g = 0.89 / peak, wav = Buffer.alloc(44 + N * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + N * 4, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { wav.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
  const file = path.join(out, "soundtrack.wav");
  fs.writeFileSync(file, wav);
  return file;
}

/* ------------------------------------------------------------------ frames */
async function openFilm() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/film.html`, { waitUntil: "networkidle0" });
  await page.evaluate(() => window.ready);
  return { browser, page };
}
const grab = async (page, t, type = "jpeg") => {
  await page.evaluate((t) => window.seek(t), t);
  return page.screenshot({ type, ...(type === "jpeg" ? { quality: 92 } : {}), optimizeForSpeed: true });
};

if (!fs.existsSync(path.join(here, "shots/shots.json")) && args[0] !== "--audio") {
  console.error("shots/ missing — run `node capture.mjs` first");
  process.exit(1);
}

if (args[0] === "--serve") {
  serve();
  console.log(`preview: http://localhost:${PORT}/film.html?play   (or ?t=45)`);
} else if (args[0] === "--audio") {
  console.log("wrote", soundtrack());
} else if (args[0] === "--stills") {
  const server = serve();
  const { browser, page } = await openFilm();
  for (const t of (args[1] ?? "1.5,5,13,30,42,47,57,68,78,83,89,100,107,114").split(",").map(Number)) {
    fs.writeFileSync(path.join(out, `still-${t}.png`), await grab(page, t, "png"));
  }
  await browser.close(); server.close();
  console.log("stills in", out);
} else {
  const wav = soundtrack();
  console.log("soundtrack:", wav);
  const server = serve();
  const mp4 = path.join(out, "passforge-demo.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-i", wav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4],
  { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())));
  const { browser, page } = await openFilm();
  const frames = FPS * DURATION;
  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    const jpg = await grab(page, f / FPS);
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % FPS === 0) process.stdout.write(`\rframe ${f}/${frames}  (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  ff.stdin.end();
  await browser.close(); server.close();
  await done;
  console.log(`\nwrote ${mp4}`);
}
