# Pekerja Kitten TTS: membaca satu JSON per baris dari stdin, membalas satu JSON per baris di stdout.
# Pasang: pip install kittenml   (atau wheel kittentts 0.8.1 dari rilis GitHub KittenML). Butuh Python 3.9+
import sys, json, io, wave, base64
import numpy as np
try:
    from kittenml import KittenTTS      # paket baru: pip install kittenml
except ImportError:
    from kittentts import KittenTTS     # paket 0.8: pip install <wheel rilis 0.8.1>

models = {}
SR = 24000

# Bila nama model tidak ada di Hugging Face, coba versi lain supaya tetap jalan (dicatat di stderr).
FALLBACK = ["KittenML/kitten-tts-nano-0.8", "KittenML/kitten-tts-micro-0.8"]   # nano-0.8-int8 diketahui bermasalah

def get(name):
    if name in models:
        return models[name]
    last = None
    for n in [name] + [x for x in FALLBACK if x != name]:
        try:
            models[name] = KittenTTS(n)
            if n != name:
                sys.stderr.write("model %s tidak bisa dimuat, pakai %s\n" % (name, n)); sys.stderr.flush()
            return models[name]
        except Exception as e:
            last = e
            sys.stderr.write("gagal memuat %s: %s\n" % (n, e)); sys.stderr.flush()
    raise last

ORDER = ["bella", "jasper", "luna", "bruno", "rosie", "hugo", "kiki", "leo"]   # genap = perempuan, ganjil = laki-laki

def resolve_voice(k, v):
    """Cocokkan nama suara aplikasi dengan suara yang benar-benar ada di model.
    Versi baru: Bella, Luna, ... Versi lama: expr-voice-2-m, expr-voice-2-f, ..."""
    av = list(getattr(k, "available_voices", None) or [])
    if not av:
        return v.capitalize()
    for c in (v, v.capitalize(), v.lower()):
        if c in av:
            return c
    i = ORDER.index(v.lower()) if v.lower() in ORDER else 0
    legacy = [x for x in av if x.endswith("-m") or x.endswith("-f")]
    if legacy:
        g = "f" if i % 2 == 0 else "m"
        pool = [x for x in legacy if x.endswith("-" + g)] or legacy
        return pool[(i // 2) % len(pool)]
    return av[i % len(av)]

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
            voice = resolve_voice(k, str(m.get("voice", "luna")))
            out = {"id": m["id"], "wav": to_wav(k.generate(m["text"], voice=voice))}
    except Exception as e:
        out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
