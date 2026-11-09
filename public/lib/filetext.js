// Baca teks dari file di browser: PDF (pdf.js), DOCX (mammoth), EPUB (JSZip), HTML, TXT, MD.
// Tidak ada yang dikirim ke server. Library dimuat malas dari CDN saat pertama dibutuhkan.
// Pemakaian: FileText.read(file) -> Promise<{ title, text }>
(function () {
const TF = self.TextFmt;
const MAX_BYTES = 50 * 1024 * 1024;
const CDN = {
  pdfjs: ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"],
  pdfWorker: ["https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"],
  mammoth: ["https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js", "https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js"],
  jszip: ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"],
};

const loaded = {};
function loadScript(key, urls, test) {
  if (test()) return Promise.resolve();
  if (loaded[key]) return loaded[key];
  return (loaded[key] = new Promise((res, rej) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) { delete loaded[key]; return rej(new Error("Gagal memuat library " + key + " (cek koneksi)")); }
      const s = document.createElement("script");
      s.src = urls[i++];
      s.onload = () => (test() ? res() : (s.remove(), next()));
      s.onerror = () => { s.remove(); next(); };
      document.head.appendChild(s);
    };
    next();
  }));
}
async function fetchText(urls) {   // untuk worker pdf.js: diambil sebagai teks lalu dijadikan blob supaya lintas-origin tetap jalan
  let last;
  for (const u of urls) { try { const r = await fetch(u); if (r.ok) return await r.text(); last = new Error("HTTP " + r.status); } catch (e) { last = e; } }
  throw last || new Error("worker pdf.js tidak bisa dimuat");
}

/* ---------- PDF ---------- */
let pdfReady;
function pdfjs() {
  if (!pdfReady) pdfReady = loadScript("pdfjs", CDN.pdfjs, () => !!self.pdfjsLib).then(async () => {
    try { self.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await fetchText(CDN.pdfWorker)], { type: "text/javascript" })); }
    catch (e) { /* tanpa worker: pdf.js memakai "fake worker" di thread utama (lebih lambat, tetap jalan) */ }
    return self.pdfjsLib;
  }).catch((e) => { pdfReady = null; throw e; });
  return pdfReady;
}
async function fromPdf(buf, onProgress) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      pages.push(TF.pdfTextToParas(tc));
      page.cleanup();
      if (onProgress) onProgress(i, doc.numPages);
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));   // beri napas ke UI
    }
  } finally { try { doc.destroy(); } catch (e) {} }
  return TF.mergePdfPages(pages.join("\n\n"));
}

/* ---------- DOCX ---------- */
async function fromDocx(buf) {
  await loadScript("mammoth", CDN.mammoth, () => !!self.mammoth);
  const r = await self.mammoth.extractRawText({ arrayBuffer: buf });
  return TF.fromParagraphs(r.value);
}

/* ---------- HTML ---------- */
function htmlDoc(html) {
  return new DOMParser().parseFromString(String(html).replace(/<style\b[\s\S]*?<\/style>/gi, ""), "text/html");
}
function fromHtml(html) {
  const doc = htmlDoc(html);
  doc.querySelectorAll("script,style,noscript,template,svg,nav[hidden]").forEach((n) => n.remove());
  const text = TF.domBlocks(doc.body || doc.documentElement).join("\n");
  const title = ((doc.querySelector("title") || {}).textContent || "").replace(/\s+/g, " ").trim();
  return { title, text };
}

/* ---------- EPUB ---------- */
const dec = (x) => String(x || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
async function fromEpub(buf) {
  await loadScript("jszip", CDN.jszip, () => !!self.JSZip);
  const zip = await self.JSZip.loadAsync(buf);
  const read = async (p) => { const e = zip.file(p); return e ? e.async("string") : ""; };
  const opfPath = ((await read("META-INF/container.xml")).match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error("EPUB tidak valid");
  const opf = await read(opfPath), dir = opfPath.includes("/") ? opfPath.replace(/[^/]+$/, "") : "";
  const manifest = {};
  (opf.match(/<item\b[^>]*>/g) || []).forEach((t) => {
    const id = (t.match(/\bid="([^"]+)"/) || [])[1], href = (t.match(/\bhref="([^"]+)"/) || [])[1];
    if (id && href) manifest[id] = href;
  });
  const parts = [];
  let n = 0;
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const href = manifest[m[1]];
    if (!href) continue;
    let html = "";
    try { html = await read(dir + decodeURIComponent(href.split("#")[0])); } catch (e) {}
    if (html) parts.push(...TF.domBlocks(htmlDoc(html).body));
    if (++n % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const title = dec((opf.match(/<dc:title[^>]*>([^<]+)/) || [])[1]);
  const author = dec((opf.match(/<dc:creator[^>]*>([^<]+)/) || [])[1]);
  // halaman sampul sering hanya gambar: tulis judul dan penulis di awal supaya bagian depan buku tetap terbaca
  const head = [title, author].filter((x) => x && !parts.slice(0, 5).some((p) => p.toLowerCase() === x.toLowerCase()));
  return { title, text: head.concat(parts).join("\n") };
}

/* ---------- API ---------- */
async function read(file, onProgress) {
  if (!file) throw new Error("File tidak ditemukan");
  if (file.size > MAX_BYTES) throw new Error("File terlalu besar (maks. 50 MB)");
  const name = file.name.replace(/\.\w+$/, "");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let text = "", title = name;
  if (ext === "pdf") text = await fromPdf(await file.arrayBuffer(), onProgress);
  else if (ext === "docx") text = await fromDocx(await file.arrayBuffer());
  else if (ext === "epub") { const r = await fromEpub(await file.arrayBuffer()); text = r.text; if (r.title) title = r.title; }
  else if (ext === "html" || ext === "htm") text = fromHtml(await file.text()).text;
  else if (ext === "txt" || ext === "md") text = TF.textToParas(await file.text());
  else throw new Error("Format ." + ext + " belum didukung");
  text = text.trim();   // paragraf dipertahankan: satu "\n" per paragraf
  if (!text) throw new Error("Tidak ada teks di file ini (mungkin PDF hasil scan, coba fitur Scan)");
  return { title, text };
}

self.FileText = { read, fromHtml };
})();
