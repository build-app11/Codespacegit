# Suara TTS (full-stack)
Sumber: Teks, File (txt, md, pdf, epub, docx, html), Scan dokumen (kamera langsung atau galeri, OCR), Web Link, Berita (RSS), Podcast (RSS).

    npm install
    npm start

Buka http://localhost:3000 (di Codespaces: tab Ports, port 3000).

## Bahasa utama, terjemahan, dan sorotan

- **Bahasa utama untuk semua sumber** (teks, PDF, EPUB, DOCX, scan, web link). Bahasa teks terdeteksi otomatis lewat `/api/detect`. Pilih bahasa lain di dropdown "Bahasa utama" dan teks dibaca dalam bahasa itu, dengan suara yang ikut berganti.
- Terjemahan bahasa utama dikerjakan bertahap (15 kalimat per permintaan, 75 kalimat ke depan) dan tersimpan di memori selama sesi. Posisi baca dan progres tidak berubah karena penomoran kalimat mengikuti teks asli.
- **Baris terjemahan di bawah** selalu diterjemahkan dari teks asli, bukan dari bahasa utama, supaya tidak terjemah dua kali. Suaranya dipilih terpisah lewat dropdown suara terjemahan.
- **Sorotan per kata** saat membaca. Memakai event `boundary` dari text-to-speech; kalau suara tidak mengirim event itu, posisi kata diperkirakan dari waktu.


## IPA dan romanisasi (lokal)
Di bawah **setiap kata** pada teks utama ada **romanisasi** (aksara non-Latin) dan **IPA** kecil, seperti teks interlinear; bisa dimatikan lewat kotak centang di pembaca. Jepang dibagi per kata (morfem kuromoji), Mandarin per aksara, bahasa lain per kata menurut `Intl.Segmenter`. Mengetuk kata (atau anotasinya) membuka popup arti. Kalimat utuh dikirim ke espeak-ng lebih dulu supaya IPA kata sadar konteks; bila jumlah katanya tidak cocok, tiap kata diproses sendiri. Semuanya dihitung di server dengan library, tanpa Wiktionary atau Google Translate:

| Bahasa | Romanisasi | IPA |
|---|---|---|
| Jepang | kuromoji (baca kanji) + tabel Hepburn (`kana.js`) | kuromoji + tabel kana (`kana.js`) |
| Mandarin | pinyin-pro | pinyin-pro + tabel (`pinyinipa.js`), nada dengan huruf Chao |
| Korea | tabel Revised Romanization (`hangul.js`) | espeak-ng |
| Rusia, Yunani, Arab, Ibrani, Hindi, Thai, dll. | any-ascii | espeak-ng |
| Bahasa beraksara Latin | - | espeak-ng |

espeak-ng dipakai lewat paket `phonemizer` (WebAssembly). Paket opsional (`optionalDependencies`): kalau salah satu gagal terpasang, aplikasi tetap jalan dan hanya bagian itu yang kosong. Cek status dengan melihat log saat `npm start` atau buka `/api/phon/status`, dan lihat contoh hasil dengan `npm run phon:test`.

Catatan: kuromoji memuat kamus (~17 MB) sekali saat server start. Romanisasi Arab/Ibrani tanpa tanda vokal hanya berisi konsonan, dan Hindi/Thai lewat any-ascii hanya perkiraan.


## Scan dokumen lewat kamera
Menu **Scan dokumen** membuka kamera langsung di halaman (butuh HTTPS atau localhost, dan izin kamera). Ambil satu atau beberapa halaman, pilih bahasa teks, lalu OCR (tesseract.js) berjalan di browser. Tombol **Galeri** tetap tersedia, dan bila kamera tidak bisa dibuka, tombol foto memakai kamera bawaan perangkat.

## Unduh audio
Tombol ⬇ di pembaca mengunduh MP3 untuk kalimat ini, bagian ini, dari sini sampai akhir, atau seluruh teks (maks. 30.000 karakter per unduhan). Audio dibuat oleh server lewat endpoint suara Google Translate (tidak resmi, bisa dibatasi sewaktu-waktu), jadi suaranya bukan suara perangkat yang dipilih di pemutar. Bila bahasa utama berupa terjemahan mesin, teksnya diterjemahkan dulu.

## Hapus semua data
Di bawah daftar Library ada ringkasan penyimpanan dan tombol **Hapus semua data**: menghapus IndexedDB (teks, termasuk data bahasa OCR), localStorage/sessionStorage (progres, pengaturan, pilihan suara), Cache Storage, dan service worker, lalu memuat ulang halaman. Server tidak menyimpan data pengguna.


