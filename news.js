// Berita (RSS) -> daftar artikel. Mendukung RSS 2.0, Atom, dan RSS 1.0 (RDF).
// Tanpa dependensi: parser kecil seperti di podcast.js, cukup untuk feed berita biasa.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const dec = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(n); } catch (x) { return ""; }
  }
  const v = ENT[e.toLowerCase()];
  return v === undefined ? m : v;
});

// CDATA dipakai apa adanya, selebihnya didekode. Isi ringkasan sering berupa HTML (kadang ter-escape), jadi tag dibuang
// setelah dekode; hasilnya teks polos.
function text(raw) {
  let out = "", last = 0, m;
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  while ((m = re.exec(raw))) { out += dec(raw.slice(last, m.index)) + m[1]; last = re.lastIndex; }
  out += dec(raw.slice(last));
  out = out.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return out.replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? text(m[1]) : "";
}
function attr(attrs, n) {
  const q = attrs.match(new RegExp("\\b" + n + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return q ? dec(q[1] !== undefined ? q[1] : q[2]) : "";
}

// Alamat artikel: RSS memakai <link>teks</link>, Atom memakai <link href="..." rel="alternate"/>.
function itemLink(it, base) {
  let href = "";
  for (const m of it.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const a = m[1], h = attr(a, "href"), rel = attr(a, "rel").toLowerCase();
    if (!h) continue;
    if (!rel || rel === "alternate") { href = h; break; }
  }
  if (!href) href = tag(it, "link");
  if (!href) {   // cadangan: guid yang berupa URL
    const g = tag(it, "guid");
    if (/^https?:\/\//i.test(g)) href = g;
  }
  if (!href) return "";
  try {
    const u = new URL(href.trim(), base || undefined);
    return /^https?:$/.test(u.protocol) ? u.href : "";
  } catch (e) { return ""; }
}

function parseNews(xml, opt) {
  xml = String(xml || "");
  opt = opt || {};
  if (!/<rss\b|<channel\b|<feed\b|<rdf:RDF\b/i.test(xml)) throw new Error("Ini bukan feed RSS atau Atom");
  const atom = /<feed\b/i.test(xml) && !/<rss\b|<channel\b/i.test(xml);
  const itemRe = atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const head = xml.split(atom ? /<entry[\s>]/i : /<item[\s>]/i)[0].replace(/<image\b[\s\S]*?<\/image>/gi, "");
  const articles = [], max = opt.max || 100;
  for (const it of xml.match(itemRe) || []) {
    const link = itemLink(it, opt.base);
    if (!link) continue;
    const d = new Date(tag(it, "pubDate") || tag(it, "dc:date") || tag(it, "published") || tag(it, "updated"));
    // summary: cuplikan pendek untuk daftar. content: isi lengkap dari feed (content:encoded / <content>, atau description
    // yang panjang), dipakai hanya bila halaman artikelnya tidak bisa diambil. Deskripsi pendek bukan isi lengkap.
    const enc = tag(it, "content:encoded") || tag(it, "content"), desc = tag(it, "description") || tag(it, "summary");
    const full = enc || (desc.length > 800 ? desc : "");
    articles.push({
      title: tag(it, "title") || "Tanpa judul",
      link,
      date: isNaN(d) ? "" : d.toISOString(),
      summary: (desc || enc).slice(0, 300),
      content: full.slice(0, 50000),
    });
    if (articles.length >= max) break;
  }
  if (!articles.length) throw new Error("Tidak ada artikel di feed ini");
  return { title: tag(head, "title") || "Berita", articles };
}

// Pengguna sering menempel alamat situs, bukan alamat feed. Cari <link rel="alternate" type="application/rss+xml|atom+xml">.
function discoverFeeds(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (!/\brel\s*=\s*["']?[^"'>]*alternate/i.test(t)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(t)) continue;
    const h = attr(t, "href");
    if (!h) continue;
    try {
      const u = new URL(h, base);
      if (/^https?:$/.test(u.protocol) && !out.includes(u.href)) out.push(u.href);
    } catch (e) {}
  }
  return out;
}

module.exports = { parseNews, discoverFeeds };
