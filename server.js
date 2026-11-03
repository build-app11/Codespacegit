const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

const app = express();
app.use(express.static("public"));

// Blokir alamat internal agar server tidak disalahgunakan (SSRF)
function isPrivate(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(ip);
}

app.get("/api/extract", async (req, res) => {
  try {
    const u = new URL(req.query.url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("URL harus http atau https");
    const ip = net.isIP(u.hostname) ? u.hostname : (await dns.lookup(u.hostname)).address;
    if (isPrivate(ip)) throw new Error("Alamat tidak diizinkan");

    const r = await fetch(u, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SuaraTTS/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("Situs membalas dengan status " + r.status);
    const html = await r.text();

    const dom = new JSDOM(html, { url: u.href });
    const art = new Readability(dom.window.document).parse();
    if (!art || !art.textContent.trim()) throw new Error("Isi artikel tidak ditemukan");

    res.json({ title: art.title, text: art.textContent.replace(/\s+/g, " ").trim() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Buka http://localhost:3000"));
