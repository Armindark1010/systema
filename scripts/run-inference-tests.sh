#!/usr/bin/env bash
# ============================================================
# SYSTEMA — Phase 15 inference test runner
# ============================================================
# Compiles and RUNS the Kotlin inference contract suite on a plain
# JVM. These are real assertions against real objects: the descriptor,
# the preprocessing boundary and the reference runtime's full
# load/infer/unload lifecycle.
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
  echo "  No Kotlin/JDK toolchain found, so InferenceContractTest was"
  echo "  NEITHER RUN NOR PASSED here. That covers:"
  echo "      ModelDescriptor shape arithmetic"
  echo "      ModelInputPreparer resampling / normalisation / gating"
  echo "      ReferenceInferenceRuntime load-infer-unload lifecycle"
  echo "      error codes, determinism, repeated inference"
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
for candidate in \
  "$HOME/.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm" \
  "$HOME/.m2/repository/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm"; do
  if [ -d "$candidate" ]; then
    found="$(find "$candidate" -name 'kotlinx-coroutines-core-jvm-*.jar' \
      ! -name '*sources*' ! -name '*javadoc*' 2>/dev/null | sort | tail -1)"
    if [ -n "$found" ]; then
      COROUTINES_JAR="$found"
      break
    fi
  fi
done

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
  echo "  These assertions were NOT run and are NOT verified here."
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
