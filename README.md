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

## Berita (RSS)
Menu **+ > Berita (RSS)**: tempel URL feed RSS 2.0, Atom, atau RSS 1.0, lalu tekan **Muat**. Alamat situs berita biasa (bukan alamat feed) juga boleh; feed-nya dicari otomatis lewat tag `<link rel="alternate">` di halaman itu. Daftar artikel menampilkan judul, waktu, sumber, dan cuplikan. Tombol **+ Library** mengambil isi lengkap artikel di server (Readability, sama seperti Web Link) dan menyimpannya ke Library, lalu bisa dibaca, diterjemahkan, dan diberi IPA seperti teks lain. Bila halaman artikel tidak bisa dimuat (atau isinya lebih pendek dari ringkasan di feed), yang disimpan adalah ringkasan dari feed.

- **Simpan feed** menyimpan feed ke daftar chip di atas daftar artikel (maks. 20, ketuk untuk memuat, **×** untuk menghapus). Artikel yang sudah ditambahkan diberi tanda ✓ (menyimpan 300 tautan terakhir). Semuanya ada di localStorage dan ikut Ekspor/Impor Library.
- Maksimal 100 artikel per feed; ukuran feed maks. 10 MB, halaman artikel maks. 5 MB.
- Alamat jaringan privat ditolak, termasuk saat ada pengalihan. Artikel berbayar atau yang butuh login tidak didukung.
- Tidak butuh paket tambahan. `npm run news:test` menguji pembaca feed tanpa jaringan.
