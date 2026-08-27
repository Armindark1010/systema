#!/usr/bin/env python3
"""
SYSTEMA - builds a YAMNet-SHAPED stand-in graph for the output audit.

THIS IS NOT YAMNET. It contains no learned weights, no MobileNet
backbone and no mel front end, and it must never be benchmarked as if
it were a model. It reproduces exactly one thing: the SIGNATURE the
device reported -

    input   waveform  [dynamic]        FLOAT
    output_0          [frames, 521]    FLOAT
    output_1          [frames, 1024]   FLOAT
    output_2          [mel_frames, 64] FLOAT

Frame counts are computed by real ONNX ops from the actual input
length, so feeding it 192.96 s of audio produces 401 frames and an
output_0 of 401 x 521 = 208921 elements - the figure the device
reported. That is what makes the explanation checkable rather than a
story.

Output goes to /tmp and is never committed. Weights of any kind stay
out of the repository.
"""

import numpy as np, onnx
from onnx import helper, TensorProto as TP

# frames = max(1, floor((len(waveform)/16000 - 0.96)/0.48) + 1)
# Built with real ONNX ops so ORT computes it from the ACTUAL input
# length at run time, exactly as the real graph does.
n = helper.make_tensor_value_info('waveform', TP.FLOAT, ['n'])
o0 = helper.make_tensor_value_info('output_0', TP.FLOAT, ['frames', 521])
o1 = helper.make_tensor_value_info('output_1', TP.FLOAT, ['frames', 1024])
o2 = helper.make_tensor_value_info('output_2', TP.FLOAT, ['mel_frames', 64])

def C(name, arr, dt=TP.FLOAT):
    a = np.array(arr)
    return helper.make_node('Constant', [], [name], value=helper.make_tensor(
        name+'_v', dt, list(a.shape), a.flatten().tolist()))

nodes = [
    helper.make_node('Shape', ['waveform'], ['shp']),
    C('sr', [16000.0]), C('win', [0.96]), C('hop', [0.48]),
    C('one_i', [1], TP.INT64), C('zero_i', [0], TP.INT64),
    C('d521', [1, 521], TP.INT64), C('d1024', [1, 1024], TP.INT64),
    C('d64', [1, 64], TP.INT64), C('melhop', [160.0]),
    helper.make_node('Cast', ['shp'], ['nf'], to=TP.FLOAT),
    helper.make_node('Div', ['nf', 'sr'], ['secs']),
    helper.make_node('Sub', ['secs', 'win'], ['rem']),
    helper.make_node('Div', ['rem', 'hop'], ['q']),
    helper.make_node('Floor', ['q'], ['qf']),
    helper.make_node('Cast', ['qf'], ['qi'], to=TP.INT64),
    helper.make_node('Add', ['qi', 'one_i'], ['frames_raw']),
    helper.make_node('Max', ['frames_raw', 'one_i'], ['frames']),
    # mel frames = floor(samples / 160)
    helper.make_node('Div', ['nf', 'melhop'], ['mq']),
    helper.make_node('Floor', ['mq'], ['mqf']),
    helper.make_node('Cast', ['mqf'], ['melframes'], to=TP.INT64),

    helper.make_node('Concat', ['frames', 'd521'], ['s0'], axis=0),
    helper.make_node('Concat', ['frames', 'd1024'], ['s1'], axis=0),
    helper.make_node('Concat', ['melframes', 'd64'], ['s2'], axis=0),
    helper.make_node('Slice', ['s0', 'zero_i', 'one_i'], ['s0a']),
    helper.make_node('Slice', ['s0', 'one_i', 'd521'], ['_u1']),
]
# Build [frames,521] properly: concat frames with scalar dim
nodes = nodes[:-2] + [
    C('c521', [521], TP.INT64), C('c1024', [1024], TP.INT64), C('c64', [64], TP.INT64),
    helper.make_node('Concat', ['frames', 'c521'], ['sh0'], axis=0),
    helper.make_node('Concat', ['frames', 'c1024'], ['sh1'], axis=0),
    helper.make_node('Concat', ['melframes', 'c64'], ['sh2'], axis=0),
    C('fill', [0.5]),
    helper.make_node('Expand', ['fill', 'sh0'], ['output_0']),
    helper.make_node('Expand', ['fill', 'sh1'], ['output_1']),
    helper.make_node('Expand', ['fill', 'sh2'], ['output_2']),
]

g = helper.make_graph(nodes, 'yamnet_shaped_stub', [n], [o0, o1, o2])
m = helper.make_model(g, producer_name='systema-audit',
                      opset_imports=[helper.make_opsetid('', 13)])
m.ir_version = 9
onnx.checker.check_model(m)
onnx.save(m, '/tmp/yam/yamnet_shaped_stub.onnx')
print("built /tmp/yam/yamnet_shaped_stub.onnx")
