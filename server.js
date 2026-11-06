const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const multer = require("multer");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const phon = require("./phon");
const podcast = require("./podcast");
const news = require("./news");
const article = require("./article");
const engines = require("./engines");
const tf = require("./textfmt");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const clean = (t) => t.replace(/\s+/g, " ").trim();
const isPrivate = (ip) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(ip);
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); }
};

// Web Link
app.get("/api/extract", wrap(async (req) => {
  const u = new URL(req.query.url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("URL harus http atau https");
  const ip = net.isIP(u.hostname) ? u.hostname : (await dns.lookup(u.hostname)).address;
  if (isPrivate(ip)) throw new Error("Alamat tidak diizinkan");
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SuaraTTS/2.0)" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Situs membalas dengan status " + r.status);
  return fromHtml(await r.text(), u.href);
}));

// jsdom mencetak seluruh isi stylesheet ke terminal bila CSS-nya tidak bisa diurai (situs besar seperti The Guardian sering begini).
// CSS tidak dibutuhkan untuk mengambil teks, jadi <style> dibuang sebelum diurai dan konsol jsdom dibuat diam.
const quietDom = () => new VirtualConsole();
function fromHtml(html, url) {
  html = String(html).replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const dom = new JSDOM(html, { url: url || "http://localhost", virtualConsole: quietDom() });
  try { article.prepare(dom.window.document); } catch (e) {}   // buang menu/iklan/"baca juga", buka bagian "read more"
  const art = new Readability(dom.window.document).parse();
  if (!art || !art.textContent.trim()) throw new Error("Isi artikel tidak ditemukan");
  let text = "";
  try { text = tf.fromParagraphs(article.extractText(new JSDOM("<!doctype html><body>" + art.content, { virtualConsole: quietDom() }).window.document)); } catch (e) {}
  const raw = clean(art.textContent);
  // Pengaman: kalau pembersihan membuang terlalu banyak, anggap berlebihan dan pakai hasil Readability apa adanya.
  return { title: art.title, text: text && (raw.length < 600 || text.length >= raw.length * 0.35) ? text : raw };
}

// ---------- Podcast (RSS) -> teks ----------
// fetch yang memeriksa alamat tujuan di setiap pengalihan (podcast hampir selalu lewat redirect pelacak)
async function safeFetch(url, opts, hops = 5) {
  let u;
  try { u = new URL(String(url || "").trim()); } catch (e) { throw new Error("URL tidak valid"); }
  for (let i = 0; i <= hops; i++) {
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("URL harus http atau https");
    const ip = net.isIP(u.hostname) ? u.hostname : (await dns.lookup(u.hostname)).address;
    if (isPrivate(ip)) throw new Error("Alamat tidak diizinkan");
    const r = await fetch(u, Object.assign({}, opts, { redirect: "manual" }));
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { try { await r.body.cancel(); } catch (e) {} u = new URL(loc, u); continue; }
    r.finalUrl = u.href;
    return r;
  }
  throw new Error("Terlalu banyak pengalihan");
}
async function readLimited(r, max) {
  const parts = []; let n = 0;
  for await (const c of r.body) { n += c.length; if (n > max) throw new Error("Respons terlalu besar"); parts.push(c); }
  return Buffer.concat(parts);
}
const POD_UA = "Mozilla/5.0 (compatible; SuaraTTS/3.1)";
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|webm)$/i;

