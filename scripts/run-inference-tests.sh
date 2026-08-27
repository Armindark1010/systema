#!/usr/bin/env bash
# ============================================================
# SYSTEMA — Phase 15 / 16A / 17 inference test runner
# ============================================================
# Compiles and RUNS two Kotlin suites on a plain JVM. These are real
# assertions against real objects:
#
#   InferenceContractTest  descriptor shape arithmetic, the
#                          preprocessing boundary, and the reference
#                          runtime's full load/infer/unload lifecycle
#   AggregationTest        Phase 16A frame -> track pooling: the
#                          arithmetic, the L2 normalisation, the
#                          zero/NaN policies and the wrong-tensor
#                          rejection
#   SimilarityTest         Phase 17 cosine similarity and evaluation
#                          statistics: identical/orthogonal/opposite
#                          vectors, norm validation, neighbour
#                          selection, incremental pair growth and the
#                          descriptive statistics
#
# AggregationTest needs no coroutines and no Android, because
# FrameEmbeddingAggregator deliberately imports neither. That is what
# makes the pooling maths executable here rather than only reviewable
# in a diff.
#
# WHAT IS AND IS NOT COVERED HERE
# -------------------------------
# The files compiled below contain no Android and no ONNX imports,
# which is what makes a JVM run possible. OnnxInferenceRuntime is
# excluded deliberately — it needs ONNX Runtime's native library,
# which exists only inside an Android process. Mocking it would test
# the mock, so the ONNX path is verified on the device instead, via
# Settings -> AI BENCHMARK LAB -> ONNX RUNTIME LAB.
#
# When no toolchain is present this SKIPS with exit code 0 and says so
# loudly, so `npm test` stays usable on a machine without Kotlin — but
# a green run must never be read as "the inference layer is verified".
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/android/app/src/main/java/com/systema/music/inference"
TEST="$ROOT/android/app/src/test/java/com/systema/music/inference"
OUT="${TMPDIR:-/tmp}/systema-inference-tests"

# ---- locate the toolchain ------------------------------------

KOTLINC=""
if command -v kotlinc >/dev/null 2>&1; then
  KOTLINC="$(command -v kotlinc)"
elif [ -n "${KOTLINC_HOME:-}" ] && [ -x "$KOTLINC_HOME/bin/kotlinc" ]; then
  KOTLINC="$KOTLINC_HOME/bin/kotlinc"
fi

JAVA_BIN=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA_BIN="$JAVA_HOME/bin/java"
elif command -v java >/dev/null 2>&1; then
  JAVA_BIN="$(command -v java)"
fi

if [ -z "$KOTLINC" ] || [ -z "$JAVA_BIN" ]; then
  echo ""
  echo "  ============================================================"
  echo "  !! INFERENCE SUITE NOT RUN — NOT VERIFIED IN THIS ENVIRONMENT"
  echo "  ============================================================"
  echo "  No Kotlin/JDK toolchain found, so the Kotlin suites were"
  echo "  NEITHER RUN NOR PASSED here. That covers:"
  echo "      ModelDescriptor shape arithmetic"
  echo "      ModelInputPreparer resampling / normalisation / gating"
  echo "      ReferenceInferenceRuntime load-infer-unload lifecycle"
  echo "      error codes, determinism, repeated inference"
  echo "      Phase 16A mean / mean+std pooling and L2 normalisation"
  echo "      Phase 16A zero-vector, NaN and wrong-tensor rejection"
  echo "      Phase 17 cosine similarity and evaluation statistics"
  echo ""
  echo "  A green 'npm test' therefore covers the TypeScript suites"
  echo "  ONLY. Do not report the inference layer as verified from"
  echo "  this run. It executes in CI via ./gradlew testDebugUnitTest."
  echo ""
  echo "  Separately, ONNX execution itself is NEVER verified by this"
  echo "  script — only on the device."
  echo ""
  echo "  Set SYSTEMA_REQUIRE_INFERENCE=1 to make a missing toolchain"
  echo "  a hard failure instead of a skip (recommended in CI)."
  echo "  ============================================================"
  echo ""
  if [ "${SYSTEMA_REQUIRE_INFERENCE:-0}" = "1" ]; then
    echo "  SYSTEMA_REQUIRE_INFERENCE=1 is set — failing." >&2
    exit 1
  fi
  exit 0
fi

# ---- locate kotlinx-coroutines -------------------------------
#
# The runtime interface is suspend-based, so the suite needs the
# coroutines core jar. kotlinc's -include-runtime bundles the Kotlin
# stdlib but NOT coroutines. Gradle has it in its cache after any
# Android build; otherwise this cannot compile and says so rather than
# emitting a confusing "unresolved reference: runBlocking".
COROUTINES_JAR=""
#
# Some kotlinc distributions ship the jar in their own lib/ directory,
# so that is checked too — it saves a full Android build on a machine
# that only has the compiler.
KOTLINC_LIB="$(cd "$(dirname "$KOTLINC")/../lib" 2>/dev/null && pwd || true)"
for candidate in \
  "$HOME/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm" \
  "$HOME/.m2/repository/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm" \
  "$KOTLINC_LIB"; do
  if [ -d "$candidate" ]; then
    found="$(find "$candidate" -name 'kotlinx-coroutines-core-jvm*.jar' \
      ! -name '*sources*' ! -name '*javadoc*' 2>/dev/null | sort | tail -1)"
    if [ -n "$found" ]; then
      COROUTINES_JAR="$found"
      break
    fi
  fi
