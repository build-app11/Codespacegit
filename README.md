# Suara TTS (full-stack)
Sumber: Teks, File (txt, md, pdf, epub, docx, html), Scan dokumen (multi-foto, OCR), YouTube, Web Link.

    npm install
    npm start

Buka http://localhost:3000 (di Codespaces: tab Ports, port 3000).

## Bahasa utama (YouTube)
Di pembaca, video YouTube yang punya beberapa subtitle menampilkan pilihan **Bahasa utama**. Ini mengambil subtitle asli bahasa itu (bukan terjemahan mesin) dan suara bacaan ikut berpindah ke bahasa tersebut. Terjemahan tetap fitur terpisah (tombol 🌐), jadi tampilannya dual language.

## Fitur bahasa & sorotan

- **Bahasa utama untuk semua sumber** (teks, PDF, EPUB, DOCX, scan, web link, YouTube). Bahasa teks terdeteksi otomatis lewat `/api/detect`. Pilih bahasa lain di dropdown "Bahasa utama" dan teks dibaca dalam bahasa itu, dengan suara yang ikut berganti. Untuk YouTube, subtitle asli tetap ditawarkan lebih dulu; bahasa lain memakai terjemahan mesin.
- Terjemahan bahasa utama dikerjakan bertahap (15 kalimat per permintaan, 75 kalimat ke depan) dan tersimpan di memori selama sesi. Posisi baca dan progres tidak berubah karena penomoran kalimat mengikuti teks asli.
- **Baris terjemahan di bawah** selalu diterjemahkan dari teks asli, bukan dari bahasa utama, supaya tidak terjemah dua kali. Suaranya dipilih terpisah lewat dropdown suara terjemahan.
- **Sorotan per kata** saat membaca. Memakai event `boundary` dari text-to-speech; kalau suara tidak mengirim event itu, posisi kata diperkirakan dari waktu.

## YouTube
Pengambilan subtitle ada di `yt.js`: mencoba klien InnerTube (Android, iOS, TV embed, Web), lalu halaman watch, lalu library `youtube-transcript` sebagai cadangan. Kalau gagal, pesan error menyebut alasan sebenarnya. Jika YouTube memblokir IP server (umum di Codespaces/cloud), jalankan di komputer sendiri atau set `YT_COOKIE` (string cookie akun YouTube) sebelum `npm start`.