## Ekspor dan impor Library
Di bawah daftar Library ada tombol **Ekspor** dan **Impor**. Ekspor menyimpan semua teks, progres baca, dan pengaturan ke satu file `suara-backup-TANGGAL.json`; ini cara memindahkan Library ke perangkat lain atau mencadangkannya sebelum **Hapus semua data**. Impor bersifat menambah, bukan menimpa: teks yang sama persis (judul dan isi) dilewati, teks dengan id yang bentrok diberi id baru, progres teks yang diimpor ikut dipulihkan, dan pengaturan hanya diisi bila belum ada di perangkat ini. File dengan format lain (bukan hasil ekspor) ditolak. Teks tunggal bisa diimpor lewat menu + (File) seperti biasa.

## Podcast (RSS) ke teks
Menu **+ > Podcast (RSS) → teks**: tempel URL RSS podcast (atau link langsung ke file `.mp3`/`.m4a`), tekan **Muat**, pilih episode, putar audionya, lalu **Mulai transkripsi**. Teks muncul bertahap, tiap baris bertanda waktu; baris yang sedang diputar disorot, dan mengetuk baris melompat ke bagian itu di audio. Kotak **Mulai dari posisi putar** membuat transkripsi dimulai dari detik audio yang sedang diputar. Hasilnya bisa disimpan lewat **Simpan** ke Library (lalu dibaca, diterjemahkan, dan diberi IPA seperti teks lain) atau diunduh sebagai TXT / SRT.

Cara kerja: server mengunduh audio ke file sementara (maks. 400 MB, dihapus setelah selesai), ffmpeg mengubahnya ke 16 kHz mono, lalu model **Whisper** (`@huggingface/transformers`, jalan lokal di server, tanpa API key) memprosesnya per jendela 30 detik. Jendela yang berakhir di tengah kalimat dipotong di batas segmen terakhir yang utuh supaya kata tidak terpotong, dan jendela yang sepenuhnya hening dilewati.

- Model: **tiny** (cepat), **base** (seimbang), **small** (akurat). Diunduh dari Hugging Face sekali saja lalu disimpan di folder `models/` (kira-kira 40, 80, dan 250 MB). Pemakaian pertama jadi lebih lama.
- Berjalan di CPU server, jadi kecepatannya tergantung mesin (belum diukur di Codespaces). Model yang lebih besar lebih akurat tetapi lebih lambat; mulai dari `base`, turun ke `tiny` bila terlalu lambat atau naik ke `small` bila hasilnya kurang akurat. Pilih bahasa audio secara manual bila deteksi otomatis keliru.
- Satu transkripsi dalam satu waktu. Menutup dialog atau menekan **Batalkan** menghentikan proses di server.
- `ffmpeg-static` dan `@huggingface/transformers` adalah `optionalDependencies`; bila gagal terpasang, fitur lain tetap jalan. Cek di `/api/podcast/status`. `npm run podcast:test` menguji pembaca RSS, unduhan, decode, dan pemotongan jendela dengan ASR tiruan (tanpa model).
- Podcast berbayar atau yang butuh login tidak didukung. Alamat jaringan privat ditolak.

## Hemat RAM: model dilepas saat menganggur
Pocket TTS dan Supertonic (proses Python) dan Whisper (di server) dimuat ke RAM saat dipakai, lalu **dilepas otomatis** setelah menganggur 90 detik; dimuat lagi sendiri saat dipakai berikutnya (pemakaian pertama setelah dilepas sedikit lebih lama). Atur lewat variabel `MODEL_IDLE_SEC`, misalnya `MODEL_IDLE_SEC=30 npm start` (0 = lepas segera setelah selesai). Piper tidak perlu diatur karena prosesnya berhenti sendiri setelah tiap kalimat. `npm start` memakai `node --expose-gc` supaya memori Node ikut dikembalikan setelah Whisper dilepas.

## Berita (RSS)
Menu **+ > Berita (RSS)**: tempel URL feed RSS 2.0, Atom, atau RSS 1.0, lalu tekan **Muat**. Alamat situs berita biasa (bukan alamat feed) juga boleh; feed-nya dicari otomatis lewat tag `<link rel="alternate">` di halaman itu. Daftar artikel menampilkan judul, waktu, sumber, dan cuplikan. Tombol **+ Library** mengambil isi lengkap artikel di server (Readability, sama seperti Web Link) dan menyimpannya ke Library, lalu bisa dibaca, diterjemahkan, dan diberi IPA seperti teks lain. Yang disimpan selalu isi lengkap, bukan ringkasan feed. Bila halaman artikel tidak bisa dimuat, dipakai isi penuh dari feed itu sendiri (`content:encoded`) kalau ada; kalau tidak ada, artikel tidak disimpan dan muncul pesan (biasanya artikel berbayar atau situs yang memblokir akses). Bila teks yang terambil pendek (di bawah 120 kata), ada catatan supaya kamu bisa memeriksa lewat tautan Sumber.

