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

/* ---------- per bahasa ---------- */
async function ja(text) {
  const toks = (await getTokenizer()).tokenize(text), rm = [], ip = [];
  for (const t of toks) {
    const rd = [t.pronunciation, t.reading].find((x) => x && x !== "*" && /^[\u30A0-\u30FF]+$/.test(x));
    if (rd) { const c = kana.convert(rd); rm.push(c.romaji); ip.push(c.ipa); }
    else if (kana.isKana(t.surface_form)) { const c = kana.convert(t.surface_form); rm.push(c.romaji); ip.push(c.ipa); }
    else { const s = [...t.surface_form].map((ch) => PUNCT[ch] ?? ch).join(""); rm.push(s); ip.push(s); }
  }
  return { rm: joinParts(rm), ip: joinParts(ip) };
}
function zh(text) {
  const py = getPinyin();
  if (!py) throw new Error("paket pinyin-pro belum terpasang");
  const rm = [], ip = [];
  text.split(/([\u3400-\u9fff]+)/).forEach((seg) => {
    if (!seg) return;
    if (/^[\u3400-\u9fff]+$/.test(seg)) {
      const a = py(seg, { type: "array" }), n = py(seg, { type: "array", toneType: "num" });
      a.forEach((s, i) => { rm.push(s); ip.push(pinyinToIpa(n[i] || "") || s); });
    } else { const s = seg.trim().replace(/[\u3000-\u303f\uff00-\uffef]/g, (ch) => PUNCT[ch] ?? ch); if (s) { rm.push(s); ip.push(s); } }
  });
  return { rm: joinParts(rm), ip: joinParts(ip) };
}
async function espeak(text, lang) {
  if (!lang) return "";
  try {
    const f = await getPhonemizer();
    const r = await queue(() => f(text, voiceFor(lang)));
    return (Array.isArray(r) ? r.join(" ") : String(r || "")).replace(/\s+/g, " ").trim();
  } catch (e) { log("IPA (espeak) gagal untuk bahasa", lang + ":", e.message); return ""; }
}

/* ---------- API ---------- */
// want: {rm:boolean, ip:boolean}. Mengembalikan {rm, ip} (string kosong bila tidak ada).
async function analyze(text, lang, want) {
  want = want || { rm: true, ip: true };
  text = String(text || "").slice(0, 500).trim();
  const out = { rm: "", ip: "" };
  if (!text) return out;
  const L = pickLang(text, lang), base = L.split("-")[0].toLowerCase();
  try {
    if (base === "ja") return await ja(text);
    if (base === "zh") return zh(text);
  } catch (e) { log("gagal (" + base + "), memakai cadangan umum:", e.message); }
  if (want.rm && nonLatin(text)) {
    if (base === "ko") out.rm = hangul.romanize(text);
    else { const a = getAscii(); if (a) out.rm = a(text).replace(/\s+/g, " ").trim(); else log("paket any-ascii belum terpasang"); }
  }
  if (want.ip) out.ip = await espeak(text, L);
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

module.exports = { analyze, status, nonLatin, pickLang };
