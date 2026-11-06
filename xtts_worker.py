# Pekerja XTTS v2 (Coqui): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang: pip install coqui-tts   (fork yang masih dirawat; paket "TTS" lama tidak cocok dengan Python 3.12+)
# LISENSI: bobot XTTS v2 memakai Coqui Public Model License (CPML, hanya non-komersial).
# Model baru mau dimuat bila Anda sendiri sudah membaca lisensinya lalu mengatur  COQUI_TOS_AGREED=1  di lingkungan server.
# Atur perangkat lewat XTTS_DEVICE (cuda / cpu). Bawaan: cuda bila ada.
import worker_util as U
import os

# kode bahasa aplikasi -> kode XTTS
XLANGS = {"en": "en", "es": "es", "fr": "fr", "de": "de", "it": "it", "pt": "pt", "pl": "pl", "tr": "tr", "ru": "ru",
          "nl": "nl", "cs": "cs", "ar": "ar", "zh": "zh-cn", "hu": "hu", "ko": "ko", "ja": "ja", "hi": "hi"}
# batas karakter per potongan menurut XTTS (lewat dari ini suara terpotong/berantakan)
LIMIT = {"en": 250, "es": 239, "fr": 273, "de": 253, "it": 213, "pt": 203, "pl": 224, "tr": 226, "ru": 182, "nl": 251,
         "cs": 186, "ar": 166, "zh-cn": 82, "hu": 224, "ko": 95, "ja": 71, "hi": 150}
tts = None


def get_tts():
    global tts
    if tts is None:
        if os.environ.get("COQUI_TOS_AGREED") != "1":
            raise RuntimeError("XTTS v2 berlisensi CPML (non-komersial). Baca lisensinya di https://coqui.ai/cpml lalu jalankan server dengan COQUI_TOS_AGREED=1 bila Anda setuju.")
        import torch
        from TTS.api import TTS
        dev = os.environ.get("XTTS_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(dev)
    return tts


def norm(lang):
    l = str(lang or "en").lower().replace("_", "-").split("-")[0]
    if l not in XLANGS:
        raise ValueError("Bahasa '%s' belum didukung XTTS v2 (tersedia: %s)" % (l, ", ".join(sorted(XLANGS))))
    return XLANGS[l]


def handle(m):
    t = get_tts()
    if m.get("preload"):
        return {"ok": True}
    lang = norm(m.get("lang"))
    kw = {"language": lang, "split_sentences": False}
    if m.get("ref"):
        kw["speaker_wav"] = m["ref"]
    else:
        name = str(m.get("voice") or "").replace("_", " ")
        known = list(getattr(t, "speakers", None) or [])
        if known and name not in known:
            raise ValueError("Pembicara XTTS '%s' tidak dikenal" % name)
        kw["speaker"] = name
    parts = [U.to_array(t.tts(text=c, **kw)) for c in U.chunk_text(m["text"], LIMIT.get(lang, 200))]
    if not parts:
        raise ValueError("Teks kosong")
    sr = 24000
    try:
        sr = int(t.synthesizer.output_sample_rate)
    except Exception:
        pass
    return {"wav": U.wav_b64(U.join_audio(parts, sr), sr)}


U.serve(handle)
