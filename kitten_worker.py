# Pekerja Kitten TTS: membaca satu JSON per baris dari stdin, membalas satu JSON per baris di stdout.
# Pasang: pip install kittentts  (butuh Python 3.9+)
import sys, json, io, wave, base64
import numpy as np
from kittentts import KittenTTS

models = {}
SR = 24000

def get(name):
    if name not in models:
        models[name] = KittenTTS(name)
    return models[name]

def to_wav(audio):
    a = np.asarray(audio, dtype=np.float32).reshape(-1)
    pcm = (np.clip(a, -1, 1) * 32767).astype(np.int16)
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    return base64.b64encode(b.getvalue()).decode()

for line in sys.stdin:
    try:
        m = json.loads(line)
        k = get(m["model"])
        if m.get("preload"):
            out = {"id": m["id"], "ok": True}
        else:
            voice = str(m.get("voice", "luna")).capitalize()   # Bella, Jasper, Luna, ...
            out = {"id": m["id"], "wav": to_wav(k.generate(m["text"], voice=voice))}
    except Exception as e:
        out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
