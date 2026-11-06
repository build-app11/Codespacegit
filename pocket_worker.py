# Pekerja Pocket TTS (Kyutai): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang: pip install pocket-tts   (Python 3.10+, PyTorch 2.5+; versi CPU cukup)
import sys, json, io, wave, base64
import numpy as np
from pocket_tts import TTSModel

model = None
states = {}

def get_model():
    global model
    if model is None:
        model = TTSModel.load_model()
    return model

def get_voice(name, ref=None):
    if name not in states:
        # suara bawaan (alba, marius, ...) atau berkas WAV milik pengguna (klon)
        states[name] = get_model().get_state_for_audio_prompt(ref or name)
    return states[name]

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
        mdl = get_model()
        if m.get("preload"):
            get_voice(str(m.get("voice") or "alba"))
            out = {"id": m["id"], "ok": True}
        else:
            audio = mdl.generate_audio(get_voice(str(m["voice"]), m.get("ref")), m["text"])
            out = {"id": m["id"], "wav": to_wav(audio, mdl.sample_rate)}
    except Exception as e:
        sys.stderr.write("pocket error: %s\n" % e); sys.stderr.flush()
        out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
