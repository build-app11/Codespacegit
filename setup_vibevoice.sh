#!/usr/bin/env bash
# Pasang VibeVoice sekali jalan:  npm run setup:vibevoice
# Melakukan: clone repo resmi -> pip install -e .[streamingtts] -> salin berkas suara .pt ke models/vibevoice/voices
# Opsional: EXTRA_VOICES=1 npm run setup:vibevoice  (ikut mengunduh suara multibahasa eksperimental)
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
REPO="${VIBEVOICE_REPO:-$PWD/models/vibevoice/VibeVoice}"
VOICES="$PWD/models/vibevoice/voices"

mkdir -p "$(dirname "$REPO")" "$VOICES"
if [ -d "$REPO/.git" ]; then git -C "$REPO" pull --ff-only || true
else git clone --depth 1 https://github.com/microsoft/VibeVoice.git "$REPO"; fi

"$PY" -m pip install --break-system-packages -e "$REPO[streamingtts]" 2>/dev/null || "$PY" -m pip install -e "$REPO[streamingtts]"

if [ "${EXTRA_VOICES:-0}" = "1" ] && [ -f "$REPO/demo/download_experimental_voices.sh" ]; then
  (cd "$REPO" && bash demo/download_experimental_voices.sh) || echo "Peringatan: suara eksperimental gagal diunduh"
fi
cp -n "$REPO"/demo/voices/streaming_model/*.pt "$VOICES"/ 2>/dev/null || true

echo "Selesai. Suara terpasang: $(ls "$VOICES" | grep -c '\.pt$')"
echo "Jalankan: npm start, lalu buka Unduh model suara > VibeVoice > Unduh."
