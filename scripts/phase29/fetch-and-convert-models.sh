#!/usr/bin/env bash
#
# SYSTEMA Phase 29 — acquire and convert the semantic models.
#
# THIS IS NOT PART OF THE ANDROID APP. It is developer tooling, run once
# on a machine with internet access, and its only output is a handful of
# .onnx files you copy into the app's assets. Nothing here ships.
#
# It exists because the sandbox this phase was built in cannot reach
# essentia.upf.edu or huggingface.co (both return HTTP 000, while npm,
# PyPI and GitHub resolve normally). Everything downstream of the
# weights is finished and tested; this closes the one remaining gap.
#
# Usage:
#   bash scripts/phase29/fetch-and-convert-models.sh [OUTPUT_DIR]
#
# Default OUTPUT_DIR: build/phase29-models  (gitignored — these files
# are ~90 MB and CC BY-NC-SA licensed; they must not enter the repo.)
#
# Requirements: curl, python3 with pip. tf2onnx and tensorflow are
# installed into a THROWAWAY virtualenv under OUTPUT_DIR, never
# globally and never into the app.

set -euo pipefail

OUT="${1:-build/phase29-models}"
BASE="https://essentia.upf.edu/models"
VENV="$OUT/.venv-convert"

mkdir -p "$OUT"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  x %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------
say "0. Licence"
cat <<'LICENCE'
  These models are CC BY-NC-SA 4.0 — NON-COMMERCIAL.
  Fine for the experiment this phase exists to run. NOT fine for a
  commercial release of SYSTEMA. If the evaluation says the model is
  worth keeping, licensing has to be resolved before it ships.
LICENCE

# ---------------------------------------------------------------------
say "1. Reachability"
if ! curl -sf --max-time 20 -o /dev/null "$BASE/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.json"; then
  die "Cannot reach $BASE — run this from a machine with internet access."
fi
echo "  ok: $BASE responds"

# ---------------------------------------------------------------------
# The embedding model. This is the ONLY one published as ONNX, so it
# needs no conversion at all.
say "2. Embedding model (ONNX published upstream — no conversion)"

fetch() { # url, dest
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "  cached: $(basename "$dest")"
    return 0
  fi
  echo "  GET $(basename "$dest")"
  curl -fL --max-time 900 --retry 3 --retry-delay 5 -o "$dest.part" "$url" \
    || { rm -f "$dest.part"; return 1; }
  mv "$dest.part" "$dest"
}

fetch "$BASE/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.onnx" \
      "$OUT/discogs-effnet-bs64-1.onnx" \
  || die "embedding download failed — everything else depends on it"

fetch "$BASE/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.json" \
      "$OUT/discogs-effnet-bs64-1.json" || warn "metadata missing"

# ---------------------------------------------------------------------
# The classifier heads ship as frozen TensorFlow graphs and must be
# converted. Each is tiny (a single dense layer over a 1280-d input).
say "3. Classifier heads (frozen .pb — conversion required)"

# name | remote path | output tensor
HEADS=(
  "mtg_jamendo_moodtheme-discogs-effnet-1|classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1|model/Sigmoid"
  "mtg_jamendo_genre-discogs-effnet-1|classification-heads/mtg_jamendo_genre/mtg_jamendo_genre-discogs-effnet-1|model/Sigmoid"
  "voice_instrumental-discogs-effnet-1|classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1|model/Softmax"
)

for spec in "${HEADS[@]}"; do
  IFS='|' read -r name path _out <<<"$spec"
  fetch "$BASE/$path.pb"   "$OUT/$name.pb"   || warn "$name.pb failed"
  fetch "$BASE/$path.json" "$OUT/$name.json" || warn "$name.json failed"
done

# The tags head is intentionally absent: its 50 label strings could not
# be retrieved, and scores without a verified label list are unusable.
# See TOP50TAGS_TAXONOMY.labelsUnavailable.
warn "top50tags head skipped on purpose — label vocabulary unverified"

