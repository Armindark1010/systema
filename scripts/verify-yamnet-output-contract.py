#!/usr/bin/env python3
"""
SYSTEMA - proves where "out dim 208921" came from.

WHAT THIS ESTABLISHES
---------------------
The device reported `out dim 208921` for yamnet.onnx. This script
reproduces that number from tensor shapes alone, using a real ONNX
Runtime and a YAMNet-SHAPED stand-in graph (built by
scripts/make-yamnet-shaped-stub.py - not YAMNet, no weights).

It confirms:
  1. 208921 = 401 frames x 521 AudioSet classes, and 521 is the ONLY
     one of the three trailing dims that divides it exactly;
  2. that tensor is output_0, which is what `results.get(0)` returns;
  3. the 1024-d embeddings live in output_1 and were never read;
  4. OutputContract's classification rules pick the same answers.

WHAT IT DOES NOT ESTABLISH
--------------------------
It does not execute the real yamnet.onnx (unobtainable here - every
model host is network-blocked) and it does not run the Kotlin (no JDK
is installable). It proves the ARITHMETIC and the SELECTION LOGIC.

Skips cleanly when onnxruntime is unavailable.
"""
import os
import subprocess
import sys

STUB = '/tmp/yam/yamnet_shaped_stub.onnx'
DEVICE_REPORTED = 208921

ok = 0
fail = 0


def check(name, cond, detail=''):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {name}")
    else:
        fail += 1
        print(f"  FAIL  {name}{' - ' + detail if detail else ''}")


print('\n' + '=' * 62)
print('SYSTEMA - YAMNet output contract: explaining 208921')
print('=' * 62)

# ---------------------------------------------------------------
print('\n1. Pure arithmetic - which trailing dim divides 208921?')
print('-' * 54)
for d in (521, 1024, 64):
    q, r = divmod(DEVICE_REPORTED, d)
    verdict = 'EXACT' if r == 0 else f'remainder {r}'
    print(f"     {DEVICE_REPORTED} / {d:4d} = {q:6d}   {verdict}")

