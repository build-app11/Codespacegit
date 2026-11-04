// Fonetik lokal (tanpa Wiktionary/Google): romanisasi + IPA.
//  Jepang  : kuromoji (baca kanji) + tabel kana.js
//  Mandarin: pinyin-pro + tabel pinyinipa.js
//  Korea   : tabel hangul.js (romanisasi); IPA dari espeak-ng
//  Lainnya : any-ascii (romanisasi aksara non-Latin); IPA dari espeak-ng (paket "phonemizer", WASM)
const path = require("path");
const kana = require("./kana");
const { pinyinToIpa } = require("./pinyinipa");
const hangul = require("./hangul");

const tryRequire = (n) => { try { return require(n); } catch (e) { return null; } };
const nonLatin = (t) => [...String(t)].some((c) => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c));
const warned = new Set();
const log = (...a) => { const m = a.join(" "); if (!warned.has(m)) { warned.add(m); console.warn("[fonetik]", m); } };

/* ---------- pemuat library (malas, gagal dengan tenang) ---------- */
let pinyinFn, asciiFn, tokP, phzP;
function getPinyin() {
  if (pinyinFn === undefined) { const m = tryRequire("pinyin-pro"); pinyinFn = (m && m.pinyin) || null; }
  return pinyinFn;
}
function getAscii() {
  if (asciiFn === undefined) { const m = tryRequire("any-ascii"); asciiFn = m ? (typeof m === "function" ? m : m.default || m.anyAscii || null) : null; }
  return asciiFn;
}
function getTokenizer() {
  if (!tokP) tokP = new Promise((res, rej) => {
    const k = tryRequire("kuromoji");
    if (!k) return rej(new Error("paket kuromoji belum terpasang"));
    const dicPath = path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
    k.builder({ dicPath }).build((e, t) => (e ? rej(e) : res(t)));
  });
  return tokP;
}
function getPhonemizer() {
  if (!phzP) phzP = import("phonemizer").then((m) => m.phonemize || (m.default && m.default.phonemize)).then((f) => { if (typeof f !== "function") throw new Error("phonemize tidak ditemukan"); return f; });
  return phzP;
}
// espeak (WASM) hanya boleh satu pemanggilan pada satu waktu
let chain = Promise.resolve();
const queue = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

