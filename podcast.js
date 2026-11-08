// Podcast -> teks: baca feed RSS, simpan audio, decode dengan ffmpeg, lalu transkripsi dengan Whisper (lokal, tanpa API key).
// Tanpa dependensi wajib: @huggingface/transformers dan ffmpeg-static dimuat hanya bila ada (optionalDependencies).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { once } = require("events");

let ffmpegBin = "ffmpeg";
try { ffmpegBin = require("ffmpeg-static") || "ffmpeg"; } catch (e) {}

const MODELS = { tiny: "Xenova/whisper-tiny", base: "Xenova/whisper-base", small: "Xenova/whisper-small" };
const SR = 16000;          // Whisper memakai 16 kHz mono
const WIN = 30;            // detik per jendela (batas Whisper)
const MAX_BYTES = 400 * 1024 * 1024;

/* ---------- Feed RSS (parser kecil, feed podcast bentuknya sederhana) ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const dec = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch (x) { return ""; }
  }
  const v = ENT[e.toLowerCase()];
  return v === undefined ? m : v;
});
function text(raw) {   // CDATA dipakai apa adanya, selebihnya didekode; tag HTML dibuang
  let out = "", last = 0, m;
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  while ((m = re.exec(raw))) { out += dec(raw.slice(last, m.index)) + m[1]; last = re.lastIndex; }
  out += dec(raw.slice(last));
  return out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? text(m[1]) : "";
}
function attr(attrs, n) {
  const q = attrs.match(new RegExp("\\b" + n + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return q ? dec(q[1] !== undefined ? q[1] : q[2]) : "";
}
function secs(v) {   // "3600", "59:30", "1:02:03" -> detik
  v = String(v || "").trim();
  if (!v) return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(+v);
  const p = v.split(":").map(Number);
  if (p.length > 3 || p.some((x) => isNaN(x))) return 0;
  return Math.round(p.reduce((a, x) => a * 60 + x, 0));
}
function parseFeed(xml, max) {
  xml = String(xml || "");
  if (!/<rss\b|<channel\b/i.test(xml)) throw new Error("Ini bukan feed RSS podcast");
  const head = xml.split(/<item[\s>]/i)[0].replace(/<image\b[\s\S]*?<\/image>/gi, "");
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [], episodes = [];
  for (const it of items) {
    const enc = it.match(/<enclosure\b([^>]*)>/i), url = enc ? attr(enc[1], "url").trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const d = new Date(tag(it, "pubDate"));
    episodes.push({
      title: tag(it, "title") || "Tanpa judul",
      date: isNaN(d) ? "" : d.toISOString().slice(0, 10),
      dur: secs(tag(it, "itunes:duration")),
      audio: url,
    });
    if (episodes.length >= (max || 200)) break;
  }
  if (!episodes.length) throw new Error("Tidak ada episode beraudio di feed ini");
  return { title: tag(head, "title") || "Podcast", episodes };
}

/* ---------- Simpan audio ke file sementara ---------- */
async function saveBody(res, file, opt) {
  const max = (opt && opt.max) || MAX_BYTES, onBytes = opt && opt.onBytes;
  const len = +res.headers.get("content-length") || 0, tooBig = () => new Error("File audio terlalu besar (maks " + Math.round(max / 1048576) + " MB)");
  if (len > max) throw tooBig();
  if (!res.body) throw new Error("Respons audio kosong");
  const ws = fs.createWriteStream(file);
  let n = 0, werr = null;
  ws.on("error", (e) => { werr = e; });
  try {
    for await (const c of res.body) {
      if (werr) throw werr;
      n += c.length;
      if (n > max) throw tooBig();
      if (!ws.write(c)) await once(ws, "drain");
      if (onBytes) onBytes(n, len);
    }
    await new Promise((ok, no) => ws.end((e) => (e ? no(e) : ok())));
  } catch (e) { ws.destroy(); throw e; }
  return n;
}