// URL feed RSS -> daftar episode. URL langsung ke file audio juga diterima (jadi satu episode).
app.get("/api/podcast/feed", wrap(async (req) => {
  const r = await safeFetch(req.query.url, { headers: { "User-Agent": POD_UA, Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Server membalas dengan status " + r.status);
  const ct = (r.headers.get("content-type") || "").toLowerCase(), u = new URL(r.finalUrl);
  if (/^(audio|video)\//.test(ct) || AUDIO_EXT.test(u.pathname)) {
    try { await r.body.cancel(); } catch (e) {}
    let name = u.pathname.split("/").pop() || "Audio";
    try { name = decodeURIComponent(name); } catch (e) {}
    name = name.replace(AUDIO_EXT, "") || "Audio";
    return { title: name, episodes: [{ title: name, date: "", dur: 0, audio: r.finalUrl }] };
  }
  return podcast.parseFeed((await readLimited(r, 10 * 1024 * 1024)).toString("utf8"));
}));

// Transkripsi: unduh audio ke file sementara, jalankan Whisper per 30 detik, kirim hasilnya bertahap (NDJSON).
// Satu transkripsi dalam satu waktu supaya CPU server tidak berebut. Jendela Whisper yang sedang diproses tidak bisa
// diputus di tengah jalan, jadi permintaan baru setelah pembatalan menunggu pekerjaan lama selesai (bukan ditolak).
let podJob = null;
app.post("/api/podcast/transcribe", async (req, res) => {
  const b = req.body || {}, model = String(b.model || "base"), lang = String(b.lang || "auto").toLowerCase();
  const start = Math.max(0, Math.min(+b.start || 0, 86400));
  if (!podcast.MODELS[model]) return res.status(400).json({ error: "Model tidak dikenal" });
  if (lang !== "auto" && !/^[a-z]{2,3}$/.test(lang)) return res.status(400).json({ error: "Bahasa tidak valid" });
  if (podJob && podJob.ac.signal.aborted) await Promise.race([podJob.done, new Promise((ok) => setTimeout(ok, 120000))]);
  if (podJob) return res.status(409).json({ error: "Masih ada transkripsi lain yang berjalan. Tunggu selesai atau batalkan dulu." });
  const ac = new AbortController();
  let finish; podJob = { ac, done: new Promise((ok) => { finish = ok; }) };
  res.on("close", () => ac.abort());
  res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (o) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(o) + "\n"); };
  const beat = setInterval(() => send({ type: "ping" }), 15000);   // jaga koneksi tetap hidup saat satu jendela lama diproses
  let dir = null;
  try {
    send({ type: "status", msg: "Mengunduh audio…" });
    const r = await safeFetch(b.url, { headers: { "User-Agent": POD_UA }, signal: ac.signal });
    if (!r.ok) throw new Error("Server audio membalas dengan status " + r.status);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "suara-pod-"));
    const file = path.join(dir, "audio");
    let t0 = 0;
    await podcast.saveBody(r, file, { onBytes: (n, len) => { const t = Date.now(); if (t - t0 > 400) { t0 = t; send({ type: "dl", n, len }); } } });
    if (ac.signal.aborted) return;
    send({ type: "status", msg: "Memuat model Whisper…" });
    const asr = await podcast.getAsr(model, (pct) => send({ type: "model", pct }));
    if (ac.signal.aborted) return;
    send({ type: "status", msg: "Mentranskripsi…" });
    const out = await podcast.transcribeFile(file, {
      asr, lang, start, signal: ac.signal,
      onSegment: (s) => send({ type: "seg", s: s.s, e: s.e, text: s.text }),
      onProgress: (t) => send({ type: "progress", t }),
    });
    if (!out.aborted) send({ type: "done" });
  } catch (e) {
    if (!ac.signal.aborted) send({ type: "error", error: e.message });
  } finally {
    clearInterval(beat);
    podJob = null; finish();
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
    res.end();
  }
});
// Whisper di browser: server hanya mengunduh audio dan men-decode ke PCM 16 kHz mono (aliran biner), model berjalan di perangkat pengguna.
let pcmBusy = 0;
app.get("/api/podcast/pcm", async (req, res) => {
  const start = Math.max(0, Math.min(+req.query.start || 0, 86400));
  if (!req.query.url) return res.status(400).json({ error: "URL audio kosong" });
  if (pcmBusy >= 4) return res.status(429).json({ error: "Server sedang menyiapkan audio lain. Coba lagi sebentar lagi." });
  pcmBusy++;
  const ac = new AbortController();
  res.on("close", () => ac.abort());
  let dir = null;
  try {
    const r = await safeFetch(req.query.url, { headers: { "User-Agent": POD_UA }, signal: ac.signal });
    if (!r.ok) throw new Error("Server audio membalas dengan status " + r.status);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "suara-pod-"));
    const file = path.join(dir, "audio");
    await podcast.saveBody(r, file);
    if (ac.signal.aborted) return;
    res.set({ "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const out = await podcast.pcmStream(file, start, res, ac.signal);
    if (!out.aborted) res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    if (!res.headersSent) res.status(502).json({ error: e.message }); else res.destroy();
  } finally {
    pcmBusy--;
    if (dir) fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});
app.get("/api/podcast/status", wrap(async () => podcast.status()));

// ---------- Berita (RSS) ----------
// Feed RSS 2.0 / Atom / RSS 1.0 -> daftar artikel. Bila yang ditempel adalah alamat situs (HTML), feed-nya dicari
// lewat <link rel="alternate"> lalu dimuat. Semua pengambilan lewat safeFetch (alamat privat ditolak, termasuk di pengalihan).
const NEWS_UA = "Mozilla/5.0 (compatible; SuaraTTS/3.2)";
app.get("/api/news/feed", wrap(async (req) => {
  let url = req.query.url;
  for (let hop = 0; hop < 2; hop++) {
    const r = await safeFetch(url, { headers: { "User-Agent": NEWS_UA, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.6, */*;q=0.5" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Server membalas dengan status " + r.status);
    const body = (await readLimited(r, 10 * 1024 * 1024)).toString("utf8");
    try {
      return Object.assign(news.parseNews(body, { base: r.finalUrl }), { url: r.finalUrl });
    } catch (e) {
      const found = hop === 0 ? news.discoverFeeds(body, r.finalUrl) : [];
      if (!found.length) throw e;
      url = found[0];
    }
  }
}));

// Isi lengkap satu artikel, dipakai saat artikel ditambahkan ke Library: hanya isinya (tanpa menu, iklan, "baca juga", dsb.),
// dan bila artikelnya dipecah ke beberapa halaman, halaman lanjutannya ikut dibaca (maks. 8 halaman).
async function fetchArticlePage(url) {
  const r = await safeFetch(url, { headers: { "User-Agent": NEWS_UA, Accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.5" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Situs membalas dengan status " + r.status);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (/^(audio|video|image)\//.test(ct) || /pdf/.test(ct)) { try { await r.body.cancel(); } catch (e) {} throw new Error("Tautan ini bukan halaman artikel"); }
  return { html: (await readLimited(r, 5 * 1024 * 1024)).toString("utf8"), url: r.finalUrl };
}
app.get("/api/news/article", wrap(async (req) => article.readAll(fetchArticlePage, fromHtml, req.query.url)));

// Audio MP3 untuk fitur unduh. Memakai endpoint suara Google Translate (tidak resmi), dipotong <= 180 karakter per permintaan.
function ttsLang(x) {
  const l = String(x || "id").trim();
  if (/^zh-(tw|hk|hant)/i.test(l)) return "zh-TW";
  if (/^zh/i.test(l)) return "zh-CN";
  const b = l.split("-")[0].toLowerCase();
  return !b || b === "und" ? "id" : b;
}
function ttsPieces(text, max = 180) {
  const out = []; let s = String(text).replace(/\s+/g, " ").trim();
  while (s.length > max) {
    let k = Math.max(...[". ", "! ", "? ", "。", "！", "？", ", ", "、", " "].map((c) => s.lastIndexOf(c, max - 1)));
    k = k < max * 0.4 ? max : k + 1;
    out.push(s.slice(0, k).trim()); s = s.slice(k).trim();
  }
  if (s) out.push(s);
  return out;
}
async function ttsPiece(q, tl) {
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" + encodeURIComponent(tl) + "&q=" + encodeURIComponent(q) + "&textlen=" + q.length;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Referer: "https://translate.google.com/" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Layanan suara menolak permintaan (HTTP " + r.status + ")");
  return Buffer.from(await r.arrayBuffer());
}
app.post("/api/tts", async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || "").slice(0, 1200);
    if (!text.trim()) throw new Error("Teks kosong");
    const tl = ttsLang(req.body && req.body.lang), pieces = ttsPieces(text), bufs = [];
    for (let i = 0; i < pieces.length; i += 3) bufs.push(...(await Promise.all(pieces.slice(i, i + 3).map((x) => ttsPiece(x, tl)))));
    res.set("Content-Type", "audio/mpeg").send(Buffer.concat(bufs));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Mesin suara di server: Kokoro, Kitten, Piper (lebih cepat daripada di browser, model disimpan di server)
app.post("/api/tts/engine", async (req, res) => {
  try {
    const wavBuf = await engines.synth(req.body || {});
    res.set("Content-Type", "audio/wav").send(wavBuf);
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post("/api/tts/engine/preload", wrap(async (req) => { await engines.preload(req.body || {}); return { ok: true }; }));
app.get("/api/tts/engine/status", wrap(async () => engines.status()));
// Suara klon (Pocket TTS): sampel WAV 3-30 detik milik pengguna
app.get("/api/clone", wrap(async () => ({ clones: engines.cloneList() })));
app.post("/api/clone", upload.single("audio"), wrap(async (req) => engines.cloneAdd(req.body && req.body.name, req.file && req.file.buffer)));
app.delete("/api/clone/:id", wrap(async (req) => ({ ok: engines.cloneDel(req.params.id) })));
app.get("/api/tts/piper/voices", wrap(async () => ({ voices: await engines.piperVoices() })));

// EPUB: baca urutan bab (spine) lalu ambil teksnya
function fromEpub(buf) {
  const zip = new AdmZip(buf);
  const read = (p) => { const e = zip.getEntry(p); return e ? e.getData().toString("utf8") : ""; };
  const opfPath = (read("META-INF/container.xml").match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error("EPUB tidak valid");
  const opf = read(opfPath), dir = opfPath.includes("/") ? opfPath.replace(/[^/]+$/, "") : "";
  const manifest = {};
  (opf.match(/<item\b[^>]*>/g) || []).forEach((t) => {
    const id = (t.match(/\bid="([^"]+)"/) || [])[1], href = (t.match(/\bhref="([^"]+)"/) || [])[1];
    if (id && href) manifest[id] = href;
  });
  const parts = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const href = manifest[m[1]];
    if (!href) continue;
    const html = read(dir + decodeURIComponent(href.split("#")[0]));
    if (html) parts.push(...tf.domBlocks(new JSDOM(html.replace(/<style\b[\s\S]*?<\/style>/gi, ""), { virtualConsole: quietDom() }).window.document.body));
  }
  const dec = (x) => String(x || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
  const title = dec((opf.match(/<dc:title[^>]*>([^<]+)/) || [])[1]);
  const author = dec((opf.match(/<dc:creator[^>]*>([^<]+)/) || [])[1]);
  // halaman sampul sering hanya gambar: tulis judul dan penulis di awal supaya bagian depan buku tetap terbaca
  const head = [title, author].filter((x) => x && !parts.slice(0, 5).some((p) => p.toLowerCase() === x.toLowerCase()));
  return { title, text: head.concat(parts).join("\n") };
}

// File: PDF, DOCX, HTML, TXT, MD
app.post("/api/file", upload.single("file"), wrap(async (req) => {
  const f = req.file;
  if (!f) throw new Error("File tidak ditemukan");
  const name = f.originalname.replace(/\.\w+$/, "");
  const ext = (f.originalname.split(".").pop() || "").toLowerCase();
  let text = "";
  if (ext === "pdf") text = tf.mergePdfPages((await pdfParse(f.buffer, { pagerender: tf.pdfPageText })).text);
  else if (ext === "docx") text = tf.fromParagraphs((await mammoth.extractRawText({ buffer: f.buffer })).value);
  else if (ext === "epub") { const r = fromEpub(f.buffer); text = r.text; if (r.title) return { title: r.title, text }; }
  else if (ext === "html" || ext === "htm") text = fromHtml(f.buffer.toString("utf8")).text;
  else if (ext === "txt" || ext === "md") text = tf.textToParas(f.buffer.toString("utf8"));
  else throw new Error("Format ." + ext + " belum didukung");
  text = text.trim();   // paragraf dipertahankan: satu "\n" per paragraf
  if (!text) throw new Error("Tidak ada teks di file ini (mungkin PDF hasil scan, coba fitur Scan)");
  return { title: name, text };
}));

// Terjemahan (endpoint web Google Translate, gratis tanpa API key, tidak resmi)
async function gt(q, tl, dts) {
  const body = new URLSearchParams({ client: "gtx", sl: "auto", tl, q });
  dts.forEach((d) => body.append("dt", d));
  const r = await fetch("https://translate.googleapis.com/translate_a/single", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error("Layanan terjemahan menolak permintaan (" + r.status + ")");
  return r.json();
}
const segs = (d) => (d[0] || []).map((x) => (x && x[0]) || "").join("");

app.post("/api/translate", wrap(async (req) => {
  const { texts, tl } = req.body || {};
  if (!Array.isArray(texts) || !tl || texts.length > 40) throw new Error("Permintaan tidak valid");
  const out = await gt(texts.join("\n"), tl, ["t"]).then((d) => segs(d).split("\n")).catch(() => null);
  if (out && out.length === texts.length) return { out };
  return { out: await Promise.all(texts.map((t) => gt(t, tl, ["t"]).then(segs))) };
}));

// Deteksi bahasa teks (memakai hasil sl=auto dari Google Translate)
app.post("/api/detect", wrap(async (req) => {
  const text = String((req.body && req.body.text) || "").trim().slice(0, 500);
  if (!text) throw new Error("Teks kosong");
  const d = await gt(text, "en", ["t"]);
  let l = String(d[2] || "").trim();
  l = { iw: "he", jw: "jv", in: "id" }[l] || l;
  if (!l || l === "auto") throw new Error("Bahasa tidak terdeteksi");
  return { lang: l };
}));

// Fonetik per kata (lokal): tiap kalimat dikembalikan sebagai daftar segmen untuk ditampilkan di bawah tiap kata
app.post("/api/phon", wrap(async (req) => {
  const { texts, l, rm, ip } = req.body || {};
  if (!Array.isArray(texts) || !texts.length || texts.length > 6) throw new Error("Permintaan tidak valid");
  const L = String(l || ""), want = { rm: !!rm, ip: !!ip && !!L };
  const r = await Promise.all(texts.map((t) => phon.analyzeWords(String(t), L, want).catch(() => null)));
  return { items: r.map((ws) => (ws ? {
    t: ws.map((x) => x.t), wl: ws.map((x) => (x.wl ? 1 : 0)),
    rm: want.rm ? ws.map((x) => x.rm || "") : null, ip: want.ip ? ws.map((x) => x.ip || "") : null } : null)) };
}));
app.get("/api/phon/status", wrap(async () => phon.status()));

app.get("/api/word", wrap(async (req) => {
  const { w, s, tl } = req.query, L = String(req.query.l || "");
  if (!w || w.length > 60 || !tl) throw new Error("Kata tidak valid");
  const [d, sd] = await Promise.all([gt(w, tl, ["t", "bd", "ex"]), s ? gt(s, tl, ["t"]) : null]);
  const lang = L || String(d[2] || "");
  const [pw, ps] = await Promise.all([
    phon.analyze(w, lang, { rm: true, ip: true }).catch(() => ({ rm: "", ip: "" })),
    s && s.length <= 400 ? phon.analyze(s, lang, { rm: true, ip: false }).catch(() => ({ rm: "", ip: "" })) : { rm: "", ip: "" },
  ]);
  const res = { word: w, translation: segs(d), alts: [], examples: [], sentence: s || "", sentenceTr: sd ? segs(sd) : "",
    translit: pw.rm, sentenceTranslit: ps.rm, ipa: pw.ip ? ["/" + pw.ip + "/"] : [] };
  (d[1] || []).forEach((e) => res.alts.push({ pos: e[0], terms: (e[1] || []).slice(0, 5) }));
  const ex = (d[13] && d[13][0]) || [];
  res.examples = ex.slice(0, 3).map((x) => String(x[0]).replace(/<[^>]+>/g, ""));
  if (res.examples.length) {
    try {
      const arr = segs(await gt(res.examples.join("\n"), tl, ["t"])).split("\n");
      if (arr.length === res.examples.length) res.exTr = arr;
    } catch (e) {}
  }
  return res;
}));

app.listen(process.env.PORT || 3000, () => {
  console.log("Buka http://localhost:3000");
  engines.status().then((st) => {
    console.log("Mesin suara:", JSON.stringify(st));
    // model yang sudah ada di disk langsung dimuat ke memori, jadi permintaan pertama tidak lambat
    if (st.kokoro.installed && st.kokoro.cached) engines.preload({ engine: "kokoro" }).then(() => console.log("Kokoro siap di memori")).catch((e) => console.log("Kokoro gagal dimuat:", e.message));
  }).catch(() => {});
  phon.status().then((st) => console.log("Fonetik:", JSON.stringify(st))).catch(() => {});   // sekaligus memanaskan kamus
});