/* ---------- bantu ---------- */
const hasKana = (t) => /[\u3040-\u30ff]/.test(t);
const hasHan = (t) => /[\u3400-\u9fff]/.test(t);
function pickLang(text, lang) {
  const b = String(lang || "").split("-")[0].toLowerCase();
  if (hasKana(text)) return "ja";
  if (hasHan(text)) return b === "ja" ? "ja" : "zh";
  if (/[\uAC00-\uD7A3]/.test(text) && !b) return "ko";
  return String(lang || "");
}
function voiceFor(lang) {
  const l = String(lang);
  if (/^en-(gb|au|nz|za|in)/i.test(l)) return "en-gb";
  if (/^pt-br/i.test(l)) return "pt-br";
  const b = l.split("-")[0].toLowerCase();
  return { en: "en-us", iw: "he", no: "nb", tl: "fil", zh: "cmn" }[b] || b;
}
const CLOSE = /^[,.!?;:)\]}»”’」』、。！？]+$/;
function joinParts(parts) {
  let out = "";
  for (const p of parts) { if (!p) continue; out += out && !CLOSE.test(p) && !/[(\[{«“‘「『]$/.test(out) ? " " + p : p; }
  return out.trim();
}
const PUNCT = { "、": ",", "。": ".", "！": "!", "？": "?", "「": "“", "」": "”", "『": "“", "』": "”", "（": "(", "）": ")", "：": ":", "；": ";", "，": ",", "．": ".", "…": "...", "・": " " };

/* ---------- per kata ---------- */
// Setiap hasil adalah daftar segmen {t, wl, rm, ip} yang bila digabung (t) sama persis dengan teks aslinya.
// wl = true untuk kata (bukan spasi/tanda baca).
const WORDY = /[\p{L}\p{N}]/u;
function segs(text, lang) {
  let sg;
  try { sg = new Intl.Segmenter(lang || undefined, { granularity: "word" }); } catch (e) { sg = new Intl.Segmenter(undefined, { granularity: "word" }); }
  return Array.from(sg.segment(text)).map((x) => ({ t: x.segment, wl: !!x.isWordLike }));
}
function alignTo(text, items) {
  const out = []; let pos = 0;
  for (const it of items) {
    if (!it.t) continue;
    const i = text.indexOf(it.t, pos);
    if (i < 0) return null;
    if (i > pos) out.push({ t: text.slice(pos, i), wl: false });
    out.push(it); pos = i + it.t.length;
  }
  if (pos < text.length) out.push({ t: text.slice(pos), wl: false });
  return out;
}
async function jaWords(text) {
  const toks = (await getTokenizer()).tokenize(text);
  return alignTo(text, toks.map((t) => {
    const rd = [t.pronunciation, t.reading].find((x) => x && x !== "*" && /^[\u30A0-\u30FF]+$/.test(x));
    const it = { t: t.surface_form, wl: WORDY.test(t.surface_form), rm: "", ip: "" };
    if (rd) { const c = kana.convert(rd); it.rm = c.romaji; it.ip = c.ipa; }
    else if (kana.isKana(t.surface_form)) { const c = kana.convert(t.surface_form); it.rm = c.romaji; it.ip = c.ipa; }
    return it;
  }));
}
function zhWords(text) {
  const py = getPinyin();
  if (!py) throw new Error("paket pinyin-pro belum terpasang");
  const out = [];
  text.split(/([\u3400-\u9fff]+)/).forEach((seg) => {
    if (!seg) return;
    if (/^[\u3400-\u9fff]+$/.test(seg)) {      // satu sel per aksara Han
      const a = py(seg, { type: "array" }), n = py(seg, { type: "array", toneType: "num" });
      [...seg].forEach((ch, i) => out.push({ t: ch, wl: true, rm: a[i] || "", ip: pinyinToIpa(n[i] || "") || "" }));
    } else out.push(...segs(seg, "zh"));
  });
  return out;
}
async function espeak(text, lang) {
  if (!lang) return "";
  try {
    const f = await getPhonemizer();
    const r = await queue(() => f(text, voiceFor(lang)));
    return (Array.isArray(r) ? r.join(" ") : String(r || "")).replace(/\s+/g, " ").trim();
  } catch (e) { log("IPA (espeak) gagal untuk bahasa", lang + ":", e.message); return ""; }
}
const wordCache = new Map();
async function ipaWord(w, L) {
  const k = L + "|" + w;
  if (!wordCache.has(k)) wordCache.set(k, await espeak(w, L));
  return wordCache.get(k);
}
// IPA per kata: coba kalimat utuh (lebih akurat) lalu bagi per kata bila jumlahnya cocok; kalau tidak, per kata
async function ipaFill(ss, text, L) {
  const ws = ss.filter((x) => x.wl && WORDY.test(x.t));
  if (!ws.length) return;
  const full = await espeak(text, L), parts = full ? full.split(/\s+/).filter(Boolean) : [];
  if (parts.length === ws.length) { ws.forEach((x, i) => { x.ip = parts[i]; }); return; }
  for (const x of ws) x.ip = await ipaWord(x.t, L);
}
async function genericWords(text, L, base, want) {
  const ss = segs(text, L);
  if (want.rm && nonLatin(text)) {
    const a = base === "ko" ? null : getAscii();
    if (base !== "ko" && !a) log("paket any-ascii belum terpasang");
    ss.forEach((x) => { if (x.wl && nonLatin(x.t)) x.rm = base === "ko" ? hangul.romanize(x.t) : a ? a(x.t).replace(/\s+/g, " ").trim() : ""; });
  }
  if (want.ip) await ipaFill(ss, text, L);
  return ss;
}

/* ---------- API ---------- */
// want: {rm, ip}. Mengembalikan daftar segmen, atau null bila tidak bisa diselaraskan dengan teks.
async function analyzeWords(text, lang, want) {
  want = want || { rm: true, ip: true };
  text = String(text || "").slice(0, 1000);
  if (!text.trim()) return null;
  const L = pickLang(text, lang), base = L.split("-")[0].toLowerCase();
  let ws = null;
  try {
    if (base === "ja") ws = await jaWords(text);
    else if (base === "zh") ws = zhWords(text);
  } catch (e) { log("gagal (" + base + "), memakai cadangan umum:", e.message); }
  if (!ws) ws = await genericWords(text, L, base, want);
  return ws.map((x) => x.t).join("") === text ? ws : null;
}
// Versi satu string (untuk popup kata): romanisasi dan IPA digabung per kata
async function analyze(text, lang, want) {
  want = want || { rm: true, ip: true };
  const out = { rm: "", ip: "" };
  const ws = await analyzeWords(text, lang, want);
  if (!ws) return out;
  const j = (k) => joinParts(ws.map((x) => (x.wl ? x[k] || x.t : PUNCT[x.t.trim()] ?? x.t.trim())));
  if (want.rm && ws.some((x) => x.rm)) out.rm = j("rm");
  if (want.ip && ws.some((x) => x.ip)) out.ip = j("ip");
  return out;
}

// Cek mesin mana yang berhasil dimuat (untuk log awal dan /api/phon/status)
async function status() {
  const s = {};
  s.ja = await getTokenizer().then(() => true, (e) => e.message);
  s.zh = !!getPinyin() || "paket pinyin-pro belum terpasang";
  s.romanisasiLain = !!getAscii() || "paket any-ascii belum terpasang";
  s.ipaLain = await getPhonemizer().then(() => true, (e) => e.message);
  return s;
}

module.exports = { analyze, analyzeWords, status, nonLatin, pickLang };
