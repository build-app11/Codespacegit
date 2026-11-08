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

## Memori
Whisper di server dimuat ke RAM saat dipakai lalu dilepas setelah menganggur 90 detik (`MODEL_IDLE_SEC`, 0 = lepas segera). Mesin suara (Piper, Pocket, Supertonic) tidak memakai server sama sekali, jadi tidak ada Python atau model TTS yang perlu dipasang. `npm start` memakai `node --expose-gc` supaya memori Node ikut dikembalikan.

## Berita (RSS)
Menu **+ > Berita (RSS)**: tempel URL feed RSS 2.0, Atom, atau RSS 1.0, lalu tekan **Muat**. Alamat situs berita biasa (bukan alamat feed) juga boleh; feed-nya dicari otomatis lewat tag `<link rel="alternate">` di halaman itu. Daftar artikel menampilkan judul, waktu, sumber, dan cuplikan. Tombol **+ Library** mengambil isi lengkap artikel di server (Readability, sama seperti Web Link) dan menyimpannya ke Library, lalu bisa dibaca, diterjemahkan, dan diberi IPA seperti teks lain. Yang disimpan selalu isi lengkap, bukan ringkasan feed. Bila halaman artikel tidak bisa dimuat, dipakai isi penuh dari feed itu sendiri (`content:encoded`) kalau ada; kalau tidak ada, artikel tidak disimpan dan muncul pesan (biasanya artikel berbayar atau situs yang memblokir akses). Bila teks yang terambil pendek (di bawah 120 kata), ada catatan supaya kamu bisa memeriksa lewat tautan Sumber.

- **Simpan feed** menyimpan feed ke daftar chip di atas daftar artikel (maks. 20, ketuk untuk memuat, **×** untuk menghapus). Artikel yang sudah ditambahkan diberi tanda ✓ (menyimpan 300 tautan terakhir). Semuanya ada di localStorage dan ikut Ekspor/Impor Library.
- Maksimal 100 artikel per feed; ukuran feed maks. 10 MB, halaman artikel maks. 5 MB.
- **Hanya isi artikel.** Sebelum teks diambil, menu, iklan, kolom komentar, tombol bagikan, blok "Baca juga" / artikel terkait, dan tombol seperti "Baca selengkapnya" / "Load more" dibuang. Baris non-isi di dalam teks (keterangan foto, "Baca juga: …", "Advertisement", baris "Penulis: … | Editor: …") juga dibuang, dan judul bagian dibaca sebagai kalimat sendiri. Pembersihan ini ikut berlaku untuk Web Link dan file HTML (`article.js`). Kalau pembersihan membuang lebih dari ±65% teks, hasil Readability apa adanya yang dipakai.
- **Artikel yang terpotong.** Bagian yang disembunyikan di balik tombol "read more" (sudah ada di HTML, hanya disembunyikan) ikut diambil. Artikel yang dipecah ke beberapa halaman (`rel="next"`, "Halaman berikutnya", nomor halaman 1 2 3, atau "Lihat semua") dibaca sampai maks. 8 halaman dan maks. 45 detik; hanya halaman lanjutan dari artikel yang sama yang diikuti, bukan artikel berikutnya. Isi yang baru dimuat lewat JavaScript setelah tombol ditekan (AJAX) tidak bisa diambil karena server tidak menjalankan JavaScript halaman.
- Alamat jaringan privat ditolak, termasuk saat ada pengalihan. Artikel berbayar atau yang butuh login tidak didukung.
- Tidak butuh paket tambahan. `npm run news:test` menguji pembaca feed dan `npm run article:test` menguji pembersih artikel dan pembacaan multi-halaman, keduanya tanpa jaringan.

## Suara: semuanya berjalan di browser
Piper, Pocket TTS, dan Supertonic dijalankan **sepenuhnya di browser** lewat WebAssembly (onnxruntime-web). Server tidak punya endpoint TTS mesin, tidak butuh Python, dan tidak menyimpan model. Model diunduh browser langsung dari Hugging Face, disimpan di cache browser (Cache API/OPFS), lalu dipakai tanpa jaringan. Suara bawaan browser dan Microsoft Edge ("Online (Natural)") tetap lewat `speechSynthesis`. Butuh HTTPS atau localhost (Codespaces memenuhi). Bila sebuah mesin gagal, muncul pesan penyebabnya dan pemutaran berhenti; tidak ada pengalihan diam-diam ke server.

| Mesin | Bahasa | Ukuran | Catatan |
|---|---|---|---|
| Supertonic 3 | 31 bahasa (en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi) | fp32 ±400 MB, int8 ±111 MB | 10 suara (F1-F5, M1-M5) membaca semua bahasa. Pilih sumber model di baris pengaturan pemutar. |
| Piper | Semua bahasa di rhasspy/piper-voices (suara satu pembicara) | ±20-110 MB per suara | Daftar suara dimuat langsung dari browser. Di Unduh model: pilih bahasa, suara, atau unduh semua suara satu bahasa. |
| Pocket TTS | en, de, es, it, pt; fr, nl, ja dicari otomatis di Space Hugging Face yang sama | ±125-200 MB per bahasa | Suara yang dibawa paket bahasa masuk daftar suara. Bahasa tanpa paket: pakai Supertonic atau Piper. |

