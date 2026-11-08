# Pekerja Supertonic TTS (Supertone): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang: pip install supertonic   (Python 3.9+, CPU saja; model ±400 MB diunduh otomatis saat pertama dipakai
# ke ~/.cache/supertonic3/)
import os, sys, json, io, wave, base64
import numpy as np
from supertonic import TTS

# 31 bahasa Supertonic 3. Kode lain (mis. zh) memakai "na" = pemrosesan teks tanpa bahasa tertentu.
LANGS = set("en ko ja ar bg cs da de el es et fi fr hi hr hu id it lt lv nl pl pt ro ru sk sl sv tr uk vi".split())
VOICES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]

def _steps():
    try:
        return max(2, min(16, int(os.environ.get("SUPERTONIC_STEPS", "8"))))   # kualitas: 5 (rendah) sampai 12 (tinggi)
    except ValueError:
        return 8
STEPS = _steps()

tts = None
styles = {}

def norm(lang):
    l = str(lang or "en").lower().replace("_", "-").split("-")[0]
    if l == "in":
        l = "id"
    return l if l in LANGS else "na"

def get_tts():
    global tts
    if tts is None:
        tts = TTS(auto_download=True)
    return tts

def get_style(name):
    if name not in VOICES:
        raise ValueError("Suara Supertonic tidak dikenal: %s (tersedia: %s)" % (name, ", ".join(VOICES)))
    if name not in styles:
        styles[name] = get_tts().get_voice_style(voice_name=name)
    return styles[name]

def to_wav(audio, sr):
    a = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
    a = np.asarray(a, dtype=np.float32).reshape(-1)
    pcm = (np.clip(a, -1, 1) * 32767).astype(np.int16)
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sr)); w.writeframes(pcm.tobytes())
    return base64.b64encode(b.getvalue()).decode()

for line in sys.stdin:
    m = None
    try:
        m = json.loads(line)
        t = get_tts()
        style = get_style(str(m.get("voice") or "M1"))
        if m.get("preload"):
            out = {"id": m["id"], "ok": True}
        else:
            wav, _dur = t.synthesize(m["text"], voice_style=style, total_steps=STEPS, lang=norm(m.get("lang")))
            out = {"id": m["id"], "wav": to_wav(wav, getattr(t, "sample_rate", 44100))}
    except Exception as e:
        sys.stderr.write("supertonic error: %s\n" % e); sys.stderr.flush()
        out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