done

# ---- Phase 16A: aggregation suite -----------------------------
#
# Compiled and run FIRST and SEPARATELY, because it has no coroutines
# dependency at all. A machine that cannot run the suspend-based
# contract suite can still verify the pooling arithmetic, and that
# arithmetic is what every stored track embedding depends on.

AGG_SRC=(
  "$SRC/FrameEmbeddingAggregator.kt"
  "$SRC/ModelDescriptor.kt"
  "$TEST/AggregationTest.kt"
)

echo ""
echo "Compiling Phase 16A aggregation suite..."
mkdir -p "$OUT"

if ! "$KOTLINC" "${AGG_SRC[@]}" \
  -include-runtime -d "$OUT/aggregation-tests.jar" 2>"$OUT/agg-compile.log"; then
  echo "  Aggregation compilation FAILED:"
  grep -v "^warning:" "$OUT/agg-compile.log" | grep -iv "^WARNING" | head -30
  exit 1
fi

if grep -q "error:" "$OUT/agg-compile.log" 2>/dev/null; then
  echo "  Aggregation compilation reported errors:"
  grep "error:" "$OUT/agg-compile.log" | head -30
  exit 1
fi

if ! "$JAVA_BIN" -cp "$OUT/aggregation-tests.jar" \
  com.systema.music.inference.AggregationTest; then
  echo "  Aggregation suite FAILED."
  exit 1
fi

# ---- Phase 17: similarity suite -------------------------------
#
# Also coroutine-free, for the same reason: EmbeddingSimilarity is
# pure arithmetic over FloatArrays. Every cosine score the quality lab
# will ever report comes out of this code, so it is verified by
# execution rather than by review.

SIM_SRC=(
  "$SRC/FrameEmbeddingAggregator.kt"
  "$SRC/EmbeddingSimilarity.kt"
  "$SRC/ModelDescriptor.kt"
  "$TEST/SimilarityTest.kt"
)

echo ""
echo "Compiling Phase 17 similarity suite..."

if ! "$KOTLINC" "${SIM_SRC[@]}" \
  -include-runtime -d "$OUT/similarity-tests.jar" 2>"$OUT/sim-compile.log"; then
  echo "  Similarity compilation FAILED:"
  grep -v "^warning:" "$OUT/sim-compile.log" | grep -iv "^WARNING" | head -30
  exit 1
fi

if grep -q "error:" "$OUT/sim-compile.log" 2>/dev/null; then
  echo "  Similarity compilation reported errors:"
  grep "error:" "$OUT/sim-compile.log" | head -30
  exit 1
fi

if ! "$JAVA_BIN" -cp "$OUT/similarity-tests.jar" \
  com.systema.music.inference.SimilarityTest; then
  echo "  Similarity suite FAILED."
  exit 1
fi

# ---- Phase 15: contract suite ---------------------------------

if [ -z "$COROUTINES_JAR" ]; then
  echo ""
  echo "  ============================================================"
  echo "  !! INFERENCE SUITE NOT RUN — COROUTINES JAR NOT FOUND"
  echo "  ============================================================"
  echo "  A Kotlin toolchain is present, but kotlinx-coroutines-core"
  echo "  is not in the Gradle or Maven cache, and the InferenceRuntime"
  echo "  contract is suspend-based."
  echo ""
  echo "  Run an Android build once (./gradlew :app:assembleDebug) to"
  echo "  populate the cache, or run the suite through Gradle:"
  echo "      ./gradlew testDebugUnitTest"
  echo ""
  echo "  The Phase 16A aggregation suite above DID run. These"
  echo "  contract assertions did NOT and are NOT verified here."
  echo "  ============================================================"
  echo ""
  if [ "${SYSTEMA_REQUIRE_INFERENCE:-0}" = "1" ]; then
    exit 1
  fi
  exit 0
fi

echo ""
echo "Compiling Phase 15 inference suite..."
echo "  coroutines: $COROUTINES_JAR"

mkdir -p "$OUT"

# Only the Android-free, ONNX-free files. Adding OnnxInferenceRuntime
# here would fail to compile without the AAR, which is correct: it
# belongs to the Android build.
if ! "$KOTLINC" \
  "$SRC/ModelDescriptor.kt" \
  "$SRC/InferenceRuntime.kt" \
  "$SRC/ModelInputPreparer.kt" \
  "$SRC/ReferenceInferenceRuntime.kt" \
  "$TEST/InferenceContractTest.kt" \
  -classpath "$COROUTINES_JAR" \
  -include-runtime -d "$OUT/inference-tests.jar" 2>"$OUT/compile.log"; then
  echo "  Inference compilation FAILED:"
  grep -v "^warning:" "$OUT/compile.log" | grep -iv "^WARNING" | head -30
  exit 1
fi

if grep -q "error:" "$OUT/compile.log" 2>/dev/null; then
  echo "  Inference compilation reported errors:"
  grep "error:" "$OUT/compile.log" | head -30
  exit 1
fi

"$JAVA_BIN" -cp "$OUT/inference-tests.jar:$COROUTINES_JAR" \
  com.systema.music.inference.InferenceContractTest