# ---------------------------------------------------------------------
say "4. Conversion toolchain (throwaway venv, never global)"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  # Pinned: tf2onnx is sensitive to the TF version it introspects.
  "$VENV/bin/pip" install --quiet "tensorflow==2.15.*" "tf2onnx==1.16.*" "onnx>=1.15"
fi
echo "  ok: $VENV"

# ---------------------------------------------------------------------
say "5. Convert frozen graphs to ONNX"
for spec in "${HEADS[@]}"; do
  IFS='|' read -r name _path out <<<"$spec"
  pb="$OUT/$name.pb"
  onnx="$OUT/$name.onnx"

  [ -s "$pb" ] || { warn "skip $name (no .pb)"; continue; }
  [ -s "$onnx" ] && { echo "  cached: $name.onnx"; continue; }

  echo "  converting $name"
  # Heads take the 1280-d embedding, NOT audio. Opset 13 is what ONNX
  # Runtime Android 1.x supports comfortably.
  "$VENV/bin/python" -m tf2onnx.convert \
    --graphdef "$pb" \
    --output "$onnx" \
    --inputs "model/Placeholder:0" \
    --outputs "$out:0" \
    --opset 13 \
    2>&1 | sed 's/^/    /' || warn "$name conversion failed"
done

# ---------------------------------------------------------------------
say "6. Verify shapes against what the app expects"
"$VENV/bin/python" - "$OUT" <<'PY'
import sys, pathlib
try:
    import onnx
except ImportError:
    print("  ! onnx not importable; skipping verification"); sys.exit(0)

out = pathlib.Path(sys.argv[1])

# What app/services/music-semantics/providers/jamendoTaxonomy.ts declares.
EXPECT = {
    "discogs-effnet-bs64-1.onnx":                 ("embedding", 1280),
    "mtg_jamendo_moodtheme-discogs-effnet-1.onnx": ("mood",      56),
    "mtg_jamendo_genre-discogs-effnet-1.onnx":     ("genre",     87),
    "voice_instrumental-discogs-effnet-1.onnx":    ("vocal",      2),
}

bad = 0
for fn, (field, classes) in EXPECT.items():
    p = out / fn
    if not p.exists():
        print(f"  - {fn}: MISSING"); bad += 1; continue
    m = onnx.load(str(p))
    outs = []
    for o in m.graph.output:
        dims = [d.dim_value or -1 for d in o.type.tensor_type.shape.dim]
        outs.append((o.name, dims))
    match = any(classes in dims for _, dims in outs)
    flag = "ok " if match else "!! "
    print(f"  {flag}{fn}")
    print(f"      expect {field}: {classes} classes")
    for n, d in outs:
        print(f"      actual {n}: {d}")
    if not match:
        bad += 1
        print("      MISMATCH — do NOT ship this. Either the checkpoint")
        print("      changed or the taxonomy in jamendoTaxonomy.ts is stale.")
        print("      Fix the taxonomy to match the model; never the reverse.")

sys.exit(1 if bad else 0)
PY
VERIFY=$?

# ---------------------------------------------------------------------
say "7. Next steps"
cat <<NEXT
  Models are in: $OUT

  Remaining work, in order:

  1. Copy the .onnx files to android/app/src/main/assets/models/
     (or wherever InferenceRuntime.kt resolves ModelDescriptor paths).

  2. Implement the mel-spectrogram front-end. THIS IS THE REAL WORK.
     The embedding takes [64, 128, 96] mel patches at 16 kHz, not audio.
     Nothing in SYSTEMA produces them today. Parameters are in
     docs/phase-29-semantic-model.md.

  3. Wire semanticRuntime.ts to InferenceRuntime.kt, replacing the
     PROVIDER_NOT_READY returns in runEmbedding and runHead. That file
     is the ONLY place that needs to change — everything above it is
     done and tested.

  4. Flip isRuntimeReady() and run scripts/test-music-semantics.ts.
     Tests asserting not-ready behaviour will correctly start failing;
     update them to assert real output.

  5. Then the 17-step device checklist in docs/phase-29-report.md.
NEXT

if [ $VERIFY -ne 0 ]; then
  die "verification found problems — see section 6 above"
fi
say "Done. All shapes match the taxonomy the app declares."
