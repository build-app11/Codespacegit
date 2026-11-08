// Mesin suara di server: Piper (CLI `piper`) dan Pocket TTS (Python, pocket_worker.py).
// Model Pocket dimuat sekali lalu tetap di memori supaya permintaan berikutnya cepat. Satu antrean per mesin.
// Pocket juga bisa dijalankan di perangkat pengguna (browser, lihat public/index.html); server tetap jadi cadangan.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, "models");
const PIPER_DIR = path.join(MODELS_DIR, "piper");
const PIPER_BIN = process.env.PIPER_BIN || "piper";
const PYTHON = process.env.PYTHON || "python3";

// ---------- util ----------
const queues = {};
const enqueue = (name, fn) => {   // satu pekerjaan per mesin dalam satu waktu
  const p = (queues[name] || Promise.resolve()).catch(() => {}).then(fn);
  queues[name] = p;
  return p;
};
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };

// ---------- Piper ----------
function piperPaths(id) {
  if (!/^[a-z]{2,3}_[A-Z]{2}-[\w]+-(x_low|low|medium|high)$/.test(id)) throw new Error("ID suara Piper tidak valid");
  return { onnx: path.join(PIPER_DIR, id + ".onnx"), json: path.join(PIPER_DIR, id + ".onnx.json") };
}
async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!r.ok) throw new Error("Unduhan gagal (HTTP " + r.status + "): " + url.split("/").pop());
  const tmp = dest + ".part";
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(tmp, dest);
}
async function piperEnsure(id) {
  const p = piperPaths(id);
  if (exists(p.onnx) && exists(p.json)) return p;
  fs.mkdirSync(PIPER_DIR, { recursive: true });
  const [loc, name, q] = id.split("-"), base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/" + loc.split("_")[0] + "/" + loc + "/" + name + "/" + q + "/" + id;
  await download(base + ".onnx.json", p.json);
  await download(base + ".onnx", p.onnx);
  return p;
}
function run(cmd, args, input, timeout = 120000) {
  return new Promise((ok, no) => {
    const c = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "", t = setTimeout(() => { c.kill("SIGKILL"); no(new Error("Proses " + cmd + " terlalu lama")); }, timeout);
    c.stderr.on("data", (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    c.on("error", (e) => { clearTimeout(t); no(e.code === "ENOENT" ? new Error("Perintah '" + cmd + "' tidak ditemukan di server. Pasang dulu (lihat README).") : e); });
    c.on("close", (code) => { clearTimeout(t); code === 0 ? ok() : no(new Error(cmd + " keluar dengan kode " + code + ": " + err.trim().split("\n").pop())); });
    c.stdin.on("error", () => {});
    c.stdin.end(input || "");
  });
}
async function piperGen(id, text) {
  const p = await piperEnsure(id), out = path.join(os.tmpdir(), "piper-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".wav");
  try {
    await run(PIPER_BIN, ["-m", p.onnx, "-f", out], String(text).replace(/\s+/g, " ").trim() + "\n");
    return fs.readFileSync(out);
  } finally { try { fs.unlinkSync(out); } catch (e) {} }
}
let piperList = null;
async function piperVoices() {   // daftar resmi suara Piper (satu pembicara)
  if (!piperList) {
    const r = await fetch("https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json", { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("Daftar suara Piper gagal dimuat (HTTP " + r.status + ")");
    const j = await r.json();
    piperList = Object.keys(j).filter((k) => (j[k].num_speakers || 1) <= 1).map((k) => ({ id: k, lang: ((j[k].language && j[k].language.code) || k.split("-")[0]).replace("_", "-") }));
  }
  return piperList;
}
const piperStored = () => { try { return fs.readdirSync(PIPER_DIR).filter((f) => f.endsWith(".onnx") && exists(path.join(PIPER_DIR, f + ".json"))).map((f) => f.slice(0, -5)); } catch (e) { return []; } };

// ---------- Pocket TTS (Python, Kyutai) ----------
const POCKET_VOICES = ["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma", "juergen", "lola", "giovanni", "rafael", "estelle"];
const POCKET_LANGS = ["en", "de", "es", "it", "pt", "fr", "nl", "ja"];
const CLONE_LANGS = ["en", "de", "fr", "es", "it", "pt"];   // bahasa yang bisa dipakai untuk suara klon
const baseLang = (l) => String(l || "en").toLowerCase().replace("_", "-").split("-")[0];
const pocketLangOf = (l) => { l = baseLang(l); return POCKET_LANGS.includes(l) ? l : "en"; };
const cloneLangOf = (l) => { l = baseLang(l); return CLONE_LANGS.includes(l) ? l : "en"; };
let pw = null, pwPending = {}, pwId = 0, pwBuf = "", pwErr = "", pwTimer = null;
// Model dilepas dari RAM bila tidak dipakai: atur lewat MODEL_IDLE_SEC (detik, bawaan 90; 0 = lepas segera setelah selesai).
const IDLE_SEC = process.env.MODEL_IDLE_SEC !== undefined && process.env.MODEL_IDLE_SEC !== "" && !isNaN(+process.env.MODEL_IDLE_SEC) ? Math.max(0, +process.env.MODEL_IDLE_SEC) : 90;
function pocketRelease() {
  pwTimer = null;
  if (!pw || Object.keys(pwPending).length) return;   // masih bekerja: jangan dimatikan
  const c = pw; pw = null; pwBuf = ""; pwErr = "";
  try { c.removeAllListeners("close"); c.removeAllListeners("error"); c.on("error", () => {}); c.stdout.removeAllListeners("data"); c.stderr.removeAllListeners("data"); c.kill("SIGTERM"); } catch (e) {}
  console.log("[pocket] dilepas dari RAM (menganggur " + IDLE_SEC + " dtk); dimuat lagi otomatis saat dipakai");
}
function pocketIdle() {
  clearTimeout(pwTimer);
  pwTimer = setTimeout(pocketRelease, IDLE_SEC * 1000);
  if (pwTimer.unref) pwTimer.unref();
}
function pocketProc() {
  if (pw) return pw;
  const c = spawn(PYTHON, [path.join(__dirname, "pocket_worker.py")], { stdio: ["pipe", "pipe", "pipe"], env: Object.assign({}, process.env, { HF_HOME: process.env.HF_HOME || path.join(MODELS_DIR, "hf") }) });
  const fail = (e) => { pw = null; const q = pwPending; pwPending = {}; for (const k in q) q[k].no(e); };
  c.on("error", (e) => fail(e.code === "ENOENT" ? new Error("Python tidak ditemukan di server. Pasang Python 3.10+ dan 'pip install pocket-tts'.") : e));
  c.on("close", () => { const t = pwErr.trim().split("\n").slice(-3).join(" | "); pwErr = ""; fail(new Error("Proses Pocket TTS berhenti." + (t ? " Detail: " + t : " Cek 'pip install pocket-tts' di server."))); });
  c.stderr.on("data", (d) => { pwErr = (pwErr + d).slice(-2000); console.log("[pocket]", String(d).trim()); });
  c.stdout.on("data", (d) => {
    pwBuf += d; let i;
    while ((i = pwBuf.indexOf("\n")) >= 0) {
      const line = pwBuf.slice(0, i); pwBuf = pwBuf.slice(i + 1);
      try { const m = JSON.parse(line), q = pwPending[m.id]; if (!q) continue; delete pwPending[m.id]; m.error ? q.no(new Error(m.error)) : q.ok(m); } catch (e) {}
    }
  });
  return (pw = c);
}
function pocketCall(msg) {
  clearTimeout(pwTimer); pwTimer = null;
  return new Promise((ok, no) => {
    const c = pocketProc(), id = ++pwId; pwPending[id] = { ok, no };
    c.stdin.write(JSON.stringify(Object.assign({ id }, msg)) + "\n");
  }).finally(pocketIdle);
}
// Suara klon: sampel WAV pengguna disimpan di models/clones/ dan dipakai Pocket TTS sebagai suara acuan.
const CLONES_DIR = path.join(MODELS_DIR, "clones");
const CLONE_ID = /^clone-[0-9a-f]{8}$/;
function cloneList() {
  try {
    return fs.readdirSync(CLONES_DIR).filter((f) => f.endsWith(".json")).map((f) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(CLONES_DIR, f), "utf8"));
        if (m.engine && m.engine !== "pocket") return null;   // klon lama milik mesin yang sudah dihapus (Chatterbox/XTTS)
        return CLONE_ID.test(m.id) && exists(path.join(CLONES_DIR, m.id + ".wav")) ? { id: m.id, name: String(m.name).slice(0, 40), lang: cloneLangOf(m.lang), engine: "pocket" } : null;
      } catch (e) { return null; }
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) { return []; }
}
function cloneAdd(name, buf, lang) {
  if (!buf || buf.length < 2000 || buf.length > 8 * 1024 * 1024 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Sampel harus berupa WAV (3-30 detik)");
  name = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Suara saya";
  fs.mkdirSync(CLONES_DIR, { recursive: true });
  const id = "clone-" + require("crypto").randomBytes(4).toString("hex");
  fs.writeFileSync(path.join(CLONES_DIR, id + ".wav"), buf);
  lang = cloneLangOf(lang);
  fs.writeFileSync(path.join(CLONES_DIR, id + ".json"), JSON.stringify({ id, name, lang, engine: "pocket" }));
  return { id, name, lang, engine: "pocket" };
}
function cloneDel(id) {
  if (!CLONE_ID.test(String(id))) throw new Error("ID tidak valid");
  for (const e of [".wav", ".json"]) { try { fs.unlinkSync(path.join(CLONES_DIR, id + e)); } catch (x) {} }
  return true;
}
function cloneRef(voice) {
  const ref = path.join(CLONES_DIR, voice + ".wav");
  if (!exists(ref)) throw new Error("Suara klon tidak ditemukan (mungkin sudah dihapus)");
  return ref;
}
async function pocketGen(voice, text, lang) {
  let ref;
  lang = pocketLangOf(lang);
  if (CLONE_ID.test(voice)) ref = cloneRef(voice);
  else if (!POCKET_VOICES.includes(voice)) throw new Error("Suara Pocket TTS tidak dikenal");
  const m = await pocketCall({ voice, ref, text, lang });
  return Buffer.from(m.wav, "base64");
}
const HF_HUB = () => path.join(process.env.HF_HOME || path.join(MODELS_DIR, "hf"), "hub");
const pocketCached = () => exists(path.join(HF_HUB(), "models--kyutai--pocket-tts", "snapshots"));

// ---------- API ----------
const ENGINES = ["piper", "pocket"];
const VOICE_OK = /^[\w.-]{1,60}$/;
function synth({ engine, voice, text, lang }) {
  if (!ENGINES.includes(engine)) return Promise.reject(new Error("Mesin tidak dikenal (tersedia: piper, pocket)"));
  if (!VOICE_OK.test(String(voice || ""))) return Promise.reject(new Error("Suara tidak valid"));
  text = String(text || "").slice(0, 2000);
  if (!text.trim()) return Promise.reject(new Error("Teks kosong"));
  return enqueue(engine, () => engine === "pocket" ? pocketGen(voice, text, lang) : piperGen(voice, text));
}
function preload({ engine, voice, lang }) {
  if (!ENGINES.includes(engine)) return Promise.reject(new Error("Mesin tidak dikenal (tersedia: piper, pocket)"));
  return enqueue(engine, async () => {
    if (engine === "pocket") await pocketCall({ preload: true, voice: "alba", lang: pocketLangOf(lang) });
    else await piperEnsure(String(voice || ""));
    return true;
  });
}
function probe(cmd, args) {
  return new Promise((ok) => { const c = spawn(cmd, args, { stdio: "ignore" }); c.on("error", () => ok(false)); c.on("close", (x) => ok(x === 0)); setTimeout(() => { try { c.kill(); } catch (e) {} }, 15000); });
}
let probeCache = null;
async function status() {
  if (!probeCache || Date.now() - probeCache.t > 5 * 60 * 1000) {   // probe Python/piper itu lambat, simpan 5 menit
    const [a, p] = await Promise.all([probe(PIPER_BIN, ["--help"]), probe(PYTHON, ["-c", "import pocket_tts"])]);
    probeCache = { t: Date.now(), piperBin: a, pocketPy: p };
  }
  return { piper: { installed: probeCache.piperBin, stored: piperStored() }, pocket: { installed: probeCache.pocketPy, cached: pocketCached() } };
}
module.exports = { synth, preload, status, piperVoices, piperStored, cloneList, cloneAdd, cloneDel };
