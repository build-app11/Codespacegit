// Mesin suara di server: Kokoro (kokoro-js, Node), Piper (CLI `piper`), Kitten (Python, kitten_worker.py).
// Model dimuat sekali lalu tetap di memori supaya permintaan berikutnya cepat. Satu antrean per mesin.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, "models");
const PIPER_DIR = path.join(MODELS_DIR, "piper");
const PIPER_BIN = process.env.PIPER_BIN || "piper";
const PYTHON = process.env.PYTHON || "python3";
// Nama model Kitten di Hugging Face. Ubah di sini bila nama di repo KittenML berbeda.
const KITTEN_MODELS = {
  "nano-int8": "KittenML/kitten-tts-nano-0.8-int8",
  micro: "KittenML/kitten-tts-micro-0.8",
  nano: "KittenML/kitten-tts-nano-0.8",
  mini: "KittenML/kitten-tts-mini-0.8",
};
const KOKORO_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// ---------- util ----------
function wav(float32, sr) {
  const n = float32.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, float32[i])); b.writeInt16LE(Math.round(x < 0 ? x * 32768 : x * 32767), 44 + i * 2); }
  return b;
}
function splitLong(t, max) {
  const parts = String(t).match(/[^.!?;,。！？；，]+[.!?;,。！？；，]*\s*/g) || [String(t)], out = [];
  let g = "";
  for (const x of parts) { if (g && g.length + x.length > max) { out.push(g); g = ""; } g += x; }
  if (g) out.push(g);
  return out;
}
const queues = {};
const enqueue = (name, fn) => {   // satu pekerjaan per mesin dalam satu waktu
  const p = (queues[name] || Promise.resolve()).catch(() => {}).then(fn);
  queues[name] = p;
  return p;
};
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };

// ---------- Kokoro ----------
let kokoro = null;
function kokoroLoad() {
  if (!kokoro) kokoro = (async () => {
    let tf, mod;
    try { tf = await import("@huggingface/transformers"); mod = await import("kokoro-js"); }
    catch (e) { throw new Error("Paket kokoro-js belum terpasang di server. Jalankan: npm install"); }
    tf.env.cacheDir = MODELS_DIR;
    return mod.KokoroTTS.from_pretrained(KOKORO_ID, { dtype: "q8", device: "cpu" });
  })().catch((e) => { kokoro = null; throw e; });
  return kokoro;
}
async function kokoroGen(voice, text) {
  const t = await kokoroLoad(), parts = [];
  for (const c of splitLong(text, 250)) parts.push(await t.generate(c, { voice }));
  let n = 0; parts.forEach((a) => (n += a.audio.length));
  const all = new Float32Array(n); let o = 0;
  parts.forEach((a) => { all.set(a.audio, o); o += a.audio.length; });
  return wav(all, parts[0].sampling_rate);
}
const kokoroCached = () => exists(path.join(MODELS_DIR, "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx", "model_quantized.onnx"));

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

// ---------- Kitten (Python) ----------
let kw = null, kwPending = {}, kwId = 0, kwBuf = "", kwErr = "";
function kittenProc() {
  if (kw) return kw;
  const c = spawn(PYTHON, [path.join(__dirname, "kitten_worker.py")], { stdio: ["pipe", "pipe", "pipe"], env: Object.assign({}, process.env, { HF_HOME: process.env.HF_HOME || path.join(MODELS_DIR, "hf") }) });
  const fail = (e) => { kw = null; const q = kwPending; kwPending = {}; for (const k in q) q[k].no(e); };
  c.on("error", (e) => fail(e.code === "ENOENT" ? new Error("Python tidak ditemukan di server. Pasang Python 3 dan 'pip install kittenml'.") : e));
  c.on("close", () => { const t = kwErr.trim().split("\n").slice(-3).join(" | "); kwErr = ""; fail(new Error("Proses Kitten berhenti." + (t ? " Detail: " + t : " Cek 'pip install kittenml' di server."))); });
  c.stderr.on("data", (d) => { kwErr = (kwErr + d).slice(-2000); console.log("[kitten]", String(d).trim()); });
  c.stdout.on("data", (d) => {
    kwBuf += d; let i;
    while ((i = kwBuf.indexOf("\n")) >= 0) {
      const line = kwBuf.slice(0, i); kwBuf = kwBuf.slice(i + 1);
      try { const m = JSON.parse(line), q = kwPending[m.id]; if (!q) continue; delete kwPending[m.id]; m.error ? q.no(new Error(m.error)) : q.ok(m); } catch (e) {}
    }
  });
  return (kw = c);
}
function kittenCall(msg) {
  return new Promise((ok, no) => {
    const c = kittenProc(), id = ++kwId; kwPending[id] = { ok, no };
    c.stdin.write(JSON.stringify(Object.assign({ id }, msg)) + "\n");
  });
}
const kittenModel = (k) => { const m = KITTEN_MODELS[k || "nano"]; if (!m) throw new Error("Model Kitten tidak dikenal"); return m; };
async function kittenGen(voice, text, model) {
  const m = await kittenCall({ model: kittenModel(model), voice, text });
  return Buffer.from(m.wav, "base64");
}

