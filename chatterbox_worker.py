# Pekerja Chatterbox (Resemble AI, lisensi MIT): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang: pip install chatterbox-tts   (Python 3.10/3.11, PyTorch; GPU sangat disarankan, CPU lambat)
# Model Inggris (ChatterboxTTS) dipakai untuk "en"; bahasa lain memakai ChatterboxMultilingualTTS (23 bahasa).
# Atur perangkat lewat CHATTERBOX_DEVICE (cuda / cpu / mps). Bawaan: cuda bila ada, selain itu cpu.
import worker_util as U
import os

LANGS = ["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"]
EXAGGERATION = float(os.environ.get("CHATTERBOX_EXAGGERATION", "0.5"))
CFG_WEIGHT = float(os.environ.get("CHATTERBOX_CFG", "0.5"))
MAXCHARS = 300
models = {}
_dev = None


def device():
    global _dev
    if not _dev:
        d = os.environ.get("CHATTERBOX_DEVICE")
        if not d:
            import torch
            d = "cuda" if torch.cuda.is_available() else "cpu"
        _dev = d
    return _dev


def norm(lang):
    l = str(lang or "en").lower().replace("_", "-").split("-")[0]
    if l == "multi":
        return l
    if l not in LANGS:
        raise ValueError("Bahasa '%s' belum didukung Chatterbox (tersedia: %s)" % (l, ", ".join(LANGS)))
    return l


def get_model(lang):
    key = "en" if lang == "en" else "mtl"
    if key not in models:
        dev = device()
        if key == "en":
            from chatterbox.tts import ChatterboxTTS
            models[key] = ChatterboxTTS.from_pretrained(device=dev)
        else:
            try:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            except ImportError:
                raise RuntimeError("chatterbox-tts terpasang terlalu lama untuk bahasa lain. Jalankan: pip install -U chatterbox-tts")
            models[key] = ChatterboxMultilingualTTS.from_pretrained(device=dev)
    return models[key]


def handle(m):
    lang = norm(m.get("lang"))
    mdl = get_model(lang)
    if m.get("preload"):
        return {"ok": True}
    parts = []
    for c in U.chunk_text(m["text"], MAXCHARS):
        kw = {"exaggeration": EXAGGERATION, "cfg_weight": CFG_WEIGHT}
        if m.get("ref"):
            kw["audio_prompt_path"] = m["ref"]
        if lang != "en":
            kw["language_id"] = lang
        parts.append(U.to_array(mdl.generate(c, **kw)))
    if not parts:
        raise ValueError("Teks kosong")
    sr = getattr(mdl, "sr", 24000)
    return {"wav": U.wav_b64(U.join_audio(parts, sr), sr)}


U.serve(handle)
