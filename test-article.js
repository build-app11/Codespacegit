// Uji pembersih artikel (article.js): halaman berikutnya, "read more", elemen non-isi, baris non-isi.
// Jalankan: npm run article:test   (bagian DOM butuh jsdom, sudah ada di dependencies)
const assert = require("assert");
const A = require("./article");
const ok = (m) => console.log("ok  " + m);

/* ---------- 1. Logika murni ---------- */
const P = (f, c) => A.isPagerUrl(f, c);
assert.ok(P("https://x.test/read/2026/slug", "https://x.test/read/2026/slug?page=2"));
assert.ok(P("https://x.test/read/2026/slug", "https://x.test/read/2026/slug?page=all"));
assert.ok(P("https://x.test/read/2026/slug/", "https://x.test/read/2026/slug/2/"));
assert.ok(P("https://x.test/read/2026/slug", "https://x.test/read/2026/slug/page/3"));
assert.ok(P("https://www.x.test/a", "https://x.test/a?page=2"));
assert.ok(P("https://x.test/a?id=5", "https://x.test/a?id=5&page=2"));
assert.ok(!P("https://x.test/a?id=5", "https://x.test/a?id=6&page=2"));
assert.ok(!P("https://x.test/news/123", "https://x.test/news/124"));        // artikel lain dengan ID berurutan
assert.ok(P("https://x.test/news/123", "https://x.test/news/123/2"));
assert.ok(!P("https://x.test/a", "https://x.test/a"));                      // halaman yang sama
assert.ok(!P("https://x.test/a", "https://x.test/a#komentar"));
assert.ok(!P("https://x.test/a", "https://other.test/a?page=2"));
assert.ok(!P("https://x.test/a", "https://x.test/artikel-lain"));
assert.ok(!P("https://x.test/a", "javascript:void(0)"));
ok("isPagerUrl: halaman lanjutan diterima, artikel lain/situs lain/skema berbahaya ditolak");

const html = `<head><link rel="next" href="/a?page=2"></head><body>
  <a href="/a?page=3" class="p">3</a> <a href="/a?page=2">2</a> <a href="/a">1</a>
  <a href="/a?page=2" rel="next">Halaman berikutnya</a>
  <a href="/a?page=all"><span>Lihat Semua</span></a>
  <a href="/berita-lain-123">Berita berikutnya</a><a href="/lain/9" rel="next">Next</a><a href="/a?page=2&amp;x=1">›</a></body>`;
const pg = A.findPager(html, "https://x.test/a", "https://x.test/a");
assert.strictEqual(pg.next, "https://x.test/a?page=2");
assert.strictEqual(pg.all, "https://x.test/a?page=all");
assert.deepStrictEqual(pg.nums, ["https://x.test/a?page=3", "https://x.test/a?page=2"]);
const none = A.findPager('<a href="/lain/9" rel="next">Next</a><a href="/z">Selanjutnya</a>', "https://x.test/a", "https://x.test/a");
assert.deepStrictEqual(none, { next: "", all: "", nums: [] });
ok("findPager: rel=next, teks tombol, lihat semua, nomor halaman; tautan ke artikel lain diabaikan");

for (const t of ["Baca juga: Harga BBM naik", "Simak Juga Video Ini", "Read also: something", "ADVERTISEMENT", "Scroll to Continue with Content", "Penulis: Budi | Editor: Ani",
  "Foto: Antara", "Share this article", "Bagikan artikel ini ke:", "Subscribe to our newsletter", "Related Articles"]) assert.ok(A.isBoiler(t), t);
for (const t of ["Share prices fell 3 percent on Tuesday.", "Presiden mengatakan sumber: dokumen itu asli.", "Foto itu diambil pada 2019 dan menunjukkan kerusakan parah di pelabuhan.",
  "Baca", "Editorial board menolak usulan tersebut.", "Penulis buku itu hadir di acara."]) assert.ok(!A.isBoiler(t), t);