- **Simpan feed** menyimpan feed ke daftar chip di atas daftar artikel (maks. 20, ketuk untuk memuat, **×** untuk menghapus). Artikel yang sudah ditambahkan diberi tanda ✓ (menyimpan 300 tautan terakhir). Semuanya ada di localStorage dan ikut Ekspor/Impor Library.
- Maksimal 100 artikel per feed; ukuran feed maks. 10 MB, halaman artikel maks. 5 MB.
- **Hanya isi artikel.** Sebelum teks diambil, menu, iklan, kolom komentar, tombol bagikan, blok "Baca juga" / artikel terkait, dan tombol seperti "Baca selengkapnya" / "Load more" dibuang. Baris non-isi di dalam teks (keterangan foto, "Baca juga: …", "Advertisement", baris "Penulis: … | Editor: …") juga dibuang, dan judul bagian dibaca sebagai kalimat sendiri. Pembersihan ini ikut berlaku untuk Web Link dan file HTML (`article.js`). Kalau pembersihan membuang lebih dari ±65% teks, hasil Readability apa adanya yang dipakai.
- **Artikel yang terpotong.** Bagian yang disembunyikan di balik tombol "read more" (sudah ada di HTML, hanya disembunyikan) ikut diambil. Artikel yang dipecah ke beberapa halaman (`rel="next"`, "Halaman berikutnya", nomor halaman 1 2 3, atau "Lihat semua") dibaca sampai maks. 8 halaman dan maks. 45 detik; hanya halaman lanjutan dari artikel yang sama yang diikuti, bukan artikel berikutnya. Isi yang baru dimuat lewat JavaScript setelah tombol ditekan (AJAX) tidak bisa diambil karena server tidak menjalankan JavaScript halaman.
- Alamat jaringan privat ditolak, termasuk saat ada pengalihan. Artikel berbayar atau yang butuh login tidak didukung.
- Tidak butuh paket tambahan. `npm run news:test` menguji pembaca feed dan `npm run article:test` menguji pembersih artikel dan pembacaan multi-halaman, keduanya tanpa jaringan.

## Suara: Edge, Piper, Pocket, Supertonic, dan Google
Mesin suara yang tersedia sekarang **Piper**, **Pocket TTS**, dan **Supertonic** (Kokoro, Kitten, Chatterbox, XTTS v2, dan VibeVoice sudah dihapus). Piper dan Pocket bisa berjalan **di server** (`engines.js`, bawaan) atau **di perangkat pengguna** (kotak centang, lihat "Mode di perangkat" di bawah); Supertonic saat ini hanya di server. Di mode server, browser hanya mengirim teks ke `/api/tts/engine` dan memutar WAV hasilnya; model dimuat sekali dan tetap di memori server. Suara bawaan browser dan Microsoft Edge ("Online (Natural)") tetap lewat `speechSynthesis`.

Yang perlu dipasang di server (untuk mode server):

| Mesin | Pemasangan | Catatan |
|---|---|---|
| Piper | `pip install piper-tts` (atau taruh binary `piper` di PATH; atur lewat `PIPER_BIN`) | Suara (.onnx) diunduh otomatis dari Hugging Face ke `models/piper/`. |
| Pocket TTS | `pip install pocket-tts` (Python 3.10+, PyTorch 2.5+ versi CPU cukup; `pip install -U pocket-tts` untuk bahasa selain Inggris) | Mesin Kyutai ±100M parameter, jalan di CPU. 8 suara bawaan Inggris (alba, marius, javert, jean, fantine, cosette, eponine, azelma) plus juergen (de), estelle (fr), lola (es), giovanni (it), rafael (pt). Model dari Hugging Face `kyutai/pocket-tts` dan bisa meminta login/persetujuan lisensi: kalau unduhan gagal, buat token di huggingface.co lalu jalankan `HF_TOKEN=... npm start`. Dijalankan lewat `pocket_worker.py`. |
| Supertonic | `pip install supertonic` (Python 3.9+, CPU saja) | Mesin Supertone ±99M parameter, 44,1 kHz, 31 bahasa (termasuk **Indonesia**). 10 suara bawaan: F1-F5 (perempuan) dan M1-M5 (laki-laki), semuanya bisa membaca semua bahasa. Model ±400 MB diunduh otomatis saat pertama dipakai ke `~/.cache/supertonic3/` (bukan ke folder `models/`). Dijalankan lewat `supertonic_worker.py`. |

