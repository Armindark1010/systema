#!/usr/bin/env python3
"""
SYSTEMA - Phase 16.1: proves the import validation actually discriminates.

WHY THIS EXISTS
---------------
ModelImporter.kt validates a picked file in two stages:

  1. a fast byte-level sniff that rejects obvious impostors;
  2. a REAL ONNX Runtime session build, which is the only thing that
     actually decides whether the file is usable.

No JDK is installable in this environment, so that Kotlin cannot be
compiled or run here. But both stages are pure decision logic, so the
identical rules are re-implemented below and executed against genuine
files - the real bundled test model, a deliberately corrupted copy of
it, and renamed impostors.

That proves the LOGIC is correct. It does NOT prove the Kotlin runs on
a device; see the caveat printed at the end.

Skips cleanly (exit 0) when onnxruntime is unavailable, matching the
convention in scripts/run-dsp-tests.sh.
"""
import os
import sys

REAL = 'android/app/src/main/assets/models/systema-test-model.onnx'
TMP = '/tmp/systema-import-verify'

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


def looks_like_onnx(path):
    """Mirrors ModelImporter.looksLikeOnnx() exactly."""
    with open(path, 'rb') as f:
        header = f.read(1024)
    if len(header) < 8:
        return False
    text = header.decode('iso-8859-1')
    protobuf_start = header[0] == 0x08
    has_marker = any(m in text.lower()
                     for m in ('onnx', 'pytorch', 'tf2onnx', 'keras'))
    is_known_other = (
        text.startswith('PK') or text.startswith('%PDF')
        or text.startswith('ID3') or text.startswith('RIFF')
        or text.startswith('\x89PNG') or text.startswith('{')
        or text.startswith('<')
    )
    return (not is_known_other) and (protobuf_start or has_marker)


def build_fixtures():
    os.makedirs(TMP, exist_ok=True)
    files = {}
    with open(f'{TMP}/mp3.onnx', 'wb') as f:
        f.write(b'ID3\x04\x00\x00\x00' + b'\x00' * 200)
    files['mp3'] = f'{TMP}/mp3.onnx'
    with open(f'{TMP}/zip.onnx', 'wb') as f:
        f.write(b'PK\x03\x04' + b'\x00' * 200)
    files['zip'] = f'{TMP}/zip.onnx'
    with open(f'{TMP}/json.onnx', 'w') as f:
        f.write('{"not":"a model"}' + ' ' * 200)
    files['json'] = f'{TMP}/json.onnx'
    with open(f'{TMP}/wav.onnx', 'wb') as f:
        f.write(b'RIFF....WAVEfmt ' + b'\x00' * 200)
    files['wav'] = f'{TMP}/wav.onnx'
    with open(f'{TMP}/text.onnx', 'w') as f:
        f.write('plain text, not a model at all. ' * 10)
    files['text'] = f'{TMP}/text.onnx'
    with open(f'{TMP}/tiny.onnx', 'wb') as f:
        f.write(b'\x08')
    files['tiny'] = f'{TMP}/tiny.onnx'
    if os.path.exists(REAL):
        data = bytearray(open(REAL, 'rb').read())
        for i in range(len(data) // 2, len(data)):
            data[i] = 0xFF
        with open(f'{TMP}/corrupt.onnx', 'wb') as f:
            f.write(bytes(data))
        files['corrupt'] = f'{TMP}/corrupt.onnx'
    return files


print('\n' + '=' * 60)
print('SYSTEMA - import validation logic')
print('=' * 60)

if not os.path.exists(REAL):
    print(f"\n  !! {REAL} not found - run npm run gen:test-model first.")
    sys.exit(0)

files = build_fixtures()

print('\nStage 1 - structural sniff (a REJECT filter only)')
print('-' * 48)
check('real test model passes', looks_like_onnx(REAL))
for label in ('mp3', 'zip', 'json', 'wav', 'text', 'tiny'):
    check(f'{label} renamed .onnx is rejected', not looks_like_onnx(files[label]))
# The important one: the sniff CANNOT catch this, which is precisely
# why it is never the final authority.
check('corrupt model passes the sniff (header intact)',
      looks_like_onnx(files['corrupt']),
      'expected - only a session build can catch this')

try:
    import onnxruntime as ort
except ImportError:
    print("""
  !! STAGE 2 NOT RUN - onnxruntime is not installed here.
  !! The session-build half of validation is NOT VERIFIED in this
  !! environment. Install onnxruntime to run it:
  !!     python3 -m venv /tmp/onnxvenv
  !!     /tmp/onnxvenv/bin/pip install onnxruntime
""")
    print(f"  stage 1: {ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

ort.set_default_logger_severity(3)


def try_load(path):
    try:
        return True, ort.InferenceSession(
            path, providers=['CPUExecutionProvider']), None
    except Exception as e:
        return False, None, str(e).split('\n')[0][:110]


print('\nStage 2 - real ONNX Runtime session build (the authority)')
print('-' * 56)
loaded, sess, err = try_load(REAL)
check('real test model builds a session', loaded, err or '')

if loaded:
    ins = [(i.name, i.shape, i.type) for i in sess.get_inputs()]
    outs = [(o.name, o.shape, o.type) for o in sess.get_outputs()]
    print(f"        inputs : {ins}")
    print(f"        outputs: {outs}")
    check('input signature is readable', len(ins) > 0)
    check('output signature is readable', len(outs) > 0)
    check('a concrete type name is reported', all(t for _, _, t in ins))
    # trailingDimension(): a dynamic trailing dim must NOT be reported
    # as an embedding width.
    last = outs[0][1][-1] if outs[0][1] else None
    fixed = isinstance(last, int) and last > 0
    print(f"        trailing out dim {last!r} -> embeddingDimension="
          f"{last if fixed else None}")
    check('a dynamic trailing dim yields no embedding claim', not fixed)

check('corrupt ONNX is rejected by the session build',
      not try_load(files['corrupt'])[0])
print(f"        ORT said: {try_load(files['corrupt'])[2]}")

for label in ('mp3', 'zip', 'json', 'wav', 'text', 'tiny'):
    check(f'{label} renamed .onnx is rejected',
          not try_load(files[label])[0])

print('\n' + '=' * 60)
print(f'  {ok} passed, {fail} failed')
print('=' * 60)
print("""
SCOPE
-----
This proves the DECISION LOGIC of import validation: what the sniff
accepts, and what a real ONNX Runtime accepts. It confirms that a
corrupted model slips past stage 1 and is caught by stage 2, which is
why stage 2 is the authority.

It does NOT execute ModelImporter.kt, and it does NOT test the Android
file picker or the content:// copy. Those are NOT VERIFIED ON HARDWARE.
""")
sys.exit(1 if fail else 0)
