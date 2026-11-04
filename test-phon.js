// Jalankan: npm run phon:test  (setelah npm install). Menampilkan mesin yang aktif dan contoh hasil per bahasa.
const phon = require("./phon");
const samples = [
  ["en", "Hello, this is a pronunciation test."], ["de", "Das ist ein schöner Tag."], ["fr", "Bonjour tout le monde."],
  ["es", "¿Cómo estás hoy?"], ["id", "Selamat pagi, apa kabar?"], ["ru", "Привет, как дела?"],
  ["ja", "今日は天気がいいですね。"], ["zh-CN", "你好，今天天气很好。"], ["ko", "안녕하세요, 감사합니다."],
  ["ar", "مرحبا بالعالم"], ["hi", "नमस्ते दुनिया"], ["th", "สวัสดีครับ"],
];
(async () => {
  console.log("Status mesin:", JSON.stringify(await phon.status(), null, 2), "\n");
  for (const [l, t] of samples) {
    const r = await phon.analyze(t, l);
    console.log(`[${l}] ${t}\n   romanisasi: ${r.rm || "-"}\n   IPA       : ${r.ip ? "/" + r.ip + "/" : "-"}\n`);
  }
  process.exit(0);
})();