Dialog **Unduh model** mengunduh model lebih dulu (Pocket punya pilihan "Semua bahasa"). Model dan suara bawaan Pocket © Kyutai, CC-BY-4.0 (cantumkan atribusi bila dipublikasikan); bobot Supertonic berlisensi OpenRAIL-M. Suara klon (yang dulu hanya jalan di server) dihapus.

**Tanpa jeda antar kalimat:** hening di awal/akhir WAV dipangkas (`wavTrim`), tiga kalimat berikutnya dibuat lebih dulu, elemen audio berikutnya sudah dimuat, dan dimulai ±50 ms sebelum kalimat sekarang habis. Jeda masih bisa terdengar bila perangkat membuat audio lebih lambat dari durasi bicaranya; pilih Supertonic int8 atau Piper.

**Struktur teks dari file dan scan:** PDF, DOCX, EPUB, TXT/MD, tautan web, dan hasil Scan dokumen mempertahankan paragraf, judul bab, serta spasi dan tanda baca (`textfmt.js`). PDF hasil scan tetap perlu fitur Scan.

## Transkripsi podcast: Whisper di browser atau di server
Di dialog Podcast ada pilihan **Whisper di browser** (bawaan) dan **Whisper di server**.

- **Di browser**: model Whisper (`Xenova/whisper-tiny|base|small`, kuantisasi q8, sama dengan versi server) diunduh dari Hugging Face ke browser lewat Transformers.js lalu dijalankan di perangkat pengguna. Server hanya mengunduh audio dan men-decode-nya dengan ffmpeg ke PCM 16 kHz lewat `/api/podcast/pcm` (maks. 4 permintaan bersamaan), jadi masalah CORS audio podcast dan memori file panjang tidak muncul di browser. Jendela 30 detik, pemotongan di batas kalimat, penyaringan hening, dan pembuangan ulangan sama dengan versi server, sehingga hasilnya setara.
- **Pakai GPU (WebGPU)**: opsional, hanya muncul bila browser mendukung. Memakai model `onnx-community/whisper-*` (encoder fp32, decoder q4), jauh lebih cepat tetapi hasilnya bisa sedikit berbeda.
- **Di server**: cara lama (`/api/podcast/transcribe`), berguna bila perangkat pengguna terlalu lemah.
- Model diunduh sekali (tiny sekitar 40 MB, base 80 MB, small 250 MB; perkiraan) lalu disimpan di cache browser. Proses di browser memakai WASM, jadi di HP bisa lebih lambat daripada durasi audio; pilih Tiny atau aktifkan GPU.

## Supertonic di perangkat (tanpa server)
Kotak centang **Supertonic di perangkat** di baris pengaturan pemutar menjalankan Supertonic 3 sepenuhnya di browser, memakai pola yang sama dengan halaman `awalan.html`:

- **onnxruntime-web 1.22.0** (WASM/CPU) dimuat dari jsDelivr, lalu empat model ONNX (`duration_predictor`, `text_encoder`, `vector_estimator`, `vocoder`) dijalankan berurutan; `vector_estimator` diulang 8 langkah, lalu `vocoder` menghasilkan audio 44,1 kHz.
- Model diunduh browser **langsung dari Hugging Face** dan disimpan di Cache API (nama cache `supertonic3-assets-v1`), jadi unduhan hanya sekali. Server tidak dilibatkan dan teks tidak dikirim ke mana pun. Butuh HTTPS atau localhost (Codespaces memenuhi).
- Pilihan sumber model di samping kotak centang: **Resmi fp32** (±400 MB, kualitas penuh) atau **int8** (±111 MB, lebih ringan, mirror komunitas `safwan-o/supertonic-3-int8`).
- Seperti Pocket: saat dicentang muncul konfirmasi, lalu aplikasi **menguji dulu** (memuat model dan membuat satu kalimat). Bila gagal (memori habis, unduhan gagal, browser tidak mendukung), kotak centang dimatikan otomatis dan Supertonic kembali memakai server. Kegagalan di tengah pemakaian juga kembali ke server.
- Kalimat panjang dipecah per ±280 karakter, lalu audionya disambung. Kecepatan 1,05× dan 8 langkah, sama dengan versi server.
- Catatan perbaikan: kotak centang Piper di perangkat sebelumnya memakai id `ploc` yang bentrok dengan pilihan lokasi Whisper; sekarang id-nya `pipdev` (kunci penyimpanan `ploc` tidak berubah, jadi pilihan lama tetap terbaca).
- Belum ada WebGPU di mode ini (hanya WASM). Di HP dengan RAM kecil, pilih int8.
- Bila Supertonic di perangkat gagal di aplikasi: buka `/awalan.html` di alamat yang sama (halaman uji mandiri yang menjalankan model yang sama). Kalau di sana jalan tetapi di aplikasi tidak, kirim pesan di Console browser (F12); kalau di sana juga gagal, penyebabnya perangkat atau jaringan (RAM, akses ke huggingface.co/jsdelivr).
- Konfirmasi dialog `confirm()` sengaja tidak dipakai untuk Supertonic karena diblokir di panel pratinjau (Simple Browser) Codespaces; pakai tab browser biasa dari tab Ports.