for (const t of ["Baca selengkapnya", "Read more »", "Load more", "Lihat Semua", "Muat lebih banyak"]) assert.ok(A.isReadMore(t), t);
for (const t of ["Baca selengkapnya tentang kasus ini di bawah", "more", "Selengkapnya soal anggaran"]) assert.ok(!A.isReadMore(t), t);
ok("isBoiler / isReadMore: baris non-isi dikenali, kalimat berita biasa tidak ikut terbuang");

/* ---------- 2. Kasus DOM (dijalankan dengan jsdom atau di browser) ---------- */
const LONG = "Kalimat isi yang cukup panjang untuk dianggap sebagai bagian artikel sungguhan. ".repeat(4);
const cases = [
  { name: "bagian tersembunyi di balik read more dibuka, tombolnya dibuang",
    html: `<body><article><p>Pembuka artikel.</p><div id="more-text" style="display:none"><p>TERSEMBUNYI ${LONG}</p></div><a href="/x">Baca selengkapnya</a></article></body>`,
    fn: `A.prepare(doc); return { text: doc.body.textContent, shown: doc.getElementById("more-text").style.display !== "none" };`,
    check: (o) => { assert.ok(o.shown); assert.ok(o.text.includes("TERSEMBUNYI")); assert.ok(!o.text.includes("Baca selengkapnya")); } },
  { name: "menu tersembunyi (banyak tautan) tidak ikut dibuka",
    html: `<body><div class="more-menu" style="display:none">${'<a href="/k">Kategori panjang sekali judulnya </a>'.repeat(12)}</div><article><p>Isi.</p></article></body>`,
    fn: `A.prepare(doc); var m = doc.querySelector(".more-menu"); return { gone: !m || m.style.display === "none" };`,
    check: (o) => assert.ok(o.gone) },
  { name: "elemen non-isi dibuang, isi dan pembungkusnya tetap",
    html: `<body><nav><a href="/">Beranda</a></nav><div class="content-area has-sidebar"><article><p id="isi1">Isi satu ${LONG}</p>
      <div class="elementor-widget-container"><p id="isi2">Isi dua ${LONG}</p></div>
      <div class="share-buttons"><a href="#">Bagikan ke Facebook</a></div><div class="ad-slot">IKLAN-X</div></article>
      <div class="related-posts"><a href="/b">BERITA-TERKAIT-X</a></div><section id="comments">KOMENTAR-X</section><footer>FOOTER-X</footer><button>TOMBOL-X</button></div></body>`,
    fn: `A.prepare(doc); return doc.body.textContent;`,
    check: (t) => { ["Isi satu", "Isi dua"].forEach((k) => assert.ok(t.includes(k), k));
      ["Beranda", "Bagikan ke Facebook", "IKLAN-X", "BERITA-TERKAIT-X", "KOMENTAR-X", "FOOTER-X", "TOMBOL-X"].forEach((k) => assert.ok(!t.includes(k), k)); } },
  { name: "<form> yang membungkus seluruh halaman tidak menghapus isi",
    html: `<body><form id="aspnetForm"><article><p>Isi penting ${LONG}</p></article></form></body>`,
    fn: `A.prepare(doc); return doc.body.textContent;`,
    check: (t) => assert.ok(t.includes("Isi penting")) },
  { name: "baris non-isi dibuang, kalimat berita 'Share prices…' tetap",
    html: `<body><div><p>Penulis: Budi | Editor: Ani</p><p>Share prices fell 3 percent on Tuesday.</p><p>Baca juga: Harga BBM naik</p><p>ADVERTISEMENT</p><p>Scroll to Continue with Content</p>
      <figure><img src="x.jpg"><figcaption>Keterangan foto contoh</figcaption></figure><p>Kalimat penutup.</p></div></body>`,
    fn: `return A.extractText(doc);`,
    check: (t) => { assert.strictEqual(t, "Share prices fell 3 percent on Tuesday. Kalimat penutup."); } },
  { name: "paragraf pada HTML ter-minify tidak menempel; judul bagian jadi kalimat sendiri",
    html: `<body><div><p>Satu.</p><p>Dua tanpa titik</p><h2>Subjudul</h2><p>Isi bagian.</p><ul><li>Poin A</li><li>Poin B</li></ul>baris<br>baru</div></body>`,
    fn: `return A.extractText(doc);`,
    check: (t) => assert.strictEqual(t, "Satu. Dua tanpa titik Subjudul. Isi bagian. Poin A Poin B baris baru") },
];
module.exports = { cases };

