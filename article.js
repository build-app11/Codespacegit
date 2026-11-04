// Membersihkan artikel berita supaya yang tersimpan hanya isinya:
//  - prepare(doc)      : sebelum Readability. Buang menu, iklan, "baca juga", komentar, tombol bagikan, tombol "read more";
//                        buka bagian yang disembunyikan di balik "read more" bila sudah ada di HTML.
//  - extractText(doc)  : sesudah Readability. Buang sisa baris non-isi (keterangan foto, "Baca juga: …", iklan) dan beri jeda antarparagraf.
//  - findPager(...)    : artikel yang dipecah ke beberapa halaman (rel=next, "Halaman berikutnya", "Lihat semua").
// Fungsi yang menerima `doc` hanya memakai API DOM standar; findPager/isPagerUrl bekerja pada teks HTML biasa.

/* ---------- Teks non-isi ---------- */
const BOILER = [
  /^(baca|simak|lihat|cek|klik|tonton|dengarkan|saksikan)\s+(juga|selengkapnya|berita|video|artikel)\b/i,
  /^(read|see|watch|also read|also see)\s+(also|more|next|related)\b/i,
  /^related(\s+(articles?|stories|posts|news|topics|content))?\s*[:：]?\s*$/i,
  /^(advertisements?|iklan|sponsored(\s+content)?|scroll to continue( with content)?|story continues below advertisement|lanjutkan membaca di bawah iklan)\s*[:.]?\s*$/i,
  /^(share this\b|share (on|via|to)\b|bagikan( artikel| berita)?( ini)?( ke| via| lewat)?\s*[:：]?\s*$|follow us\b|ikuti kami\b|dapatkan (update|berita)\b|subscribe\s*[:.!]?\s*$|subscribe (to|now)\b|berlangganan\b|join (our|us)\b)/i,
  /^(penulis|editor|reporter|redaktur|kontributor|sumber|foto|ilustrasi|credit|photo)\s*:/i,
];
const isBoiler = (t) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > 0 && t.length <= 220 && BOILER.some((r) => r.test(t)); };

const READ_MORE = /^(read more|read the rest|continue reading|read full (story|article)|baca selengkapnya|baca lanjut|baca (artikel )?lengkap|selengkapnya|lanjutkan membaca|load more|muat (lebih banyak|lagi|selengkapnya)|show more|tampilkan (lebih banyak|semua)|lihat (semua|selengkapnya)|view all|see more)[\s.…»›>→]*$/i;
const isReadMore = (t) => READ_MORE.test(String(t || "").replace(/\s+/g, " ").trim());

/* ---------- Elemen non-isi ---------- */
const HARD_TAGS = "script,style,noscript,template,iframe,button,input,select,textarea,svg,canvas,audio,video,object,embed";
const SOFT_TAGS = "form,nav,aside,footer,dialog";   // dihapus kecuali menampung sebagian besar teks halaman
const NOISE_ROLES = new Set(["navigation", "complementary", "banner", "contentinfo", "dialog", "alertdialog", "search", "form"]);
// Kata utuh pada class/id. Sengaja sempit: "widget", "promo", "tag" dsb. dihindari karena dipakai juga untuk pembungkus isi (mis. Elementor).
const NOISE_TOKENS = new Set(["related", "recommended", "recommendation", "terkait", "trending", "popular", "share", "sharing", "social",
  "newsletter", "subscribe", "subscription", "comment", "comments", "komentar", "advert", "advertisement", "ads", "ad", "iklan",
  "sponsor", "sponsored", "breadcrumb", "breadcrumbs", "tags"]);
const NOISE_JOINED = ["bacajuga", "readalso", "alsoread", "readmore", "morestories", "relatedposts", "relatedarticles", "youmaylike", "adslot", "adunit"];
const MORE_TOKENS = new Set(["more", "rest", "full", "expand", "expanded", "collapse", "collapsed", "readmore", "morecontent", "moretext", "fulltext", "fullcontent"]);

