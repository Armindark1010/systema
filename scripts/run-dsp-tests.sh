#!/usr/bin/env bash
# ============================================================
# SYSTEMA — Phase 13 DSP test runner
# ============================================================
# Compiles and RUNS the Kotlin DSP suites against real synthetic
# signals. These are genuine numeric tests (a sine's RMS, a click
# track's tempo, an FFT's dominant bin), not source-code greps.
#
# The DSP core is deliberately free of Android imports so it can run on
# a plain JVM. That is what makes this possible without an emulator,
# and it is why the analyser is split the way it is.
#
# Requirements: a JDK (21+) and kotlinc on PATH, or KOTLINC_HOME /
# JAVA_HOME pointing at them. When neither is present the script SKIPS
# with exit code 0 rather than failing: `npm test` must stay usable on
# a machine with no Kotlin toolchain, and CI runs these through Gradle
# (./gradlew testDebugUnitTest) where the toolchain is guaranteed.
# ============================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/android/app/src/main/java/com/systema/music/analysis"
TEST="$ROOT/android/app/src/test/java/com/systema/music/analysis"
OUT="${TMPDIR:-/tmp}/systema-dsp-tests"

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
  echo "  SKIP: Kotlin/JDK toolchain not found — DSP suites not run here."
  echo "        They run in CI via ./gradlew testDebugUnitTest."
  echo ""
  exit 0
fi

echo ""
echo "Compiling Phase 13 DSP suites..."

mkdir -p "$OUT"

# The DSP core plus the suites. No Android classes are referenced by
# any of these files, which is exactly the property being relied on.
#
# AudioAnalysisException and AnalysisBatchPolicy are included because
# the batch-policy suite tests the REAL worker decision table; the
# policy object is deliberately free of Android and WorkManager imports
# so it can be compiled and executed here.
if ! "$KOTLINC" \
  "$SRC"/dsp/*.kt \
  "$SRC"/model/*.kt \
  "$SRC"/AudioAnalysisException.kt \
  "$SRC"/work/AnalysisBatchPolicy.kt \
  "$TEST"/DspTest.kt \
  "$TEST"/ResampleTest.kt \
  "$TEST"/PipelineIntegrationTest.kt \
  "$TEST"/NumericalSafetyTest.kt \
  "$TEST"/BatchPolicyTest.kt \
  -include-runtime -d "$OUT/dsp-tests.jar" 2>"$OUT/compile.log"; then
  echo "  DSP compilation FAILED:"
  grep -v "^warning:" "$OUT/compile.log" | grep -iv "^WARNING" | head -30
  exit 1
fi

# Surface real compiler errors even when the exit code was 0.
if grep -q "^.*error:" "$OUT/compile.log" 2>/dev/null; then
  echo "  DSP compilation reported errors:"
  grep "error:" "$OUT/compile.log" | head -30
  exit 1
fi

status=0
for suite in DspTest ResampleTest PipelineIntegrationTest NumericalSafetyTest BatchPolicyTest; do
  if ! "$JAVA_BIN" -cp "$OUT/dsp-tests.jar" "com.systema.music.analysis.$suite"; then
    status=1
  fi
done

exit $status