/* ---------- 3. Alur multi-halaman (situs palsu, tanpa jaringan) ---------- */
async function readAllTests() {
  const site = (pages) => async (u) => { if (!(u in pages)) throw new Error("404"); return { html: pages[u], url: u }; };
  const parse = (h) => ({ title: "T", text: (h.match(/TEXT-\d+/g) || []).join(" ") });
  const B = "https://x.test/a";
  const nav = (n) => `<a href="${B}?page=${n}" rel="next">Halaman berikutnya</a>`;

  let r = await A.readAll(site({ [B]: "TEXT-1" + nav(2), [B + "?page=2"]: "TEXT-2" + nav(3), [B + "?page=3"]: "TEXT-3" }), parse, B);
  assert.deepStrictEqual([r.text, r.pages], ["TEXT-1 TEXT-2 TEXT-3", 3]);

  r = await A.readAll(site({ [B]: "TEXT-1" + nav(2), [B + "?page=2"]: `TEXT-2<a href="${B}" rel="next">Next</a>` }), parse, B);   // melingkar ke halaman 1
  assert.deepStrictEqual([r.text, r.pages], ["TEXT-1 TEXT-2", 2]);

  r = await A.readAll(site({ [B]: `TEXT-1${nav(2)}<a href="${B}?page=all">Lihat semua</a>`, [B + "?page=all"]: "TEXT-1 TEXT-2 TEXT-3", [B + "?page=2"]: "TEXT-2" }), parse, B);
  assert.strictEqual(r.text, "TEXT-1 TEXT-2 TEXT-3");

  r = await A.readAll(site({ [B]: 'TEXT-1<a href="https://x.test/lain-9" rel="next">Next</a><link rel="next" href="/b-2">', "https://x.test/lain-9": "TEXT-9" }), parse, B);   // artikel lain tidak diikuti
  assert.deepStrictEqual([r.text, r.pages], ["TEXT-1", 1]);

  r = await A.readAll(site({ [B]: "TEXT-1" + nav(2) }), parse, B);   // halaman 2 gagal dimuat: halaman 1 tetap dikembalikan
  assert.deepStrictEqual([r.text, r.pages], ["TEXT-1", 1]);

  r = await A.readAll(site({ [B]: `TEXT-1${nav(2)}<a href="${B}?page=1">1</a>`, [B + "?page=1"]: "TEXT-1", [B + "?page=2"]: "TEXT-2" }), parse, B);   // ?page=1 = duplikat halaman 1
  assert.strictEqual(r.text, "TEXT-1 TEXT-2");

  const endless = async (u) => { const n = +(u.split("page=")[1] || 1); return { html: `TEXT-${n}<a rel="next" href="${B}?page=${n + 1}">Next</a>`, url: u }; };
  r = await A.readAll(endless, parse, B);   // rantai tak berujung berhenti di batas
  assert.strictEqual(r.pages, 8);
  r = await A.readAll(endless, parse, B, { maxPages: 3 });
  assert.strictEqual(r.pages, 3);

  await assert.rejects(() => A.readAll(site({}), parse, B), /404/);   // halaman pertama gagal tetap galat
  ok("readAll: rantai halaman, loop, lihat semua, artikel lain, kegagalan di tengah, duplikat, batas halaman");
}

if (require.main === module) {
  (async () => { await readAllTests(); main(); })();
}
function main() {
  let JSDOM = null;
  try { ({ JSDOM } = require("jsdom")); } catch (e) {}
  if (!JSDOM) console.log("--  tes DOM dilewati: jsdom belum terpasang (jalankan npm install)");
  else {
    for (const c of cases) {
      const doc = new JSDOM(c.html).window.document;
      c.check(new Function("A", "doc", c.fn)(A, doc));
      ok("DOM: " + c.name);
    }
  }
  console.log("\nTes artikel selesai.");
}
