// Uji alur podcast tanpa model Whisper: parser RSS, unduh, decode ffmpeg, pemotongan jendela, pembatalan.
// Jalankan: npm run podcast:test   (butuh ffmpeg: dari ffmpeg-static atau terpasang di sistem)
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const p = require("./podcast");

let ffmpeg = "ffmpeg"; try { ffmpeg = require("ffmpeg-static") || "ffmpeg"; } catch (e) {}
const ok = (m) => console.log("ok  " + m);

// ASR tiruan: satu segmen tiap 10 detik, segmen terakhir "terpotong" di ujung jendela seperti Whisper sungguhan
let calls = 0;
const fakeAsr = async (f32, opt) => {
  calls++;
  const len = f32.length / 16000, chunks = [];
  for (let t = 0; t < len; t += 10) chunks.push({ text: " kalimat " + calls + "-" + chunks.length + " ", timestamp: [t, t + 10 >= len ? null : t + 10] });
  return { text: "", chunks, _opt: opt };
};

(async () => {
  // 1. Feed
  const feed = p.parseFeed(`<?xml version="1.0"?><rss xmlns:itunes="x"><channel>
    <title><![CDATA[Podcast & Teman]]></title><image><title>Logo</title></image>
    <item><title>Ep &amp; 2</title><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/a.mp3?x=1&amp;y=2" type="audio/mpeg" length="1"/></item>
    <item><title>Tanpa audio</title></item>
    <item><title><![CDATA[Ep 1 <b>baru</b>]]></title><itunes:duration>754</itunes:duration>
      <enclosure type='audio/mpeg' url='http://cdn.example.com/b.m4a'/></item>
    <item><title>Skema aneh</title><enclosure url="file:///etc/passwd" type="audio/mpeg"/></item>
  </channel></rss>`);
  assert.strictEqual(feed.title, "Podcast & Teman");
  assert.strictEqual(feed.episodes.length, 2);
  assert.deepStrictEqual(feed.episodes[0], { title: "Ep & 2", date: "2026-11-03", dur: 3723, audio: "https://cdn.example.com/a.mp3?x=1&y=2" });
  assert.strictEqual(feed.episodes[1].title, "Ep 1 baru");
  assert.strictEqual(feed.episodes[1].dur, 754);
  assert.throws(() => p.parseFeed("<html>bukan feed</html>"), /bukan feed RSS/);
  assert.throws(() => p.parseFeed("<rss><channel><title>x</title></channel></rss>"), /Tidak ada episode/);
  ok("parseFeed");

  // 2. Audio uji: 0-20 dtk nada, 20-65 hening, 65-85 nada
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "podtest-")), mp3 = path.join(dir, "t.mp3");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-filter_complex", "[1]atrim=0:45[s];[0][s][2]concat=n=3:v=0:a=1", "-ar", "16000", mp3]);

  // 3. Unduh lewat HTTP lalu batas ukuran
  const srv = http.createServer((q, r) => { const d = fs.readFileSync(mp3); r.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": d.length }); r.end(d); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + srv.address().port + "/t.mp3", saved = path.join(dir, "saved.bin");
  const n = await p.saveBody(await fetch(url), saved);
  assert.strictEqual(n, fs.statSync(mp3).size);
  await assert.rejects(p.saveBody(await fetch(url), path.join(dir, "big.bin"), { max: 1000 }), /terlalu besar/);
  ok("saveBody (" + n + " byte, batas ukuran)");

  // 4. Transkripsi penuh
  const segs = [], prog = [];
  const r1 = await p.transcribeFile(saved, { asr: fakeAsr, lang: "id", onSegment: (s) => segs.push(s), onProgress: (t) => prog.push(t) });
  assert.strictEqual(r1.aborted, false);
  assert.ok(segs.length >= 5, "segmen: " + segs.length);
  segs.forEach((s, i) => { assert.ok(s.e >= s.s); if (i) assert.ok(s.s >= segs[i - 1].e - 0.01, "tumpang tindih di " + i + ": " + JSON.stringify([segs[i - 1], s])); });
  assert.ok(segs[segs.length - 1].e <= 85.5, "melebihi durasi: " + segs[segs.length - 1].e);
  assert.ok(prog.every((v, i) => !i || v > prog[i - 1]) && prog[prog.length - 1] > 80, "progres: " + prog);
  assert.ok(!segs.some((s) => s.s >= 20 && s.s < 50), "jendela hening tidak boleh diberi teks: " + JSON.stringify(segs));
  ok("transcribeFile penuh: " + segs.length + " segmen, " + calls + " jendela ASR, progres " + prog.map((x) => x.toFixed(0)).join(">"));

  // 4b. Loop pengulangan dibuang mulai kali ketiga, pengulangan dua kali dipertahankan
  const loop = [], loopAsr = async (f32) => ({ chunks: [["Ya.", 0], ["Ya.", 2], ["Ya.", 4], ["Ya.", 6], ["Lanjut.", 8], ["Lanjut.", 9]].map(([text, a]) => ({ text, timestamp: [a, a + 1] })) });
  await p.transcribeFile(saved, { asr: loopAsr, start: 65, onSegment: (s) => loop.push(s.text) });
  assert.deepStrictEqual(loop, ["Ya.", "Ya.", "Lanjut.", "Lanjut."]);
  ok("filter pengulangan");

  // 5. Mulai dari detik ke-65
  const s2 = [];
  await p.transcribeFile(saved, { asr: fakeAsr, start: 65, onSegment: (s) => s2.push(s) });
  assert.ok(s2.length >= 2 && s2[0].s >= 65 && s2[0].s < 66, "start: " + JSON.stringify(s2[0]));
  ok("mulai dari 65 dtk (segmen pertama " + s2[0].s + ")");

  // 6. Pembatalan: ffmpeg harus berhenti dan tidak ada ASR lanjutan
  const ac = new AbortController(), s3 = []; let c3 = 0;
  const r3 = await p.transcribeFile(saved, { asr: async (...a) => { c3++; ac.abort(); return fakeAsr(...a); }, signal: ac.signal, onSegment: (s) => s3.push(s) });
  assert.strictEqual(r3.aborted, true); assert.strictEqual(c3, 1);
  ok("pembatalan");

  // 7. File rusak dan ffmpeg hilang
  fs.writeFileSync(path.join(dir, "rusak.bin"), "bukan audio");
  await assert.rejects(p.transcribeFile(path.join(dir, "rusak.bin"), { asr: fakeAsr, onSegment() {} }), /Audio tidak bisa dibaca/);
  ok("file rusak ditolak dengan pesan jelas");

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log("status:", JSON.stringify(await p.status()));
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
