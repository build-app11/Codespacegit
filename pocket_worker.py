# Pekerja Pocket TTS (Kyutai): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang: pip install pocket-tts   (Python 3.10+, PyTorch 2.5+; versi CPU cukup)
import sys, json, io, wave, base64
import numpy as np
from pocket_tts import TTSModel

# Satu model + satu cache suara PER BAHASA (bobot tiap bahasa berbeda; voice state bergantung pada model).
# Butuh pocket-tts >= 2.0:  pip install -U pocket-tts
LANGS = {"en": "english", "de": "german", "es": "spanish", "it": "italian", "pt": "portuguese", "fr": "french_24l"}
models = {}
states = {}

def norm(lang):
    l = str(lang or "en").lower().replace("_", "-").split("-")[0]
    if l not in LANGS:
        raise ValueError("Bahasa '%s' belum didukung model resmi Pocket TTS (tersedia: %s)" % (l, ", ".join(sorted(LANGS))))
    return l

def get_model(lang="en"):
    lang = norm(lang)
    if lang not in models:
        if lang == "en":
            try:
                models[lang] = TTSModel.load_model()
            except Exception:
                raise
        else:
            try:
                models[lang] = TTSModel.load_model(language=LANGS[lang])
            except TypeError:
                raise RuntimeError("pocket-tts terpasang terlalu lama untuk bahasa lain. Jalankan: pip install -U pocket-tts")
    return models[lang]

def get_voice(name, lang="en", ref=None):
    lang = norm(lang)
    key = (lang, ref or name)
    if key not in states:
        # suara bawaan (alba, juergen, ...) atau berkas WAV milik pengguna (klon)
        states[key] = get_model(lang).get_state_for_audio_prompt(ref or name)
    return states[key]

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
        lang = m.get("lang") or "en"
        mdl = get_model(lang)
        if m.get("preload"):
            get_voice(str(m.get("voice") or "alba"), lang)
            out = {"id": m["id"], "ok": True}
        else:
            audio = mdl.generate_audio(get_voice(str(m["voice"]), lang, m.get("ref")), m["text"])
            out = {"id": m["id"], "wav": to_wav(audio, mdl.sample_rate)}
    except Exception as e:
        sys.stderr.write("pocket error: %s\n" % e); sys.stderr.flush()
        out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
