const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const podcast = require("./podcast");
const news = require("./news");
const article = require("./article");
const tf = require("./textfmt");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
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

// File PDF/DOCX/EPUB/HTML/TXT dibaca di browser (public/lib/filetext.js); server tidak lagi menerima unggahan file.

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

// Romanisasi dan IPA dihitung di browser (public/lib/phon.js).

// Kamus: FreeDictionaryAPI.com (data Wiktionary), sama dengan pop up kamus di player-video
const FD_URL = "https://freedictionaryapi.com/api/v1/entries/";
const FD_CACHE = new Map();
function fdCands(q, lc) {
  if (lc !== "en") return [q];
  const a = [q], add = (x) => { if (x && x.length > 2 && !a.includes(x)) a.push(x); };
  if (/'s$/.test(q)) add(q.slice(0, -2));
  if (/n't$/.test(q)) add(q.slice(0, -3));
  if (/ies$/.test(q)) add(q.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes)$/.test(q)) add(q.slice(0, -2));
  if (/s$/.test(q)) add(q.slice(0, -1));
  if (/ing$/.test(q)) { const b = q.slice(0, -3); add(b); add(b + "e"); if (/(.)\1$/.test(b)) add(b.slice(0, -1)); }
  if (/ied$/.test(q)) add(q.slice(0, -3) + "y");
  if (/ed$/.test(q)) { const b = q.slice(0, -2); add(b); add(q.slice(0, -1)); if (/(.)\1$/.test(b)) add(b.slice(0, -1)); }
  if (/ly$/.test(q)) add(q.slice(0, -2));
  return a.slice(0, 5);
}
async function fdLookup(q, lc) {
  const key = lc + ":" + q;
  if (FD_CACHE.has(key)) return FD_CACHE.get(key);
  let res = null;
  for (const w of fdCands(q, lc)) {
    const r = await fetch(FD_URL + lc + "/" + encodeURIComponent(w) + "?translations=true", { signal: AbortSignal.timeout(10000) });
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(r.status === 429 ? "Batas permintaan kamus tercapai. Coba lagi nanti." : "Kamus tidak bisa dimuat (" + r.status + ").");
    const j = await r.json();
    if (j && j.entries && j.entries.length) { res = { word: w, entries: j.entries }; break; }
  }
  if (FD_CACHE.size > 500) FD_CACHE.clear();
  FD_CACHE.set(key, res);
  return res;
}
function fdArti(entries, codes) {
  const out = new Set();
  const walk = (x) => { (x.translations || []).forEach((t) => { if (t.language && codes.includes(t.language.code) && t.word) out.add(t.word); }); (x.subsenses || []).forEach(walk); };
  entries.forEach((e) => (e.senses || []).forEach(walk));
  return [...out].slice(0, 8);
}

app.get("/api/word", wrap(async (req) => {
  const { w, s, tl } = req.query, L = String(req.query.l || "");
  if (!w || w.length > 60 || !tl) throw new Error("Kata tidak valid");
  const [d, sd] = await Promise.all([gt(w, tl, ["t", "bd", "ex"]), s ? gt(s, tl, ["t"]) : null]);
  const lang = L || String(d[2] || "");
  const fixed = { iw: "he", jw: "jv", in: "id" };
  let lc = String(lang).split(/[-_]/)[0].toLowerCase(); lc = fixed[lc] || lc;
  const tc = String(tl).split(/[-_]/)[0].toLowerCase(), codes = tc === "zh" ? ["cmn", "zh"] : [tc];
  // romanisasi/IPA kata dan kalimat ditambahkan di browser (public/lib/phon.js)
  const [fd] = await Promise.all([
    (lc ? fdLookup(String(w).toLowerCase().replace(/[‘’]/g, "'"), lc) : Promise.resolve(null)).then((r) => ({ r }), (e) => ({ err: e.message })),
  ]);
  const res = { word: w, translation: segs(d), alts: [], examples: [], sentence: s || "", sentenceTr: sd ? segs(sd) : "",
    translit: "", sentenceTranslit: "", ipa: [], entries: [], arti: [], base: "", dictErr: fd.err || "" };
  if (fd.r) {
    res.base = fd.r.word;
    res.arti = fdArti(fd.r.entries, codes);
    res.entries = fd.r.entries.map((e) => ({
      pos: e.partOfSpeech || "",
      senses: (e.senses || []).filter((x) => x && x.definition).slice(0, 8).map((x) => ({
        d: x.definition,
        ex: (x.examples || []).slice(0, 2).map((y) => (typeof y === "string" ? y : (y && y.text) || "")).filter(Boolean),
      })),
    })).filter((e) => e.senses.length);
    if (!res.ipa.length) {
      const pr = fd.r.entries.flatMap((e) => e.pronunciations || []).find((p) => p && p.text);
      if (pr) res.ipa = [/^[\/\[]/.test(pr.text) ? pr.text : "/" + pr.text + "/"];
    }
  }
  (d[1] || []).forEach((e) => res.alts.push({ pos: e[0], terms: (e[1] || []).slice(0, 5) }));
  const ex = (d[13] && d[13][0]) || [];
  res.examples = ex.slice(0, 3).map((x) => String(x[0]).replace(/<[^>]+>/g, ""));
  if (!res.entries.length && res.examples.length) {
    try {
      const arr = segs(await gt(res.examples.join("\n"), tl, ["t"])).split("\n");
      if (arr.length === res.examples.length) res.exTr = arr;
    } catch (e) {}
  }
  return res;
}));

app.listen(process.env.PORT || 3000, () => {
  console.log("Buka http://localhost:3000");
});
