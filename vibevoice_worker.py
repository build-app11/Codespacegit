# Pekerja VibeVoice-Realtime-0.5B (Microsoft, lisensi MIT): satu JSON per baris di stdin, satu JSON per baris di stdout.
# Pasang (dari klon repo resmi):
#   git clone https://github.com/microsoft/VibeVoice.git && cd VibeVoice && pip install -e .[streamingtts]
# Suara = berkas preset .pt (satu pembicara per berkas), BUKAN bagian dari model di Hugging Face. Berkasnya ada di repo:
#   VibeVoice/demo/voices/streaming_model/*.pt   (suara tambahan: bash demo/download_experimental_voices.sh)
# Folder suara dicari berurutan: $VIBEVOICE_VOICES, $VIBEVOICE_REPO/demo/voices/streaming_model, models/vibevoice/voices,
# lalu folder demo/ di sebelah paket vibevoice (bila dipasang dengan  pip install -e ).
# Perangkat lewat VIBEVOICE_DEVICE (cuda / mps / cpu). Bawaan: cuda, lalu mps, lalu cpu.
# Model lewat VIBEVOICE_MODEL (bawaan microsoft/VibeVoice-Realtime-0.5B). Langkah difusi lewat VIBEVOICE_STEPS (bawaan 5).
# Bahasa utama: Inggris. Jerman, Prancis, Italia, Jepang, Korea, Belanda, Polandia, Portugis, Spanyol masih eksperimental.
import worker_util as U
import os, sys, copy

MODEL_ID = os.environ.get("VIBEVOICE_MODEL", "microsoft/VibeVoice-Realtime-0.5B")
STEPS = int(os.environ.get("VIBEVOICE_STEPS", "5"))
CFG_SCALE = float(os.environ.get("VIBEVOICE_CFG", "1.5"))
MAXCHARS = 500
SR = 24000   # bawaan skrip demo resmi
state = {}
voice_cache = {}


def voice_dirs():
    out = []
    if os.environ.get("VIBEVOICE_VOICES"):
        out.append(os.environ["VIBEVOICE_VOICES"])
    if os.environ.get("VIBEVOICE_REPO"):
        out.append(os.path.join(os.environ["VIBEVOICE_REPO"], "demo", "voices", "streaming_model"))
    out.append(os.path.join(os.environ.get("MODELS_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"), "vibevoice", "voices"))
    try:
        import vibevoice
        root = os.path.dirname(os.path.dirname(os.path.abspath(vibevoice.__file__)))
        out.append(os.path.join(root, "demo", "voices", "streaming_model"))
    except Exception:
        pass
    return out


def voice_file(name):
    name = os.path.basename(str(name or ""))
    for d in voice_dirs():
        p = os.path.join(d, name + ".pt")
        if os.path.isfile(p):
            return p
    raise ValueError("Suara VibeVoice '%s' tidak ditemukan. Salin berkas .pt dari VibeVoice/demo/voices/streaming_model ke models/vibevoice/voices (lihat README)." % name)


def get_state():
    if "model" in state:
        return state
    import torch
    from vibevoice.modular.modeling_vibevoice_streaming_inference import VibeVoiceStreamingForConditionalGenerationInference
    from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor
    dev = os.environ.get("VIBEVOICE_DEVICE")
    if not dev:
        dev = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
    if dev == "mps" and not torch.backends.mps.is_available():
        dev = "cpu"
    dtype, attn = (torch.bfloat16, "flash_attention_2") if dev == "cuda" else (torch.float32, "sdpa")
    processor = VibeVoiceStreamingProcessor.from_pretrained(MODEL_ID)

    def load(a):
        return VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
            MODEL_ID, torch_dtype=dtype, attn_implementation=a, device_map=(None if dev == "mps" else dev))
    try:
        model = load(attn)
    except Exception as e:
        if attn != "flash_attention_2":
            raise
        sys.stderr.write("flash_attention_2 gagal (%s), pakai sdpa (kualitas bisa sedikit turun)\n" % e)
        model = load("sdpa")
    if dev == "mps":
        model.to("mps")
    model.eval()
    model.set_ddpm_inference_steps(num_steps=STEPS)
    state.update(model=model, processor=processor, dev=dev)
    return state


def get_voice(name, dev):
    if name not in voice_cache:
        import torch
        voice_cache[name] = torch.load(voice_file(name), map_location=dev, weights_only=False)
    return voice_cache[name]


def clean(t):
    return (str(t).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"'))


def handle(m):
    s = get_state()
    if m.get("preload"):
        return {"ok": True}
    import torch
    cached = get_voice(m.get("voice"), s["dev"])
    parts = []
    for c in U.chunk_text(clean(m["text"]), MAXCHARS):
        inputs = s["processor"].process_input_with_cached_prompt(text=c, cached_prompt=cached, padding=True, return_tensors="pt", return_attention_mask=True)
        for k, v in inputs.items():
            if torch.is_tensor(v):
                inputs[k] = v.to(s["dev"])
        with torch.no_grad():
            out = s["model"].generate(**inputs, max_new_tokens=None, cfg_scale=CFG_SCALE, tokenizer=s["processor"].tokenizer,
                                      generation_config={"do_sample": False}, verbose=False, all_prefilled_outputs=copy.deepcopy(cached))
        a = out.speech_outputs[0]
        if a is None:
            continue
        parts.append(U.to_array(a.float() if hasattr(a, "float") else a))
    if not parts:
        raise ValueError("VibeVoice tidak menghasilkan audio (teks terlalu pendek? coba minimal 4 kata)")
    return {"wav": U.wav_b64(U.join_audio(parts, SR), SR)}


U.serve(handle)
