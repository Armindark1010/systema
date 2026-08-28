import numpy as np, librosa, json

SR, NFFT, HOP, MELS, FMIN, FMAX = 48000, 1024, 480, 64, 50, 14000
rng = np.random.default_rng(1234)
# 0.25 s deterministic test signal: tone mix + noise
n = 12000
t = np.arange(n) / SR
x = (0.5*np.sin(2*np.pi*440*t) + 0.25*np.sin(2*np.pi*3000*t) + 0.05*rng.standard_normal(n)).astype(np.float32)

# torchlibrosa Spectrogram: center=True, reflect, power=2.0, hann periodic
S = librosa.stft(x, n_fft=NFFT, hop_length=HOP, win_length=NFFT,
                 window='hann', center=True, pad_mode='reflect')
power = (np.abs(S)**2)
# LogmelFilterBank: librosa.filters.mel defaults (slaney scale, slaney norm)
melW = librosa.filters.mel(sr=SR, n_fft=NFFT, n_mels=MELS, fmin=FMIN, fmax=FMAX)
mel = melW @ power
# ref=1.0, amin=1e-10, top_db=None  =>  10*log10(max(x,amin))
logmel = 10.0*np.log10(np.maximum(mel, 1e-10))

json.dump({"input": x.tolist(), "logmel": logmel.tolist(),
           "frames": int(logmel.shape[1]), "mels": int(logmel.shape[0])},
          open("ref.json","w"))
print("frames", logmel.shape, "range", float(logmel.min()), float(logmel.max()))