Pocket tidak mendukung bahasa Indonesia; untuk teks Indonesia pakai Supertonic, Piper (`id_ID-news_tts-medium`), Edge, atau suara bawaan browser.

**Supertonic:** semua suara (F1-F5, M1-M5) ada di daftar suara sebagai "Supertonic · F1 (multibahasa)" dan cocok dengan bahasa utama apa pun yang didukung, jadi suara ikut berganti bahasa mengikuti bahasa utama. Bahasa yang didukung: en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi. Bahasa di luar daftar (mis. Mandarin dan Ibrani) tidak ditawarkan otomatis; kalau suara Supertonic tetap dipilih manual untuk bahasa itu, teks dikirim dengan kode `na` (tanpa bahasa tertentu) dan hasilnya tidak terjamin. Bila teks terjemahan ikut dibaca, bahasanya mengikuti bahasa terjemahan, bukan bahasa utama.

- Kualitas diatur lewat `SUPERTONIC_STEPS` (jumlah langkah inferensi, bawaan 8; 5 = cepat, 12 = terbaik), misalnya `SUPERTONIC_STEPS=5 npm start`.
- Seperti Pocket, proses Python Supertonic dilepas dari RAM setelah menganggur (`MODEL_IDLE_SEC`).
- Dialog **Unduh model** punya baris Supertonic untuk mengunduh model lebih dulu. Status "✓ sudah di server" dibaca dari ada tidaknya berkas `.onnx` di `~/.cache/supertonic3/`.
- Bila unduhan otomatis gagal (jaringan atau lokasi repositori model berubah), unduh model Supertonic 3 secara manual dari Hugging Face dan taruh isinya (folder `onnx/` dan `voice_styles/`) di `~/.cache/supertonic3/`.
- Kode paket dilisensikan MIT; bobot modelnya memakai lisensi OpenRAIL-M, jadi baca ketentuannya sebelum aplikasi dipublikasikan.
- Belum ada mode "di perangkat" (browser) untuk Supertonic.

**Struktur teks dari file dan scan:** PDF, DOCX, EPUB, TXT/MD, tautan web, dan hasil Scan dokumen sekarang mempertahankan paragraf, judul bab, serta spasi dan tanda baca (`textfmt.js`). EPUB dibaca urut dari halaman sampul (judul dan penulis ditulis di awal) sampai bab terakhir. PDF: paragraf dideteksi dari jarak antarbaris, indentasi, dan ukuran huruf; nomor halaman dan header/footer berulang dibuang; kalimat yang terpotong di pergantian halaman disambung. Di pembaca, paragraf diberi jarak dan judul ditebalkan. PDF hasil scan (tanpa teks) tetap perlu fitur Scan. Teks lama di Library tidak berubah; unggah ulang filenya untuk mendapat paragraf.

**Suara klon (Pocket TTS):** di dialog "Unduh model suara" ada bagian "Suara saya". Pilih sampel 10-30 detik (browser mengubahnya jadi WAV mono 24 kHz), beri nama, lalu "Tambah". Sampel disimpan di `models/clones/` dan suaranya muncul di daftar suara sebagai "Clone · nama (Pocket)". Hanya untuk suara milik sendiri atau yang sudah memberi izin. Pilih bahasa sampel (en/de/fr/es/it/pt) saat menambah klon; suara dibaca dengan model Pocket bahasa itu (perlu `pip install -U pocket-tts` v2+, bobot tiap bahasa diunduh terpisah; Prancis hanya tersedia `french_24l` yang lebih berat). Suara klon **selalu diproses di server**, meskipun "Pocket di perangkat" dicentang. Klon lama milik Chatterbox/XTTS yang masih ada di `models/clones/` tidak ditampilkan lagi (berkasnya tidak dihapus otomatis).

**Penyimpanan model:** model disimpan di folder `models/` pada disk server, jadi tetap ada setelah aplikasi ditutup atau server di-restart (jangan commit folder ini ke git). Di daftar suara, suara yang modelnya sudah terpasang diurutkan di atas.

**Mode di perangkat (Piper dan Pocket):** di baris pengaturan pemutar ada dua kotak centang, "Piper di perangkat" dan "Pocket di perangkat". Bawaan: mati (jalan di server), supaya pengguna data seluler tidak mengunduh ratusan MB tanpa sadar.

