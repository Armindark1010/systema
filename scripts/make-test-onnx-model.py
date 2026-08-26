#!/usr/bin/env python3
"""
Generates SYSTEMA's deterministic ONNX integration-test model.

WHY THIS EXISTS (Phase 15 §8)
-----------------------------
Proving "Kotlin -> ONNX Runtime -> real .onnx file -> real inference ->
real output" does not require a 620 MB audio model. It requires a real
ONNX file whose correct output is known in advance, so a wrong answer
is unambiguous.

So this builds a tiny graph computing a fixed, checkable function:

    output[i] = (input[i] * 2.0 + 1.0) ^ 2

For the canonical input [1, 2, 3, 4]:

    [1,2,3,4] -> *2 -> [2,4,6,8]
              -> +1 -> [3,5,7,9]
              -> ^2 -> [9,25,49,81]

Those four numbers are hard-coded in the Kotlin, TypeScript and UI
layers as the expected result. If ONNX Runtime is genuinely executing
the file, they appear. If anything is faked, stubbed or silently
substituted, they do not.

WHY THE OPS ARE Mul/Add/Mul RATHER THAN ANYTHING CLEVER
-------------------------------------------------------
Mul and Add are in the earliest ONNX opsets and are supported by every
build of ONNX Runtime, including the reduced mobile package. The test
must fail because integration is broken, never because the runtime
lacks an operator.

The model has a DYNAMIC input length, which also exercises the
runtime's dynamic-shape path — the same path a real audio model needs
for variable-length input.

Usage:
    python3 scripts/make-test-onnx-model.py [output_path]

The generated file is ~200 bytes and IS committed: it is pure
arithmetic with no learned weights, so it is not a model weight in the
sense §7 prohibits. Real candidate weights are still never committed.
"""

import sys
import hashlib
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

# The transformation, stated once. Kotlin/TS assertions mirror it.
SCALE = 2.0
OFFSET = 1.0

CANONICAL_INPUT = [1.0, 2.0, 3.0, 4.0]
CANONICAL_OUTPUT = [9.0, 25.0, 49.0, 81.0]


def build_model() -> onnx.ModelProto:
    # Dynamic first dimension: 'n' lets the same model accept 4 floats
    # in a unit test and 480,000 in an audio-shaped smoke test.
    inp = helper.make_tensor_value_info("input", TensorProto.FLOAT, ["n"])
    out = helper.make_tensor_value_info("output", TensorProto.FLOAT, ["n"])

    scale = numpy_helper.from_array(np.array([SCALE], dtype=np.float32), name="scale")
    offset = numpy_helper.from_array(np.array([OFFSET], dtype=np.float32), name="offset")

    nodes = [
        helper.make_node("Mul", ["input", "scale"], ["scaled"], name="scale_op"),
        helper.make_node("Add", ["scaled", "offset"], ["shifted"], name="offset_op"),
        # Mul by itself rather than Pow: Pow has had dtype quirks across
        # opsets, and squaring is unambiguous.
        helper.make_node("Mul", ["shifted", "shifted"], ["output"], name="square_op"),
    ]

    graph = helper.make_graph(
        nodes,
        "systema_deterministic_test",
        [inp],
        [out],
        initializer=[scale, offset],
        doc_string=(
            "SYSTEMA Phase 15 integration-test model. "
            "output = (input * 2 + 1)^2. Not an audio model; it exists "
            "solely to prove real ONNX Runtime execution end to end."
        ),
    )

    # Opset 13 is comfortably old enough for any ONNX Runtime build and
    # new enough to be well specified.
    model = helper.make_model(
        graph,
        producer_name="systema-phase15",
        opset_imports=[helper.make_opsetid("", 13)],
    )
    model.ir_version = 8  # broad compatibility with mobile builds
    onnx.checker.check_model(model)
    return model


def verify(path: Path) -> None:
    """Runs the model if onnxruntime is present, to catch a bad export."""
    try:
        import onnxruntime as ort
    except ImportError:
        print("  onnxruntime not installed here — skipping desktop execution check.")
        print("  (The Kotlin instrumentation test is the authoritative check.)")
        return

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    result = session.run(
        None, {"input": np.array(CANONICAL_INPUT, dtype=np.float32)}
    )[0]
    expected = np.array(CANONICAL_OUTPUT, dtype=np.float32)
    if not np.allclose(result, expected):
        raise SystemExit(f"  FAIL: got {result.tolist()}, expected {CANONICAL_OUTPUT}")
    print(f"  Desktop execution check PASSED: {result.tolist()}")


def main() -> None:
    target = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "android/app/src/main/assets/models/systema-test-model.onnx"
    )
    target.parent.mkdir(parents=True, exist_ok=True)

    model = build_model()
    onnx.save(model, str(target))

    data = target.read_bytes()
    digest = hashlib.sha256(data).hexdigest()

    print(f"Wrote {target} ({len(data)} bytes)")
    print(f"  sha256: {digest}")
    print(f"  input  {CANONICAL_INPUT} -> expected {CANONICAL_OUTPUT}")
    verify(target)


if __name__ == "__main__":
    main()
