// Pinyin bernomor nada (ni3, hao3) -> IPA Mandarin (perkiraan fonemis, nada dengan huruf Chao).
const INIT = { b: "p", p: "pʰ", m: "m", f: "f", d: "t", t: "tʰ", n: "n", l: "l", g: "k", k: "kʰ", h: "x", j: "tɕ", q: "tɕʰ", x: "ɕ",
  zh: "ʈʂ", ch: "ʈʂʰ", sh: "ʂ", r: "ɻ", z: "ts", c: "tsʰ", s: "s" };
const FIN = { a: "ɑ", o: "wo", e: "ɤ", ai: "aɪ̯", ei: "eɪ̯", ao: "ɑʊ̯", ou: "oʊ̯", an: "an", en: "ən", ang: "ɑŋ", eng: "ɤŋ", ong: "ʊŋ", er: "ɚ",
  i: "i", ia: "ja", ie: "jɛ", iao: "jɑʊ̯", iu: "joʊ̯", iou: "joʊ̯", ian: "jɛn", in: "in", iang: "jɑŋ", ing: "iŋ", iong: "jʊŋ",
  u: "u", ua: "wa", uo: "wo", uai: "waɪ̯", ui: "weɪ̯", uei: "weɪ̯", uan: "wan", un: "wən", uen: "wən", uang: "wɑŋ", ueng: "wɤŋ",
  "ü": "y", "üe": "ɥɛ", "üan": "ɥɛn", "ün": "yn" };
const TONE = { 1: "˥", 2: "˧˥", 3: "˨˩˦", 4: "˥˩" };

function pinyinToIpa(syl) {
  let s = String(syl).toLowerCase().replace(/v/g, "ü").replace(/u:/g, "ü");
  const m = /^([a-zü]+?)([0-5])?$/.exec(s);
  if (!m) return null;
  s = m[1]; const tone = m[2] || "";
  // penulisan y- dan w-
  if (/^y/.test(s)) {
    if (/^yu/.test(s)) s = "ü" + s.slice(2);          // yu, yue, yuan, yun
    else if (s === "yi" || s === "yin" || s === "ying") s = s.slice(1);
    else s = "i" + s.slice(1);                         // ya, ye, yao, you, yan, yang, yong
  } else if (/^w/.test(s)) {
    s = s === "wu" ? "u" : "u" + s.slice(1);           // wa, wo, wai, wei, wan, wen, wang, weng
  }
  let ini = "", fin = s;
  const two = s.slice(0, 2);
  if (INIT[two] && ["zh", "ch", "sh"].includes(two)) { ini = two; fin = s.slice(2); }
  else if (INIT[s[0]] && s.length > 0 && !"aoeiuü".includes(s[0])) { ini = s[0]; fin = s.slice(1); }
  if ("jqx".includes(ini) && ini) fin = fin.replace(/^u/, "ü");       // ju, qu, xu, juan, jun
  let f = FIN[fin];
  if (fin === "i" && ini) { if ("zcs".includes(ini)) f = "ɨ"; else if (["zh", "ch", "sh", "r"].includes(ini)) f = "ɻ̩"; }
  if (!f) return null;
  return (ini ? INIT[ini] : "") + f + (TONE[tone] || "");
}
module.exports = { pinyinToIpa };