- **Piper di perangkat** (WASM, ±20-110 MB per suara, disimpan di cache browser). Kalau gagal, otomatis kembali ke server.
- **Pocket di perangkat** (WASM lewat paket npm [`pocket-tts-js`](https://github.com/vlapky/pocket-tts-js), onnxruntime-web di Web Worker, model INT8 ±125-200 MB per bahasa dari Hugging Face, disimpan di cache browser). Alurnya:
  1. Saat dicentang muncul konfirmasi (ukuran unduhan, kebutuhan RAM, bahasa yang tersedia). Setelah disetujui, aplikasi **menguji dulu di perangkat**: memuat model dan membuat satu kalimat pendek.
  2. Bila uji **berhasil**, muncul peringatan hijau "✅ Berhasil: Pocket dijalankan di perangkat ini", status di samping kotak centang menjadi "Pocket: ✅ berjalan di perangkat", dan kalimat berikutnya dibuat di perangkat (server tidak dipakai).
  3. Bila uji **gagal** (browser tidak mendukung WebAssembly/Web Worker, memori habis, unduhan gagal, paket belum terpasang di server, dsb.), muncul peringatan "⚠️ Pocket gagal dijalankan di perangkat ini (alasan). Dikembalikan ke server", kotak centang **dimatikan otomatis**, dan Pocket kembali memakai server. Hal yang sama terjadi bila kegagalan baru muncul di tengah pemakaian.
  4. Yang otomatis tetap di server tanpa mematikan centang: suara klon, bahasa yang belum punya bundel di perangkat (Belanda dan Jepang), dan suara yang tidak ada di bundel bahasa itu (mis. suara `alba` dengan teks Spanyol; bundel Spanyol hanya punya `lola`).
  - Bundel perangkat tersedia untuk Inggris, Jerman, Spanyol, Italia, Portugis, dan Prancis. Server hanya menyajikan berkas paketnya (`/vendor/pocket-tts-js/`, harus satu origin karena browser menolak Web Worker dari CDN); model diunduh browser langsung dari Hugging Face.
  - Pasang paketnya di server: `npm install pocket-tts-js` (sudah ada di `optionalDependencies`). Bila belum terpasang, centang akan gagal dengan pesan yang jelas lalu kembali ke server. Setelah terpasang dan berjalan baik, sebaiknya kunci versinya di `package.json` (sekarang `*`).
  - Tanpa header `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`, onnxruntime-web berjalan satu thread (lebih lambat tapi tetap jalan). Header itu sengaja tidak dipasang global karena dapat memblokir gambar/sumber lintas-origin lain di aplikasi ini.
  - Model dan suara bawaan Pocket © Kyutai, lisensi CC-BY-4.0 (wajib mencantumkan atribusi bila aplikasi dipublikasikan). Paket `pocket-tts-js` berlisensi MIT.

Sorotan kata untuk mesin ini diperkirakan dari posisi audio. Tombol unduh MP3 tetap memakai endpoint Google Translate di server.

## Transkripsi podcast: Whisper di browser atau di server
Di dialog Podcast ada pilihan **Whisper di browser** (bawaan) dan **Whisper di server**.

- **Di browser**: model Whisper (`Xenova/whisper-tiny|base|small`, kuantisasi q8, sama dengan versi server) diunduh dari Hugging Face ke browser lewat Transformers.js lalu dijalankan di perangkat pengguna. Server hanya mengunduh audio dan men-decode-nya dengan ffmpeg ke PCM 16 kHz lewat `/api/podcast/pcm` (maks. 4 permintaan bersamaan), jadi masalah CORS audio podcast dan memori file panjang tidak muncul di browser. Jendela 30 detik, pemotongan di batas kalimat, penyaringan hening, dan pembuangan ulangan sama dengan versi server, sehingga hasilnya setara.
- **Pakai GPU (WebGPU)**: opsional, hanya muncul bila browser mendukung. Memakai model `onnx-community/whisper-*` (encoder fp32, decoder q4), jauh lebih cepat tetapi hasilnya bisa sedikit berbeda.
- **Di server**: cara lama (`/api/podcast/transcribe`), berguna bila perangkat pengguna terlalu lemah.
- Model diunduh sekali (tiny sekitar 40 MB, base 80 MB, small 250 MB; perkiraan) lalu disimpan di cache browser. Proses di browser memakai WASM, jadi di HP bisa lebih lambat daripada durasi audio; pilih Tiny atau aktifkan GPU.
