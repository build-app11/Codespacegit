// Romanisasi Hangul (Revised Romanization, versi ringkas: liaison, nasalisasi, ㄴ+ㄹ). Murni tabel.
const INI = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const MED = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
// koda: [dilafalkan bila di akhir/ sebelum konsonan, dibawa ke suku berikut bila suku berikut diawali ㅇ, kelas]
const FIN = [["", "", ""], ["k", "g", "v"], ["k", "kk", "v"], ["k", "ks", "v"], ["n", "n", "d"], ["n", "nj", "d"], ["n", "nh", "d"], ["t", "d", "d"],
  ["l", "r", "l"], ["k", "lg", "v"], ["m", "lm", "m"], ["l", "lb", "l"], ["l", "ls", "l"], ["l", "lt", "l"], ["p", "lp", "b"], ["l", "lh", "l"],
  ["m", "m", "m"], ["p", "b", "b"], ["p", "bs", "b"], ["t", "s", "d"], ["t", "ss", "d"], ["ng", "ng", "n"], ["t", "j", "d"], ["t", "ch", "d"],
  ["k", "k", "v"], ["t", "t", "d"], ["p", "p", "b"], ["t", "", "d"]];
// bagian koda yang tetap bila sebagian dibawa (kluster)
const KEEP = { 3: "k", 5: "n", 6: "n", 9: "l", 10: "l", 11: "l", 12: "l", 13: "l", 14: "l", 15: "l", 18: "p" };

function run(run) {
  const syl = [...run].map((ch) => { const c = ch.charCodeAt(0) - 0xAC00; return { i: Math.floor(c / 588), m: Math.floor((c % 588) / 28), f: c % 28 }; });
  let out = "";
  syl.forEach((s, x) => {
    const nx = syl[x + 1];
    let ini = INI[s.i], coda = FIN[s.f][0];
    if (x > 0 && syl[x - 1].carry !== undefined) ini = syl[x - 1].carry;  // liaison dari suku sebelumnya
    s.carry = undefined;
    if (s.f && nx) {
      if (nx.i === 11) {                                                  // diikuti ㅇ: koda pindah
        const carry = FIN[s.f][1];
        if (s.f === 21) coda = "ng";
        else if (KEEP[s.f]) { coda = KEEP[s.f]; s.carry = carry.slice(KEEP[s.f].length) ; }
        else { coda = ""; s.carry = carry; }
      } else if (nx.i === 2 || nx.i === 6) {                              // diikuti ㄴ/ㅁ: nasalisasi
        const k = FIN[s.f][2]; if (k === "v") coda = "ng"; else if (k === "d") coda = "n"; else if (k === "b") coda = "m";
      } else if (nx.i === 5 && (FIN[s.f][2] === "l" || s.f === 4)) { coda = "l"; syl[x + 1].ini2 = "l"; }  // ㄴ/ㄹ + ㄹ
    }
    if (s.ini2) ini = s.ini2;
    out += ini + MED[s.m] + coda;
  });
  return out;
}
function romanize(text) { return String(text).replace(/[\uAC00-\uD7A3]+/g, (m) => run(m)); }
module.exports = { romanize };