const tokens = (el) => (((el.getAttribute("class") || "") + " " + (el.getAttribute("id") || "")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
function noisy(el) {
  if (NOISE_ROLES.has((el.getAttribute("role") || "").toLowerCase())) return true;
  const tk = tokens(el);
  if (!tk.length) return false;
  if (tk.some((t) => NOISE_TOKENS.has(t))) return true;
  const joined = tk.join("");
  return NOISE_JOINED.some((j) => joined.indexOf(j) >= 0);
}
const linkRatio = (el) => {
  const all = (el.textContent || "").length || 1;
  let l = 0; el.querySelectorAll("a").forEach((a) => { l += (a.textContent || "").length; });
  return l / all;
};

function prepare(doc) {
  const body = doc.body;
  if (!body) return;
  const total = (body.textContent || "").length;
  const big = (el) => (el.textContent || "").length > total * 0.5;   // jangan sampai pembungkus isi ikut terbuang

  // 1. Buka bagian yang disembunyikan untuk tombol "read more" (teks panjang, bukan menu) sebelum Readability membuangnya.
  doc.querySelectorAll("[hidden],[aria-hidden='true'],[style*='display']").forEach((el) => {
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (!el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true" && !/display\s*:\s*none/.test(style)) return;
    if (noisy(el) || !tokens(el).some((t) => MORE_TOKENS.has(t))) return;
    const len = (el.textContent || "").length;
    if (len < 200 || linkRatio(el) > 0.4) return;
    el.removeAttribute("hidden"); el.removeAttribute("aria-hidden");
    if (el.style) { el.style.removeProperty("display"); el.style.removeProperty("visibility"); }
  });

  // 2. Tombol / tautan "Baca selengkapnya", "Load more", dsb. bukan isi.
  doc.querySelectorAll("a,button,span,div").forEach((el) => {
    if (el.children.length === 0 || el.tagName === "A") {
      if (isReadMore(el.textContent)) el.remove();
    }
  });

  // 3. Elemen non-isi menurut tag, role, class/id.
  doc.querySelectorAll(HARD_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll(SOFT_TAGS).forEach((el) => { if (el.isConnected && !big(el) && !el.querySelector("article,main")) el.remove(); });
  doc.querySelectorAll("*").forEach((el) => {
    if (!el.isConnected || el === body || el === doc.documentElement) return;
    const t = el.tagName;
    if (t === "ARTICLE" || t === "MAIN") return;
    if (noisy(el) && !big(el) && !el.querySelector("article,main,[itemprop='articleBody']")) el.remove();
  });
}

function extractText(doc) {
  const root = doc.body || doc.documentElement;
  // Aturan baris non-isi hanya untuk blok paling dalam; pembungkus yang teksnya pendek tidak boleh ikut terhapus.
  const BLOCKS = "p,div,li,h1,h2,h3,h4,h5,h6,blockquote,section,ul,ol,table,article";
  root.querySelectorAll("figcaption,p,li,div,h1,h2,h3,h4,h5,h6,blockquote,section").forEach((el) => {
    if (!el.isConnected) return;
    if (el.tagName === "FIGCAPTION" || (!el.querySelector(BLOCKS) && isBoiler(el.textContent))) el.remove();
  });
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const t = (h.textContent || "").trim();
    if (t && !/[.!?。！？:;]$/.test(t)) h.appendChild(doc.createTextNode("."));   // judul bagian jadi kalimat sendiri saat dibaca
  });
  root.querySelectorAll("br").forEach((b) => b.replaceWith(doc.createTextNode("\n")));
  root.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,blockquote,section,article,ul,ol,table,tr,td,th,pre").forEach((el) => {
    el.appendChild(doc.createTextNode(el.tagName === "TD" || el.tagName === "TH" ? " " : "\n"));   // cegah kata menempel antarparagraf pada HTML ter-minify
  });
  return (root.textContent || "").replace(/\s+/g, " ").trim();
}

/* ---------- Artikel beberapa halaman ---------- */
const PAGE_PARAMS = new Set(["page", "p", "pg", "paged", "halaman", "hal"]);
const NEXT_TEXT = /^(next( page)?|selanjutnya|berikutnya|halaman (selanjutnya|berikutnya)|lanjut(kan)?|[›»>→]+)(\s*[›»>→]+)?$/i;
const ALL_TEXT = /^(lihat semua|baca semua|semua halaman|satu halaman|single page|view all|show all|read all|full article|tampilkan semua|all pages|lihat satu halaman)$/i;

