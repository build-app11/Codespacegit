# Util bersama untuk pekerja Python (chatterbox_worker.py, xtts_worker.py).
# PENTING: impor modul ini PALING AWAL. stdout asli disimpan untuk protokol JSON, sedangkan print() dari
# pustaka pihak ketiga dialihkan ke stderr supaya tidak merusak jalur JSON ke Node.
import sys, io, json, wave, base64, re
import numpy as np

PROTO = sys.stdout
sys.stdout = sys.stderr


def to_array(audio):
    a = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
    return np.asarray(a, dtype=np.float32).reshape(-1)


def wav_b64(a, sr):
    pcm = (np.clip(a, -1, 1) * 32767).astype(np.int16)
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sr)); w.writeframes(pcm.tobytes())
    return base64.b64encode(b.getvalue()).decode()


def join_audio(parts, sr, gap=0.12):
    if len(parts) == 1:
        return parts[0]
    pad = np.zeros(int(sr * gap), dtype=np.float32)
    out = []
    for p in parts:
        out.append(p); out.append(pad)
    return np.concatenate(out[:-1])


def hard_split(s, mx):
    """Pecah potongan yang masih terlalu panjang: di koma/spasi dulu, terakhir per karakter (zh/ja tanpa spasi)."""
    out = []
    while len(s) > mx:
        k = max(s.rfind(c, 0, mx) for c in (", ", "، ", "、", "，", " "))
        if k < mx * 0.4:
            k = mx
        else:
            k += 1
        out.append(s[:k].strip()); s = s[k:].strip()
    if s:
        out.append(s)
    return out


def chunk_text(text, mx):
    text = re.sub(r"\s+", " ", str(text)).strip()
    parts = re.findall(r"[^.!?;。！？；]+[.!?;。！？；]*\s*", text) or [text]
    out, g = [], ""
    for p in parts:
        if g and len(g) + len(p) > mx:
            out.append(g.strip()); g = ""
        g += p
    if g.strip():
        out.append(g.strip())
    res = []
    for c in out:
        res.extend(hard_split(c, mx) if len(c) > mx else [c])
    return [c for c in res if c.strip()]


def serve(handle):
    """Baca satu JSON per baris dari stdin, jawab satu JSON per baris di stdout asli."""
    for line in sys.stdin:
        m = None
        try:
            m = json.loads(line)
            out = handle(m)
            out["id"] = m["id"]
        except Exception as e:
            sys.stderr.write("error: %s\n" % e); sys.stderr.flush()
            out = {"id": m.get("id") if isinstance(m, dict) else None, "error": str(e)}
        PROTO.write(json.dumps(out) + "\n"); PROTO.flush()
