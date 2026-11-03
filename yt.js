// Pengambil subtitle YouTube: mencoba beberapa klien InnerTube + halaman watch,
// lalu library lama sebagai cadangan. Mengembalikan alasan gagal yang sebenarnya.
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const cookie = () => "CONSENT=YES+1; SOCS=CAI" + (process.env.YT_COOKIE ? "; " + process.env.YT_COOKIE : "");
const sig = () => AbortSignal.timeout(12000);

const CLIENTS = [
  { name: "ANDROID", id: 3, ver: "20.10.38", ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    ctx: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 11, hl: "en", gl: "US" } },
  { name: "IOS", id: 5, ver: "20.10.4", ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    ctx: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en", gl: "US" } },
  { name: "TV_EMBED", id: 85, ver: "2.0", ua: UA_WEB, embed: true,
    ctx: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" } },
  { name: "WEB", id: 1, ver: "2.20250210.01.00", ua: UA_WEB,
    ctx: { clientName: "WEB", clientVersion: "2.20250210.01.00", hl: "en", gl: "US" } },
];

function videoId(u) {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname);
  return m ? m[1] : "";
}

function decode(s) {
  const one = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return one(one(s));
}

async function viaPlayer(id, reasons) {
  for (const c of CLIENTS) {
    try {
      const body = { context: { client: c.ctx }, videoId: id, contentCheckOk: true, racyCheckOk: true };
      if (c.embed) body.context.thirdParty = { embedUrl: "https://www.youtube.com/watch?v=" + id };
      const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST", signal: sig(), body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "User-Agent": c.ua, "X-YouTube-Client-Name": String(c.id),
          "X-YouTube-Client-Version": c.ver, Origin: "https://www.youtube.com", "Accept-Language": "en-US,en;q=0.9", Cookie: cookie() },
      });
      if (!r.ok) { reasons.push(c.name + ": HTTP " + r.status); continue; }
      const j = await r.json();
      const tracks = j && j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (tracks && tracks.length) return { tracks, title: j.videoDetails && j.videoDetails.title, ua: c.ua };
      const ps = (j && j.playabilityStatus) || {};
      reasons.push(c.name + ": " + (ps.reason || ps.status || "tidak ada data caption") + (ps.status === "OK" ? " [video bisa diputar, tanpa caption]" : ""));
    } catch (e) { reasons.push(c.name + ": " + e.message); }
  }
  return null;
}

async function viaWatch(id, reasons) {
  try {
    const r = await fetch("https://www.youtube.com/watch?v=" + id + "&hl=en&has_verified=1", {
      signal: sig(), headers: { "User-Agent": UA_WEB, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie() } });
    const h = await r.text();
    const m = /ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>)/.exec(h);
    if (!m) { reasons.push("WATCH: halaman tidak memuat data pemutar (HTTP " + r.status + ")"); return null; }
    const j = JSON.parse(m[1]);
    const tracks = j.captions && j.captions.playerCaptionsTracklistRenderer && j.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (tracks && tracks.length) return { tracks, title: j.videoDetails && j.videoDetails.title, ua: UA_WEB };
    const ps = j.playabilityStatus || {};
    reasons.push("WATCH: " + (ps.reason || ps.status || "tidak ada data caption"));
  } catch (e) { reasons.push("WATCH: " + e.message); }
  return null;
}

async function trackText(t, ua, reasons) {
  const base = String(t.baseUrl).replace(/&fmt=\w+/, "");
  for (const fmt of ["json3", ""]) {
    try {
      const r = await fetch(base + (fmt ? "&fmt=" + fmt : ""), { signal: sig(),
        headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie() } });
      if (!r.ok) { reasons.push("TEXT(" + (fmt || "xml") + "): HTTP " + r.status); continue; }
      const b = await r.text();
      if (!b.trim()) { reasons.push("TEXT(" + (fmt || "xml") + "): respons kosong"); continue; }
      if (fmt === "json3") {
        const j = JSON.parse(b);
        const out = (j.events || []).filter((e) => e.segs).map((e) => e.segs.map((s) => s.utf8 || "").join("")).join(" ");
        if (out.trim()) return out;
      } else {
        const parts = [...b.matchAll(/<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")));
        if (parts.join("").trim()) return parts.join(" ");
      }
    } catch (e) { reasons.push("TEXT(" + (fmt || "xml") + "): " + e.message); }
  }
  return "";
}

const pick = (langs) => {
  for (const p of ["id", "en"]) { const f = langs.find((l) => l === p) || langs.find((l) => l.startsWith(p + "-")); if (f) return f; }
  return langs[0];
};

function explain(reasons) {
  const all = reasons.join(" | ");
  if (/bot|sign in|login|confirm you|unusual traffic|HTTP 429|HTTP 403/i.test(all))
    return "YouTube menolak permintaan dari server ini (dianggap bot; sering terjadi di Codespaces atau server cloud). Coba jalankan aplikasi di komputer sendiri, atau isi variabel lingkungan YT_COOKIE dengan cookie akun YouTube. Rincian: " + all;
  if (/tanpa caption/i.test(all)) return "Video ini tidak menyediakan subtitle/transkrip yang bisa diambil. Rincian: " + all;
  return "Gagal mengambil subtitle. Rincian: " + all;
}

async function legacy(href, want) {
  const { YoutubeTranscript } = require("youtube-transcript");
  let segs = null, lang = want || "und";
  for (const l of want ? [want] : ["id", "en", ""]) {
    try { segs = await YoutubeTranscript.fetchTranscript(href, l ? { lang: l } : undefined); if (l) lang = l; break; } catch (e) { /* lanjut */ }
  }
  if (!segs || !segs.length) return null;
  return { text: segs.map((s) => s.text).join(" "), lang, langs: [lang] };
}

async function fetchYoutube(href, want) {
  const u = new URL(href), id = videoId(u);
  if (!id) throw new Error("ID video tidak ditemukan di link");
  const reasons = [];
  const info = (await viaPlayer(id, reasons)) || (await viaWatch(id, reasons));
  if (!info) {
    let old = null;
    try { old = await legacy(href, want); } catch (e) { reasons.push("LIB: " + e.message); }
    if (old) return { title: href, ...old };
    throw new Error(explain(reasons));
  }
  // satu track per bahasa; utamakan subtitle manual daripada otomatis (asr)
  const by = new Map();
  info.tracks.forEach((t) => { const c = t.languageCode; if (c && (!by.has(c) || (by.get(c).kind === "asr" && t.kind !== "asr"))) by.set(c, t); });
  const langs = [...by.keys()];
  if (want && !by.has(want)) throw new Error("Subtitle bahasa \"" + want + "\" tidak tersedia di video ini");
  const lang = want || pick(langs);
  const text = await trackText(by.get(lang), info.ua, reasons);
  if (!text.trim()) throw new Error(explain(reasons.length ? reasons : ["tanpa caption: isi subtitle kosong"]));
  let title = info.title;
  if (!title) {
    try { const o = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(href), { signal: sig() }); title = (await o.json()).title; } catch (e) {}
  }
  return { title: title || href, text: decode(text), lang, langs };
}

module.exports = { fetchYoutube, videoId, decode };
