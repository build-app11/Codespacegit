// Katakana/hiragana -> romaji (Hepburn, makron) dan IPA. Murni tabel, tanpa dependensi.
const BASE = {};
`ア a a|イ i i|ウ u ɯ|エ e e|オ o o|
カ ka ka|キ ki ki|ク ku kɯ|ケ ke ke|コ ko ko|
ガ ga ɡa|ギ gi ɡi|グ gu ɡɯ|ゲ ge ɡe|ゴ go ɡo|
サ sa sa|シ shi ɕi|ス su sɯ|セ se se|ソ so so|
ザ za dza|ジ ji dʑi|ズ zu dzɯ|ゼ ze dze|ゾ zo dzo|
タ ta ta|チ chi tɕi|ツ tsu tsɯ|テ te te|ト to to|
ダ da da|ヂ ji dʑi|ヅ zu dzɯ|デ de de|ド do do|
ナ na na|ニ ni ɲi|ヌ nu nɯ|ネ ne ne|ノ no no|
ハ ha ha|ヒ hi çi|フ fu ɸɯ|ヘ he he|ホ ho ho|
バ ba ba|ビ bi bi|ブ bu bɯ|ベ be be|ボ bo bo|
パ pa pa|ピ pi pi|プ pu pɯ|ペ pe pe|ポ po po|
マ ma ma|ミ mi mi|ム mu mɯ|メ me me|モ mo mo|
ヤ ya ja|ユ yu jɯ|ヨ yo jo|
ラ ra ɾa|リ ri ɾi|ル ru ɾɯ|レ re ɾe|ロ ro ɾo|
ワ wa wa|ヲ o o|ヴ vu bɯ|ヰ i i|ヱ e e|
ァ a a|ィ i i|ゥ u ɯ|ェ e e|ォ o o|ヮ wa wa|ヵ ka ka|ヶ ke ke`
  .split("|").forEach((e) => { const [k, r, i] = e.trim().split(" "); BASE[k] = [r, i]; });

const SPECIAL = {};
`ファ fa ɸa|フィ fi ɸi|フェ fe ɸe|フォ fo ɸo|フュ fyu ɸʲɯ|ティ ti ti|ディ di di|トゥ tu tɯ|ドゥ du dɯ|テュ tyu tʲɯ|デュ dyu dʲɯ|
ウィ wi wi|ウェ we we|ウォ wo wo|シェ she ɕe|ジェ je dʑe|チェ che tɕe|ツァ tsa tsa|ツィ tsi tsi|ツェ tse tse|ツォ tso tso|イェ ye je|
ヴァ va ba|ヴィ vi bi|ヴェ ve be|ヴォ vo bo`
  .split("|").forEach((e) => { const [k, r, i] = e.trim().split(" "); SPECIAL[k] = [r, i]; });

// konsonan palatal untuk i-kana + ャュョ: [romaji, ipa]
const PAL = { キ: ["ky", "kʲ"], シ: ["sh", "ɕ"], チ: ["ch", "tɕ"], ジ: ["j", "dʑ"], ヂ: ["j", "dʑ"], ニ: ["ny", "ɲ"],
  ヒ: ["hy", "ç"], ミ: ["my", "mʲ"], リ: ["ry", "ɾʲ"], ギ: ["gy", "ɡʲ"], ビ: ["by", "bʲ"], ピ: ["py", "pʲ"] };
const SMALLY = { ャ: ["a", "a"], ュ: ["u", "ɯ"], ョ: ["o", "o"] };
const MACRON = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

const toKata = (s) => String(s).replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const isKana = (s) => /^[\u3041-\u3096\u30A1-\u30FA\u30FCー]+$/.test(s);

function parse(s) {
  const out = [];
  for (let k = 0; k < s.length; k++) {
    const c = s[k], d = s[k + 1] || "";
    if (c === "ッ") { out.push({ t: "q" }); continue; }
    if (c === "ン") { out.push({ t: "n" }); continue; }
    if (c === "ー") { out.push({ t: "l" }); continue; }
    if (SPECIAL[c + d]) { out.push({ t: "m", r: SPECIAL[c + d][0], i: SPECIAL[c + d][1] }); k++; continue; }
    if (PAL[c] && SMALLY[d]) {
      const [pr, pi] = PAL[c], [vr, vi] = SMALLY[d];
      out.push({ t: "m", r: pr + vr, i: pi + vi }); k++; continue;
    }
    if (BASE[c]) { out.push({ t: "m", r: BASE[c][0], i: BASE[c][1] }); continue; }
    out.push({ t: "o", r: c, i: c });
  }
  return out;
}
function nIpa(next) {
  if (!next || next.t !== "m") return "ɴ";
  const f = next.i;
  if (/^[pbm]/.test(f)) return "m";
  if (/^(ts|tɕ|dz|dʑ|[tdnɾ])/.test(f)) return "n";
  if (/^[kɡ]/.test(f)) return "ŋ";
  return "ɴ";
}
function convert(input) {
  const tk = parse(toKata(input));
  let r = "", ip = "", gem = false;
  tk.forEach((t, x) => {
    const next = tk[x + 1];
    if (t.t === "q") { gem = true; if (next && next.t === "m") r += next.r.startsWith("ch") ? "t" : next.r[0]; return; }
    if (t.t === "n") { r += next && next.t === "m" && /^[aiueoy]/.test(next.r) ? "n'" : "n"; ip += nIpa(next); return; }
    if (t.t === "l") {
      const last = r.slice(-1); if (MACRON[last]) r = r.slice(0, -1) + MACRON[last];
      ip += "ː"; return;
    }
    r += t.r;
    if (gem && t.t === "m") {
      const seg = /^(tɕ|dʑ|ts|dz|ɕ|ʑ|ɸ|.)/.exec(t.i)[0];
      ip += seg + "ː" + t.i.slice(seg.length); gem = false;
    } else ip += t.i;
  });
  ip = ip.replace(/oɯ/g, "oː").replace(/ei/g, "eː");   // オウ・エイ dibaca panjang
  return { romaji: r, ipa: ip };
}
module.exports = { convert, isKana, toKata };