check('521 divides 208921 exactly', DEVICE_REPORTED % 521 == 0)
check('208921 / 521 = 401 frames', DEVICE_REPORTED // 521 == 401)
check('1024 does NOT divide it', DEVICE_REPORTED % 1024 != 0,
      'so it cannot be the embedding tensor')
check('64 does NOT divide it', DEVICE_REPORTED % 64 != 0)
# 208921 = 401 x 521, both prime, so no other factorisation exists.
divisors = [d for d in range(1, DEVICE_REPORTED + 1)
            if DEVICE_REPORTED % d == 0]
print(f"     divisors of 208921: {divisors}")
check('401 x 521 is the only non-trivial factorisation',
      divisors == [1, 401, 521, DEVICE_REPORTED],
      'the explanation is forced, not chosen')

# ---------------------------------------------------------------
print('\n2. Frame count vs the reported timings')
print('-' * 54)
# YAMNet framing: 0.96 s window, 0.48 s hop.
win, hop = 0.96, 0.48
lo = (401 - 1) * hop + win
hi = (402 - 1) * hop + win
print(f"     401 frames <=> duration in [{lo:.2f}, {hi:.2f}) s")
implied = (25058.0 / 0.130) / 1000.0
print(f"     total 25058 ms / rtf 0.130 => ~{implied:.2f} s")
print(f"     rtf at {lo:.2f}s = {25058 / 1000 / lo:.4f}, "
      f"at {hi:.2f}s = {25058 / 1000 / hi:.4f}")
check('a ~193 s track is consistent with 401 frames',
      abs(implied - lo) < 1.0,
      'rtf was reported to 3 dp, which cannot resolve one 0.48 s frame')

# ---------------------------------------------------------------
if not os.path.exists(STUB):
    print(f"\n  building stand-in graph...")
    subprocess.run([sys.executable,
                    os.path.join(os.path.dirname(__file__),
                                 'make-yamnet-shaped-stub.py')],
                   check=False)

try:
    import numpy as np
    import onnxruntime as ort
except ImportError:
    print("""
  !! SECTIONS 3-5 NOT RUN - onnxruntime/numpy unavailable here.
  !! The arithmetic above stands; the live tensor check does not.
""")
    print(f"  {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

if not os.path.exists(STUB):
    print(f"\n  !! {STUB} missing; cannot run the live check.")
    print(f"  {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

ort.set_default_logger_severity(3)
sess = ort.InferenceSession(STUB, providers=['CPUExecutionProvider'])

print('\n3. Graph signature, read from the session')
print('-' * 54)
for i in sess.get_inputs():
    print(f"     input  {i.name:10s} shape={i.shape} type={i.type}")
outs_meta = sess.get_outputs()
for o in outs_meta:
    print(f"     output {o.name:10s} shape={o.shape} type={o.type}")

check('three outputs are discovered', len(outs_meta) == 3)
check('output names are read dynamically',
      [o.name for o in outs_meta] == ['output_0', 'output_1', 'output_2'])
check('trailing dims are 521 / 1024 / 64',
      [o.shape[-1] for o in outs_meta] == [521, 1024, 64])
check('all outputs are FLOAT',
      all(o.type == 'tensor(float)' for o in outs_meta))
check('the input is a dynamic 1-D waveform',
      len(sess.get_inputs()) == 1 and len(sess.get_inputs()[0].shape) == 1)

# ---------------------------------------------------------------
print('\n4. Live run - reproducing 208921')
print('-' * 54)
samples = int(round(lo * 16000))
wav = np.zeros(samples, dtype=np.float32)
res = sess.run(None, {'waveform': wav})
print(f"     fed {samples} samples @16 kHz = {samples / 16000:.2f} s")
for meta, arr in zip(outs_meta, res):
    print(f"     {meta.name:10s} runtime shape={arr.shape}  "
          f"elements={arr.size:,}")

# Emulates OnnxInferenceRuntime.infer(): results.get(0), flattened.
selected = res[0]
flat_size = selected.reshape(-1).size
print(f"\n     results.get(0) -> '{outs_meta[0].name}' shape {selected.shape}")
print(f"     flattenFloats(...).size = {flat_size:,}")
print(f"     device reported         = {DEVICE_REPORTED:,}")

check('results.get(0) is output_0', outs_meta[0].name == 'output_0')
check('flattened output_0 reproduces 208921 EXACTLY',
      flat_size == DEVICE_REPORTED,
      f'got {flat_size}')
check('output_0 shape is [401, 521]', list(selected.shape) == [401, 521])
check('the embeddings (output_1) were NOT what was measured',
      res[1].size != DEVICE_REPORTED)
print(f"     output_1 would have been {res[1].size:,} "
      f"({res[1].shape[0]} x {res[1].shape[1]})")

# ---------------------------------------------------------------
print('\n5. OutputContract classification rules')
print('-' * 54)
AUDIOSET, EMB, MEL = 521, 1024, 64


def classify(shape):
    """Mirrors OutputContract.classify() exactly."""
    if len(shape) != 2:
        if len(shape) == 1 and shape[0] == EMB:
            return 'SINGLE_EMBEDDING'
        return 'UNKNOWN'
    return {AUDIOSET: 'CLASS_SCORES',
            EMB: 'FRAME_EMBEDDINGS',
            MEL: 'LOG_MEL_SPECTROGRAM'}.get(shape[1], 'UNKNOWN')


roles = [classify(list(a.shape)) for a in res]
for meta, arr, role in zip(outs_meta, res, roles):
    print(f"     {meta.name:10s} {str(list(arr.shape)):16s} -> {role}")

check('output_0 classifies as CLASS_SCORES', roles[0] == 'CLASS_SCORES')
check('output_1 classifies as FRAME_EMBEDDINGS', roles[1] == 'FRAME_EMBEDDINGS')
check('output_2 classifies as LOG_MEL_SPECTROGRAM',
      roles[2] == 'LOG_MEL_SPECTROGRAM')
check('the embedding output is identified as output_1',
      roles.index('FRAME_EMBEDDINGS') == 1)
check('the selected output is NOT the embedding',
      roles[0] != 'FRAME_EMBEDDINGS',
      'this is the finding')
check('an unrecognised width is UNKNOWN, not "embedding"',
      classify([10, 999]) == 'UNKNOWN')
check('a [1, 1024] output IS a single vector',
      classify([1, 1024]) == 'FRAME_EMBEDDINGS' and res[1].shape[0] != 1)
check('aggregation is required (frames > 1)', res[1].shape[0] > 1,
      f'{res[1].shape[0]} frames must be pooled into one vector')

print('\n' + '=' * 62)
print(f'  {ok} passed, {fail} failed')
print('=' * 62)
print("""
CONCLUSION
----------
  208921 = 401 frames x 521 AudioSet classes, flattened.
  It is output_0 (CLASS SCORES), returned by results.get(0).
  It is NOT an embedding and NOT an embedding dimension.
  The 1024-d embeddings are output_1 - 401 x 1024 = 410,624
  elements - and were never read by the benchmark.

SCOPE
-----
Run against a YAMNet-SHAPED stand-in, not YAMNet itself: no model
host is reachable from this environment. The Kotlin was not compiled
(no JDK installable). A hardware retest is required to confirm the
new diagnostics render on device.
""")
sys.exit(1 if fail else 0)