const kittenCached = () => Object.keys(KITTEN_MODELS).filter((k) => exists(path.join(process.env.HF_HOME || path.join(MODELS_DIR, "hf"), "hub", "models--" + KITTEN_MODELS[k].replace("/", "--"), "snapshots")));

// ---------- Pocket TTS (Python, Kyutai) ----------
const POCKET_VOICES = ["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"];
let pw = null, pwPending = {}, pwId = 0, pwBuf = "", pwErr = "";
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
  return new Promise((ok, no) => {
    const c = pocketProc(), id = ++pwId; pwPending[id] = { ok, no };
    c.stdin.write(JSON.stringify(Object.assign({ id }, msg)) + "\n");
  });
}
// Suara klon: sampel WAV pengguna disimpan di models/clones/ dan dipakai Pocket TTS sebagai suara acuan.
const CLONES_DIR = path.join(MODELS_DIR, "clones");
const CLONE_ID = /^clone-[0-9a-f]{8}$/;
function cloneList() {
  try {
    return fs.readdirSync(CLONES_DIR).filter((f) => f.endsWith(".json")).map((f) => {
      try { const m = JSON.parse(fs.readFileSync(path.join(CLONES_DIR, f), "utf8")); return CLONE_ID.test(m.id) && exists(path.join(CLONES_DIR, m.id + ".wav")) ? { id: m.id, name: String(m.name).slice(0, 40) } : null; } catch (e) { return null; }
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) { return []; }
}
function cloneAdd(name, buf) {
  if (!buf || buf.length < 2000 || buf.length > 8 * 1024 * 1024 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Sampel harus berupa WAV (3-30 detik)");
  name = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Suara saya";
  fs.mkdirSync(CLONES_DIR, { recursive: true });
  const id = "clone-" + require("crypto").randomBytes(4).toString("hex");
  fs.writeFileSync(path.join(CLONES_DIR, id + ".wav"), buf);
  fs.writeFileSync(path.join(CLONES_DIR, id + ".json"), JSON.stringify({ id, name }));
  return { id, name };
}
function cloneDel(id) {
  if (!CLONE_ID.test(String(id))) throw new Error("ID tidak valid");
  for (const e of [".wav", ".json"]) { try { fs.unlinkSync(path.join(CLONES_DIR, id + e)); } catch (x) {} }
  return true;
}
async function pocketGen(voice, text) {
  let ref;
  if (CLONE_ID.test(voice)) {
    ref = path.join(CLONES_DIR, voice + ".wav");
    if (!exists(ref)) throw new Error("Suara klon tidak ditemukan (mungkin sudah dihapus)");
  } else if (!POCKET_VOICES.includes(voice)) throw new Error("Suara Pocket TTS tidak dikenal");
  const m = await pocketCall({ voice, ref, text });
  return Buffer.from(m.wav, "base64");
}
const pocketCached = () => exists(path.join(process.env.HF_HOME || path.join(MODELS_DIR, "hf"), "hub", "models--kyutai--pocket-tts", "snapshots"));

// ---------- API ----------
const ENGINES = ["kokoro", "kitten", "piper", "pocket"];
const VOICE_OK = /^[\w.-]{1,60}$/;
function synth({ engine, voice, text, model }) {
  if (!ENGINES.includes(engine)) return Promise.reject(new Error("Mesin tidak dikenal"));
  if (!VOICE_OK.test(String(voice || ""))) return Promise.reject(new Error("Suara tidak valid"));
  text = String(text || "").slice(0, 2000);
  if (!text.trim()) return Promise.reject(new Error("Teks kosong"));
  return enqueue(engine, () => engine === "kokoro" ? kokoroGen(voice, text) : engine === "kitten" ? kittenGen(voice, text, model) : engine === "pocket" ? pocketGen(voice, text) : piperGen(voice, text));
}
function preload({ engine, voice, model }) {
  if (!ENGINES.includes(engine)) return Promise.reject(new Error("Mesin tidak dikenal"));
  return enqueue(engine, async () => {
    if (engine === "kokoro") await kokoroLoad();
    else if (engine === "kitten") await kittenCall({ model: kittenModel(model), preload: true });
    else if (engine === "pocket") await pocketCall({ preload: true, voice: "alba" });
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
    const [a, b, p] = await Promise.all([probe(PIPER_BIN, ["--help"]), probe(PYTHON, ["-c", "import kittenml"]).then((ok) => ok || probe(PYTHON, ["-c", "import kittentts"])), probe(PYTHON, ["-c", "import pocket_tts"])]);
    probeCache = { t: Date.now(), piperBin: a, kittenPy: b, pocketPy: p };
  }
  const piperBin = probeCache.piperBin, kittenPy = probeCache.kittenPy;
  let kokoroPkg = false; try { require.resolve("kokoro-js"); kokoroPkg = true; } catch (e) {}
  return { kokoro: { installed: kokoroPkg, cached: kokoroCached() }, kitten: { installed: kittenPy, models: Object.keys(KITTEN_MODELS), cached: kittenCached() }, piper: { installed: piperBin, stored: piperStored() }, pocket: { installed: probeCache.pocketPy, cached: pocketCached() } };
}
module.exports = { synth, preload, status, piperVoices, piperStored, KITTEN_MODELS, cloneList, cloneAdd, cloneDel };
