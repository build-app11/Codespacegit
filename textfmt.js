// Perapian teks dari file: pertahankan paragraf (satu "\n" = satu paragraf) dan spasi/tanda baca yang benar.
const SENT_END = /[.!?。！？…]["'”’)\]»]*$/;
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

// Rapikan satu paragraf: spasi ganda, spasi sebelum tanda baca, spasi hilang setelah titik/koma.
function tidy(s) {
  return String(s)
    .replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\u200b\ufeff\u00ad]/g, "").replace(/[ \t\f\v]+/g, " ")
    .replace(/\s+([,.;:!?])(?=\s|$)/g, "$1")
    .replace(/\s+([,;!?])(?=[A-Za-zÀ-ÿ])/g, "$1 ")
    .replace(/\s+\.(?=[A-Z][a-z])/g, ". ")
    .replace(/([a-zà-ÿ]{2}[.!?])(?=[A-ZÀ-Þ][a-zà-ÿ])/g, "$1 ")
    .replace(/([a-zà-ÿ]),(?=[A-Za-zÀ-ÿ])/g, "$1, ")
    .trim();
}
// Gabung baris yang terpotong di tengah kalimat; sambung kata yang dipenggal tanda hubung.
function joinLines(lines) {
  let t = "";
  for (const l0 of lines) {
    const l = l0.trim(); if (!l) continue;
    if (!t) t = l;
    else if (/[-‐\u00ad]$/.test(t) && /^[a-zà-ÿ]/.test(l)) t = t.replace(/[-‐\u00ad]$/, "") + l;
    else t += " " + l;
  }
  return t;
}
// Teks yang sudah berparagraf (DOCX, hasil ekstraksi artikel): tiap baris tak kosong = paragraf.
function fromParagraphs(raw) {
  return String(raw).replace(/\r\n?/g, "\n").split(/\n+/).map(tidy).filter(Boolean).join("\n");
}
// TXT/MD: paragraf dipisah baris kosong; baris di dalam paragraf yang terpotong digabung.
// Bila tidak ada baris kosong sama sekali, tiap baris dianggap satu paragraf.
function textToParas(raw) {
  const txt = String(raw).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").replace(/^[ \t]*#{1,6}[ \t]+/gm, "").replace(/^[ \t]*>[ \t]?/gm, "");
  const blocks = txt.split(/\n[ \t]*\n/).filter((b) => b.trim());
  if (blocks.length > 1) return blocks.map((b) => tidy(joinLines(b.split("\n")))).filter(Boolean).join("\n");
  return fromParagraphs(txt);
}

// ---------- PDF ----------
// Dipakai sebagai opsi pagerender pdf-parse. Mengelompokkan teks menjadi baris, lalu paragraf (dari jarak antarbaris,
// indentasi, ukuran huruf, dan baris pendek di akhir paragraf). Hasil per halaman: paragraf dipisah "\n".
function pdfPageText(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((tc) => {
    const L = []; let cur = null;
    for (const it of tc.items) {
      const str = it.str; if (!str) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.height || it.transform[3] || 10) || 10, w = it.width || 0;
      if (cur && Math.abs(y - cur.y) <= Math.max(1.5, Math.min(cur.h, h) * 0.45) && x >= cur.end - cur.h * 2) {
        const gap = x - cur.end;
        const sp = gap > Math.min(cur.h, h) * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(str);
        cur.text += (sp ? " " : "") + str; cur.end = x + w; cur.h = Math.max(cur.h, h);
      } else { cur = { x, y, h, text: str, end: x + w }; L.push(cur); }
    }
    const lines = L.map((l) => Object.assign(l, { text: l.text.trim() })).filter((l) => l.text);
    if (!lines.length) return "";
    const left = pct(lines.map((l) => l.x), 0.2), right = pct(lines.map((l) => l.end), 0.85);
    const gaps = []; for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); }
    const med = median(gaps) || lines[0].h * 1.2;
    const paras = []; let p = [lines[0].text];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i], gap = a.y - b.y, ended = SENT_END.test(a.text);
      const brk = gap < 0 || gap > med * 1.45 + 0.5 ||
        (b.x > left + b.h && ended) ||
        Math.abs(b.h - a.h) > a.h * 0.2 ||
        (a.end < right - a.h * 4 && ended) ||
        (a.end < right - a.h * 6 && a.text.length < 80 && !ended);
      if (brk) { paras.push(p); p = []; }
      p.push(b.text);
    }
    paras.push(p);
    return paras.map((q) => tidy(joinLines(q))).filter(Boolean).join("\n");
  });
}
// Gabungkan halaman: buang nomor halaman dan header/footer berulang, sambung kalimat yang terpotong antarhalaman.
function mergePdfPages(raw) {
  const pages = String(raw).split(/\n\n/).map((p) => p.split("\n").filter(Boolean)).filter((p) => p.length);
  const key = (s) => s.replace(/\d+/g, "#").toLowerCase();
  const pageNo = /^(\d{1,4}|(page|halaman|hal\.?)\s*\d+(\s*(of|dari|\/)\s*\d+)?)$/i;
  const freq = {};
  pages.forEach((p) => new Set([p[0], p[p.length - 1]]).forEach((s) => { const k = key(s); freq[k] = (freq[k] || 0) + 1; }));
  const minRep = Math.max(3, Math.ceil(pages.length * 0.4));
  const drop = (s) => pageNo.test(s.trim()) || (pages.length >= 4 && freq[key(s)] >= minRep && s.length < 90);
  const out = [];
  pages.forEach((p) => {
    let q = p.slice();
    if (q.length && drop(q[0])) q.shift();
    if (q.length && drop(q[q.length - 1])) q.pop();
    q.forEach((para, i) => {
      const prev = out[out.length - 1];
      if (i === 0 && prev && (/[-‐\u00ad]$/.test(prev) || (!SENT_END.test(prev) && /^[a-zà-ÿ]/.test(para)))) out[out.length - 1] = joinLines([prev, para]);
      else out.push(para);
    });
  });
  return out.join("\n");
}

// ---------- HTML / EPUB ----------
const BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "TABLE", "TR", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "FIGURE", "FIGCAPTION", "DT", "DD", "DL", "HR", "BODY", "NAV", "MAIN", "ADDRESS"]);
const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "SVG", "RT", "RP", "NOSCRIPT"]);
// Telusuri DOM, satu elemen blok = satu paragraf. <br> memecah paragraf.
function domBlocks(root) {
  const out = []; let buf = "";
  const flush = () => { const t = tidy(buf.replace(/\s+/g, " ")); if (t) out.push(t); buf = ""; };
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { buf += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const tag = String(c.tagName).toUpperCase();
      if (SKIP.has(tag)) continue;
      if (tag === "NAV" && c.hasAttribute && c.hasAttribute("hidden")) continue;
      if (tag === "SUP" && /^\s*[\[(]?\d{1,3}[\])]?\s*$/.test(c.textContent || "")) continue;   // angka catatan kaki
      if (tag === "BR") { flush(); continue; }
      const blk = BLOCK.has(tag);
      if (blk) flush();
      walk(c);
      if (blk) flush();
    }
  })(root);
  flush();
  return out;
}

module.exports = { tidy, joinLines, fromParagraphs, textToParas, pdfPageText, mergePdfPages, domBlocks, SENT_END };
