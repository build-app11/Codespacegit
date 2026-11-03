const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const multer = require("multer");
const mammoth = require("mammoth");
const AdmZip = require("adm-zip");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { YoutubeTranscript } = require("youtube-transcript");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
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

function fromHtml(html, url) {
  const dom = new JSDOM(html, { url: url || "http://localhost" });
  const art = new Readability(dom.window.document).parse();
  if (!art || !art.textContent.trim()) throw new Error("Isi artikel tidak ditemukan");
  return { title: art.title, text: clean(art.textContent) };
}

// YouTube (mengambil subtitle/transkrip video)
app.get("/api/youtube", wrap(async (req) => {
  const u = new URL(req.query.url);
  if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) throw new Error("Bukan link YouTube");
  let segs = null;
  for (const lang of ["id", "en", null]) {
    try { segs = await YoutubeTranscript.fetchTranscript(u.href, lang ? { lang } : undefined); break; } catch (e) { /* coba bahasa lain */ }
  }
  if (!segs || !segs.length) throw new Error("Video ini tidak punya subtitle yang bisa diambil");
  const text = clean(segs.map((s) => s.text).join(" ")
    .replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
  let title = u.href;
  try {
    const o = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(u.href));
    title = (await o.json()).title || title;
  } catch (e) {}
  return { title, text };
}));

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
    if (html) parts.push(new JSDOM(html).window.document.body.textContent);
  }
  const title = ((opf.match(/<dc:title[^>]*>([^<]+)/) || [])[1] || "").trim();
  return { title, text: clean(parts.join(" ")) };
}

// File: PDF, DOCX, HTML, TXT, MD
app.post("/api/file", upload.single("file"), wrap(async (req) => {
  const f = req.file;
  if (!f) throw new Error("File tidak ditemukan");
  const name = f.originalname.replace(/\.\w+$/, "");
  const ext = (f.originalname.split(".").pop() || "").toLowerCase();
  let text = "";
  if (ext === "pdf") text = (await pdfParse(f.buffer)).text;
  else if (ext === "docx") text = (await mammoth.extractRawText({ buffer: f.buffer })).value;
  else if (ext === "epub") { const r = fromEpub(f.buffer); text = r.text; if (r.title) return { title: r.title, text }; }
  else if (ext === "html" || ext === "htm") text = fromHtml(f.buffer.toString("utf8")).text;
  else if (ext === "txt" || ext === "md") text = f.buffer.toString("utf8");
  else throw new Error("Format ." + ext + " belum didukung");
  text = clean(text);
  if (!text) throw new Error("Tidak ada teks di file ini (mungkin PDF hasil scan, coba fitur Scan)");
  return { title: name, text };
}));

app.listen(process.env.PORT || 3000, () => console.log("Buka http://localhost:3000"));