function norm(u, stripNumber) {
  const x = new URL(u);
  let path = x.pathname.replace(/\/+$/, "");
  if (stripNumber) path = path.replace(/\/(?:page|halaman|p)\/\d{1,3}$/i, "").replace(/\/\d{1,3}$/, "");
  path = path.replace(/\/(all|full|single)$/i, "");
  const q = [...x.searchParams].filter(([k]) => !PAGE_PARAMS.has(k.toLowerCase())).map(([k, v]) => k + "=" + v).sort().join("&");
  return x.hostname.replace(/^www\./, "").toLowerCase() + path + (q ? "?" + q : "");
}
// Apakah `cand` hanya halaman lain dari artikel `first`? Menolak artikel sebelumnya/berikutnya yang kebetulan ditautkan.
// Pembanding sengaja memakai URL halaman pertama apa adanya (tanpa membuang angka di akhir) supaya "/berita/123" tidak cocok dengan "/berita/124".
function isPagerUrl(first, cand) {
  try {
    const a = new URL(cand);
    if (!/^https?:$/.test(a.protocol)) return false;
    if (a.href.split("#")[0] === new URL(first).href.split("#")[0]) return false;
    return norm(cand, true) === norm(first, false);
  } catch (e) { return false; }
}

const decAttr = (s) => String(s).replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
const attrOf = (t, n) => { const m = t.match(new RegExp("\\b" + n + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i")); return m ? decAttr(m[1] !== undefined ? m[1] : m[2]) : ""; };

// Mengembalikan { next, all }: `next` = halaman berikutnya, `all` = tautan "lihat semua / satu halaman". Hanya URL yang lolos isPagerUrl.
function findPager(html, base, first) {
  first = first || base;
  const out = { next: "", all: "", nums: [] };   // nums: tautan bernomor (1 2 3 …) bila tidak ada tombol "berikutnya"
  const take = (href, kind) => {
    if (!href) return;
    try {
      const u = new URL(href.trim(), base).href;
      if (!isPagerUrl(first, u)) return;
      if (kind === "nums") { if (!out.nums.includes(u)) out.nums.push(u); } else if (!out[kind]) out[kind] = u;
    } catch (e) {}
  };
  html = String(html || "");
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) if (/\brel\s*=\s*["']?next\b/i.test(m[0])) take(attrOf(m[0], "href"), "next");
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    const href = attrOf(m[1], "href");
    if (/\brel\s*=\s*["'][^"']*\bnext\b/i.test(m[1]) || NEXT_TEXT.test(text)) take(href, "next");
    else if (ALL_TEXT.test(text)) take(href, "all");
    else if (/^\d{1,3}$/.test(text)) take(href, "nums");
  }
  return out;
}

// Membaca artikel beserta halaman lanjutannya. fetchPage(url) -> {html, url}; parse(html, url) -> {title, text}.
// Berhenti bila: tidak ada halaman baru, halaman sudah pernah dibaca, batas halaman/teks/waktu tercapai, atau pengambilan gagal
// (halaman yang sudah terbaca tetap dikembalikan). Halaman pertama yang gagal dilempar sebagai galat seperti biasa.
async function readAll(fetchPage, parse, url, opt) {
  opt = opt || {};
  const maxPages = opt.maxPages || 8, budget = opt.budgetMs || 45000, maxText = opt.maxText || 300000, t0 = Date.now();
  const strip = (u) => String(u).split("#")[0];
  const first = await fetchPage(url), art = parse(first.html, first.url);
  const parts = [art.text], seen = new Set([strip(first.url)]);
  let page = first;
  for (let tries = 0; tries < maxPages * 2 && parts.length < maxPages && Date.now() - t0 < budget; tries++) {
    if (parts.join(" ").length > maxText) break;
    const pg = findPager(page.html, page.url, first.url);
    const cand = [pg.all, pg.next, ...pg.nums].find((u) => u && !seen.has(strip(u)));
    if (!cand) break;
    seen.add(strip(cand));
    let nx, got;
    try { nx = await fetchPage(cand); seen.add(strip(nx.url)); got = parse(nx.html, nx.url); } catch (e) { break; }
    page = nx;
    if (cand === pg.all) {   // "lihat semua": pakai bila memuat lebih banyak daripada yang sudah terkumpul
      if (got.text.length >= parts.join(" ").length) { parts.length = 0; parts.push(got.text); }
      break;
    }
    const head = got.text.slice(0, 200);
    if (head && parts.some((p) => p.includes(head))) continue;   // halaman yang sama dengan yang sudah ada
    parts.push(got.text);
  }
  return { title: art.title, text: parts.join(" "), pages: parts.length };
}

module.exports = { prepare, extractText, findPager, isPagerUrl, isBoiler, isReadMore, readAll };
