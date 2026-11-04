// Uji pembaca feed berita: RSS 2.0, Atom, RSS 1.0, tautan relatif, guid, entitas/CDATA, dan penemuan feed dari HTML.
// Jalankan: npm run news:test   (tanpa jaringan, tanpa dependensi)
const assert = require("assert");
const { parseNews, discoverFeeds } = require("./news");
const ok = (m) => console.log("ok  " + m);

// 1. RSS 2.0
const rss = parseNews(`<?xml version="1.0"?><rss version="2.0" xmlns:content="x" xmlns:dc="y" xmlns:atom="z"><channel>
  <title><![CDATA[Berita & Kabar]]></title><atom:link href="https://x.test/self" rel="self"/>
  <image><title>Logo</title></image>
  <item><title>Judul &amp; satu</title><link>https://news.test/a?x=1&amp;y=2</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Ringkasan <b>tebal</b> di sini.</p><script>alert(1)</script>]]></description></item>
  <item><title>Tautan relatif</title><link>/baca/2</link><dc:date>2026-11-02T08:30:00Z</dc:date>
    <content:encoded><![CDATA[<p>Isi panjang</p>]]></content:encoded><description>pendek</description></item>
  <item><title>Hanya guid</title><guid isPermaLink="true">https://news.test/g/3</guid></item>
  <item><title>Tanpa tautan</title><guid isPermaLink="false">abc123</guid></item>
  <item><title>Skema aneh</title><link>javascript:alert(1)</link></item>
</channel></rss>`, { base: "https://news.test/feed.xml" });
assert.strictEqual(rss.title, "Berita & Kabar");
assert.strictEqual(rss.articles.length, 3);
assert.deepStrictEqual(rss.articles[0], { title: "Judul & satu", link: "https://news.test/a?x=1&y=2", date: "2026-11-03T10:00:00.000Z", summary: "Ringkasan tebal di sini.", content: "" });
assert.strictEqual(rss.articles[1].link, "https://news.test/baca/2");
assert.strictEqual(rss.articles[1].date, "2026-11-02T08:30:00.000Z");
assert.strictEqual(rss.articles[1].summary, "pendek");        // cuplikan daftar dari description
assert.strictEqual(rss.articles[1].content, "Isi panjang");   // isi penuh dari content:encoded
assert.strictEqual(rss.articles[2].link, "https://news.test/g/3");
assert.strictEqual(rss.articles[2].date, "");
const longDesc = "Kalimat isi. ".repeat(100);   // description sangat panjang dianggap isi lengkap, bukan ringkasan
const big = parseNews(`<rss><channel><title>t</title><item><title>a</title><link>https://n.test/a</link><description>${longDesc}</description></item></channel></rss>`).articles[0];
assert.strictEqual(big.summary.length, 300);
assert.strictEqual(big.content, longDesc.trim());
ok("RSS 2.0: CDATA, entitas, skrip dibuang, tautan relatif, guid, skema berbahaya dilewati");

// 2. Atom
const atom = parseNews(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog &amp; Co</title><link href="https://b.test/" rel="self"/>
  <entry><title type="html">&lt;b&gt;Satu&lt;/b&gt;</title><link rel="enclosure" href="https://b.test/f.mp3"/><link rel="alternate" href="https://b.test/1"/>
    <updated>2026-11-01T00:00:00Z</updated><summary>Ringkas</summary></entry>
  <entry><title>Dua</title><link href="/2"/><published>2026-10-31T00:00:00Z</published><content type="html">&lt;p&gt;Isi&lt;/p&gt;</content></entry>
</feed>`, { base: "https://b.test/atom" });
assert.strictEqual(atom.title, "Blog & Co");
assert.strictEqual(atom.articles.length, 2);
assert.strictEqual(atom.articles[0].title, "Satu");
assert.strictEqual(atom.articles[0].link, "https://b.test/1");
assert.strictEqual(atom.articles[1].link, "https://b.test/2");
assert.strictEqual(atom.articles[1].summary, "Isi");
ok("Atom: rel=alternate dipilih, tautan relatif, konten ter-escape");

// 3. RSS 1.0 (RDF)
const rdf = parseNews(`<rdf:RDF xmlns:rdf="r" xmlns="http://purl.org/rss/1.0/" xmlns:dc="d"><channel><title>RDF</title></channel>
  <item><title>Satu</title><link>https://r.test/1</link><dc:date>2026-11-01T00:00:00Z</dc:date></item></rdf:RDF>`);
assert.strictEqual(rdf.articles.length, 1);
assert.strictEqual(rdf.articles[0].link, "https://r.test/1");
ok("RSS 1.0 (RDF)");

// 4. Batas jumlah dan galat
const many = "<rss><channel><title>t</title>" + Array.from({ length: 150 }, (_, i) => `<item><title>n${i}</title><link>https://m.test/${i}</link></item>`).join("") + "</channel></rss>";
assert.strictEqual(parseNews(many).articles.length, 100);
assert.strictEqual(parseNews(many, { max: 5 }).articles.length, 5);
assert.throws(() => parseNews("<html><body>bukan feed</body></html>"), /bukan feed/);
assert.throws(() => parseNews("<rss><channel><title>x</title></channel></rss>"), /Tidak ada artikel/);
ok("batas 100 artikel, galat untuk non-feed dan feed kosong");

// 5. Penemuan feed dari halaman situs
const found = discoverFeeds(`<html><head>
  <link rel="alternate" type="application/rss+xml" title="RSS" href="/rss.xml">
  <link href='https://cdn.test/atom.xml' type='application/atom+xml' rel='alternate'>
  <link rel="stylesheet" href="/s.css"><link rel="alternate" type="text/html" href="/en">
  <link rel="alternate" type="application/rss+xml" href="javascript:x">
  <link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>`, "https://site.test/home");
assert.deepStrictEqual(found, ["https://site.test/rss.xml", "https://cdn.test/atom.xml"]);
assert.deepStrictEqual(discoverFeeds("<html></html>", "https://site.test/"), []);
ok("penemuan feed: urutan atribut bebas, duplikat dan skema berbahaya dibuang");

console.log("\nSemua tes berita lulus.");