/* ---------- Whisper ---------- */
const asrCache = {};
let sink = null, asrTimer = null;
// Whisper dilepas dari RAM bila tidak dipakai: atur lewat MODEL_IDLE_SEC (detik, bawaan 90; 0 = lepas segera setelah selesai).
const IDLE_SEC = process.env.MODEL_IDLE_SEC !== undefined && process.env.MODEL_IDLE_SEC !== "" && !isNaN(+process.env.MODEL_IDLE_SEC) ? Math.max(0, +process.env.MODEL_IDLE_SEC) : 90;
async function releaseAsr() {
  asrTimer = null;
  const ps = Object.keys(asrCache).map((k) => { const p = asrCache[k]; delete asrCache[k]; return p; });
  if (!ps.length) return;
  for (const p of ps) { try { const a = await p; if (a && typeof a.dispose === "function") await a.dispose(); } catch (e) {} }
  if (global.gc) { try { global.gc(); } catch (e) {} }
  console.log("[whisper] dilepas dari RAM (menganggur " + IDLE_SEC + " dtk); dimuat lagi otomatis saat dipakai");
}
function asrIdle() {   // dipanggil setelah transkripsi selesai/dibatalkan
  clearTimeout(asrTimer);
  asrTimer = setTimeout(releaseAsr, IDLE_SEC * 1000);
  if (asrTimer.unref) asrTimer.unref();
}
function getAsr(key, onPct) {
  const id = MODELS[key];
  if (!id) return Promise.reject(new Error("Model tidak dikenal"));
  clearTimeout(asrTimer); asrTimer = null;
  sink = onPct || null;
  if (!asrCache[key]) {
    asrCache[key] = (async () => {
      let tf;
      try { tf = await import("@huggingface/transformers"); }
      catch (e) { throw new Error("Paket @huggingface/transformers belum terpasang. Jalankan: npm install"); }
      tf.env.cacheDir = path.join(__dirname, "models");
      const files = {};
      try {
        return await tf.pipeline("automatic-speech-recognition", id, {
          dtype: "q8",
          progress_callback: (p) => {
            if (!sink || !p || !p.file) return;
            if (p.status === "progress" && p.total) files[p.file] = { l: p.loaded, t: p.total };
            let l = 0, t = 0;
            for (const f in files) { l += files[f].l; t += files[f].t; }
            if (t) sink(Math.min(99, Math.round((l / t) * 100)));
          },
        });
      } catch (e) { throw new Error("Gagal memuat model " + id + ": " + e.message); }
    })().catch((e) => { delete asrCache[key]; throw e; });
  }
  return asrCache[key];
}

const clean = (t) => {
  t = String(t || "").replace(/\s+/g, " ").trim();
  if (!t || /^[\[(].*[\])]$/.test(t) || !/[\p{L}\p{N}]/u.test(t)) return "";   // kosong, [MUSIK], atau hanya tanda baca
  return t;
};

/* Transkripsi file audio per jendela 30 detik. Jendela yang berakhir di tengah kalimat dipotong di batas segmen
   terakhir yang utuh, lalu jendela berikutnya mulai dari situ, supaya kata tidak terpotong. */
async function transcribeFile(file, o) {
  const { asr, lang = "auto", start = 0, signal, onSegment, onProgress } = o;
  const ff = spawn(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(start), "-i", file,
    "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
  let ferr = "", spawnErr = null, got = 0;
  ff.stderr.on("data", (d) => { if (ferr.length < 2000) ferr += d; });
  const closed = new Promise((ok) => { ff.on("close", ok); ff.on("error", (e) => { spawnErr = e; ok(); }); });
  const kill = () => { try { ff.kill("SIGKILL"); } catch (e) {} };
  const aborted = () => !!(signal && signal.aborted);
  if (signal) { if (signal.aborted) kill(); else signal.addEventListener("abort", kill, { once: true }); }

  let buf = Buffer.alloc(0), base = start, last = "", rep = 0;
  const BYTES = WIN * SR * 2;
  const step = async (final) => {
    const bytes = Math.min(buf.length, BYTES) & ~1, n = bytes / 2, len = n / SR, f32 = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2) / 32768; f32[i] = v; sum += v * v; }
    let adv = len;
    if (Math.sqrt(sum / n) >= 0.002) {   // jendela hening dilewati (Whisper suka mengarang teks dari hening)
      const out = await asr(f32, { language: lang === "auto" ? undefined : lang, task: "transcribe", return_timestamps: true });
      let segs = (out.chunks || [{ text: out.text, timestamp: [0, len] }]).map((c) => ({
        s: c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0,
        e: c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : len,
        text: c.text,
      }));
      if (!final && segs.length > 1 && segs[segs.length - 1].e > len - 1) {
        const k = segs[segs.length - 2].e;
        if (k >= 1) { segs.pop(); adv = Math.min(k, len); }
      }
      for (const g of segs) {
        const t = clean(g.text);
        if (!t) continue;
        rep = t === last ? rep + 1 : 0;
        last = t;
        if (rep >= 2) continue;   // Whisper kadang berputar mengulang kalimat yang sama; dua kali masih wajar ("Ya." "Ya."), ketiga dst. dibuang
        onSegment({ s: +(base + g.s).toFixed(2), e: +(base + Math.max(g.e, g.s)).toFixed(2), text: t });
      }
    }
    buf = buf.subarray(Math.round(adv * SR) * 2);
    base += adv;
    if (onProgress) onProgress(+base.toFixed(2));
  };

  try {
    for await (const chunk of ff.stdout) {
      if (aborted()) break;
      got += chunk.length;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= BYTES && !aborted()) await step(false);
      if (aborted()) break;
    }
    if (!aborted() && buf.length >= SR) await step(true);   // sisa >= 0,5 detik
  } finally {
    kill();
    if (signal) signal.removeEventListener("abort", kill);
  }
  await closed;
  if (aborted()) return { aborted: true };
  if (spawnErr) throw new Error(spawnErr.code === "ENOENT" ? "ffmpeg tidak ditemukan. Jalankan npm install (ffmpeg-static) atau pasang ffmpeg di sistem." : "ffmpeg gagal: " + spawnErr.message);
  if (!got) throw new Error("Audio tidak bisa dibaca" + (ferr ? ": " + ferr.trim().split("\n").pop() : ""));
  return { aborted: false, until: base };
}

/* Decode audio ke PCM 16 kHz mono 16-bit (little-endian) dan alirkan apa adanya ke `out`.
   Dipakai bila Whisper dijalankan di browser: server hanya mengunduh dan men-decode (ffmpeg), model jalan di perangkat pengguna. */
async function pcmStream(file, start, out, signal) {
  const ff = spawn(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(start || 0), "-i", file,
    "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
  let ferr = "", spawnErr = null, got = 0;
  ff.stderr.on("data", (d) => { if (ferr.length < 2000) ferr += d; });
  const closed = new Promise((ok) => { ff.on("close", ok); ff.on("error", (e) => { spawnErr = e; ok(); }); });
  const kill = () => { try { ff.kill("SIGKILL"); } catch (e) {} };
  const aborted = () => !!(signal && signal.aborted);
  const gone = new Promise((ok) => { if (signal) signal.addEventListener("abort", ok, { once: true }); });
  if (signal) { if (signal.aborted) kill(); else signal.addEventListener("abort", kill, { once: true }); }
  try {
    for await (const chunk of ff.stdout) {
      if (aborted()) break;
      got += chunk.length;
      if (!out.write(chunk)) await Promise.race([once(out, "drain"), gone]);
    }
  } finally {
    kill();
    if (signal) signal.removeEventListener("abort", kill);
  }
  await closed;
  if (aborted()) return { aborted: true };
  if (spawnErr) throw new Error(spawnErr.code === "ENOENT" ? "ffmpeg tidak ditemukan. Jalankan npm install (ffmpeg-static) atau pasang ffmpeg di sistem." : "ffmpeg gagal: " + spawnErr.message);
  if (!got) throw new Error("Audio tidak bisa dibaca" + (ferr ? ": " + ferr.trim().split("\n").pop() : ""));
  return { aborted: false, bytes: got };
}

async function status() {
  const out = { ffmpeg: false, whisper: false, models: Object.keys(MODELS) };
  out.ffmpeg = await new Promise((ok) => {
    const p = spawn(ffmpegBin, ["-version"], { stdio: "ignore" });
    p.on("error", () => ok(false)); p.on("close", (c) => ok(c === 0));
  });
  try { await import("@huggingface/transformers"); out.whisper = true; } catch (e) {}
  return out;
}

module.exports = { MODELS, parseFeed, saveBody, getAsr, asrIdle, transcribeFile, pcmStream, status };
