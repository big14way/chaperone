#!/usr/bin/env python3
"""Original score for the Chaperone launch ad. Soothing lofi, 80 BPM, 12 bars = 36.0 s exactly.
Everything is synthesised here (electric piano, pad, sub bass, brushed drums, bells, vinyl), so there is
nothing to license and no Content ID risk. Writes music.wav and cues.json (bar start times).

Arc: bars 1-3 muffled keys only (the problem), bar 4 opens up (logo reveal), bars 5-10 full groove
(product), bar 11 breathes, bar 12 resolves on the end card."""
import json
import os

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BPM = 80.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT  # 3.0 s
BARS = 12
DUR = BARS * BAR
N = int(round(DUR * SR))
rng = np.random.default_rng(11)
OUT = os.path.dirname(os.path.abspath(__file__))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def nm(s):
    name, octv = s[:-1], int(s[-1])
    return 12 * (octv + 1) + NOTE[name]


def swing(beat_pos, amt=0.58):
    whole = np.floor(beat_pos)
    frac = beat_pos - whole
    return whole + (amt if abs(frac - 0.5) < 1e-6 else frac)


def t_of(bar, beat):
    return bar * BAR + swing(beat) * BEAT


def add(buf, start_s, x, gain=1.0, pan=0.0):
    i = int(round(start_s * SR))
    if i >= buf.shape[1] or i < 0:
        return
    x = x[: buf.shape[1] - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i : i + len(x)] += gain * l * x
    buf[1, i : i + len(x)] += gain * r * x


def env_adr(n, a, d_tau, rel_start, rel):
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4)) * np.exp(-t / d_tau)
    r = np.clip(1 - (t - rel_start) / rel, 0, 1)
    return e * np.where(t < rel_start, 1.0, r)


# ---------------- instruments ----------------
def epiano(m, dur, vel=0.8):
    f = mtof(m)
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    idx = 1.0 * np.exp(-t / 0.3) + 0.18
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    x += 0.14 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.6)
    x += 0.03 * np.sin(2 * np.pi * 4.01 * f * t) * np.exp(-t / 0.07)
    return vel * x * env_adr(n, 0.006, 2.4, dur, 0.6)


def pad(m, dur, vel=0.5):
    """Detuned soft saw stack through a gentle low-pass: air under the keys."""
    f = mtof(m)
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for d in (-0.07, 0.0, 0.06):
        ph = 2 * np.pi * f * (1 + d / 12) * t + rng.uniform(0, 6.28)
        x += signal.sawtooth(ph) * 0.33
    x = signal.sosfilt(signal.butter(2, 1400, "low", fs=SR, output="sos"), x)
    e = np.minimum(1, t / 0.9) * np.where(t < dur, 1, np.clip(1 - (t - dur) / 1.2, 0, 1))
    return vel * x * e


def sub(m, dur, vel=0.9):
    f = mtof(m)
    n = int((dur + 0.2) * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) + 0.15 * np.sin(2 * np.pi * 2 * f * t)
    e = np.minimum(1, t / 0.02) * np.where(t < dur, 1, np.clip(1 - (t - dur) / 0.18, 0, 1))
    return vel * np.tanh(1.1 * x * e)


def bell(m, dur=2.2, vel=0.5):
    f = mtof(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t + 1.6 * np.exp(-t / 0.5) * np.sin(2 * np.pi * 3.5 * f * t))
    return vel * x * np.exp(-t / 0.75) * np.minimum(1, t / 0.003)


def kick(vel=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 46 + 60 * np.exp(-t / 0.04)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    return vel * np.tanh(1.3 * x)


def brush(vel=0.5):
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(2, [900, 5200], "band", fs=SR, output="sos"), rng.standard_normal(n))
    return vel * x * np.minimum(1, t / 0.02) * np.exp(-t / 0.13)


def rim(vel=0.4):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.018) + 0.4 * rng.standard_normal(n) * np.exp(-t / 0.006)
    return vel * x


def shaker(vel=0.25):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(4, 6500, "high", fs=SR, output="sos"), rng.standard_normal(n))
    return vel * x * np.minimum(1, t / 0.01) * np.exp(-t / 0.03)


def swell(dur, vel=0.3):
    n = int(dur * SR)
    x = signal.sosfilt(signal.butter(2, [400, 4200], "band", fs=SR, output="sos"), rng.standard_normal(n))
    return vel * x * np.linspace(0, 1, n) ** 3


def reverb_ir(seconds=2.6, seed=5):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal((2, n)) * np.exp(-t / 0.7)
    ir = signal.sosfilt(signal.butter(2, 3800, "low", fs=SR, output="sos"), ir, axis=1)
    ir[:, : int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    return ir / np.sqrt((ir**2).sum(axis=1, keepdims=True))


def convolve_st(x, ir, wet):
    out = np.zeros_like(x)
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c])[: x.shape[1]]
    return (1 - wet) * x + wet * out * 2.0


# ---------------- score ----------------
# D major, warm and resolved: Gmaj9 -> F#m7 -> Em9 -> A13sus, landing on Dmaj9.
CHORDS = {
    "Gmaj9": ([59, 62, 66, 69], 43),
    "F#m7": ([57, 61, 64, 69], 42),
    "Em9": ([55, 59, 62, 66], 40),
    "A13": ([55, 59, 61, 66], 45),
    "Dmaj9": ([57, 61, 64, 66], 38),
    "Bm9": ([57, 61, 62, 66], 47),
}
PROG = ["Gmaj9", "F#m7", "Em9", "A13", "Gmaj9", "F#m7", "Em9", "A13", "Bm9", "Em9", "A13", "Dmaj9"]

keys = np.zeros((2, N))
pads = np.zeros((2, N))
bas = np.zeros((2, N))
drums = np.zeros((2, N))
mel = np.zeros((2, N))
fx = np.zeros((2, N))
kick_times = []

for b, name in enumerate(PROG):
    notes, root = CHORDS[name]
    last = b == BARS - 1
    hits = [(0, 3.6 * BEAT, 0.75)] if last else [(0, 1.6 * BEAT, 0.72), (2.5, 1.3 * BEAT, 0.5)]
    for beat, dur, vel in hits:
        for j, m in enumerate(notes):
            add(keys, t_of(b, beat) + j * 0.018 + rng.uniform(0, 0.005), epiano(m, dur, vel * rng.uniform(0.9, 1.0)), 0.15, pan=-0.3 + 0.6 * j / 3)
    if b >= 3:
        for j, m in enumerate(notes[:3]):
            add(pads, b * BAR, pad(m, BAR * (1.0 if not last else 1.2), 0.5), 0.05, pan=-0.4 + 0.4 * j)
    if 3 <= b <= 10:
        add(bas, t_of(b, 0), sub(root, 1.7 * BEAT), 0.40)
        add(bas, t_of(b, 2.5), sub(root + 7, 1.1 * BEAT, 0.7), 0.32)
    if last:
        add(bas, t_of(b, 0), sub(root, 3.2 * BEAT, 0.85), 0.40)

# drums: soft groove bars 5..10 (index 4..9), half-time feel in bar 11, nothing on the last bar
for b in range(4, 11):
    half = b == 10
    for beat in ([0] if half else [0, 2.5] + ([1.75] if b % 2 else [])):
        t0 = t_of(b, beat) + rng.uniform(-0.004, 0.004)
        kick_times.append(t0)
        add(drums, t0, kick(rng.uniform(0.8, 0.95)), 0.48)
    for beat in ([2] if half else [1, 3]):
        add(drums, t_of(b, beat) + 0.015, brush(rng.uniform(0.6, 0.75)), 0.36, pan=-0.1)
        add(drums, t_of(b, beat) + 0.015, rim(0.35), 0.10, pan=-0.1)
    if not half:
        for e8 in range(8):
            v = (0.28 if e8 % 2 == 0 else 0.18) * rng.uniform(0.8, 1.1)
            add(drums, t_of(b, e8 / 2) + rng.uniform(-0.006, 0.006), shaker(v), 0.30, pan=0.35)

# a soft swell into the reveal (end of bar 3) and into the end card (end of bar 11)
add(fx, t_of(2, 2.0), swell(2 * BEAT, 0.5), 0.10)
add(fx, t_of(10, 2.0), swell(2 * BEAT, 0.5), 0.08)
# bells: on the reveal, on the "refused" proof (bar 7), and on the end card
for m, d in (("A5", 0.0), ("E6", 0.12)):
    add(fx, t_of(3, 0) + d, bell(nm(m), 2.4, 0.45), 0.11)
for m, d in (("F#6", 0.0), ("D6", 0.1)):
    add(fx, t_of(6, 0) + d, bell(nm(m), 2.0, 0.4), 0.08)
for m, d in (("D6", 0.0), ("A6", 0.12), ("D7", 0.24)):
    add(fx, t_of(11, 0) + 0.04 + d, bell(nm(m), 2.6, 0.4), 0.09)

# lead motif on the e-piano an octave up, bars 6..11 (index 5..10): calm, mostly stepwise
PHRASES = {
    5: [(0.5, "F#5", 0.5), (1, "A5", 1.0), (2.5, "B5", 0.5), (3, "A5", 1)],
    6: [(0, "F#5", 1.5), (2, "E5", 2)],
    7: [(0.5, "F#5", 0.5), (1, "A5", 1), (2.5, "C#6", 0.5), (3, "B5", 1)],
    8: [(0, "A5", 1.5), (2, "F#5", 2)],
    9: [(0.5, "E5", 0.5), (1, "F#5", 1), (2.5, "A5", 1.5)],
    10: [(0, "G5", 1), (1, "F#5", 1), (2, "E5", 2)],
}
for b, ph in PHRASES.items():
    for beat, n_, d in ph:
        add(mel, t_of(b, beat), epiano(nm(n_), d * BEAT, rng.uniform(0.75, 0.9)), 0.09, pan=0.15)
dly = int(0.75 * BEAT * SR)
echo = np.zeros_like(mel)
echo[:, dly:] = mel[:, :-dly] * 0.3
echo[:, 2 * dly :] += mel[:, : -2 * dly] * 0.14
mel = mel + echo[::-1]

# ---------------- processing ----------------
t = np.arange(N) / SR
trem = 1 + 0.08 * np.sin(2 * np.pi * 3.6 * t)
keys *= np.vstack([trem, 1 + 0.08 * np.sin(2 * np.pi * 3.6 * t + 1.3)])
ir = reverb_ir()
keys = convolve_st(keys, ir, 0.32)
mel = convolve_st(mel, ir, 0.42)
pads = convolve_st(pads, ir, 0.5)
duck = np.ones(N)
for k in kick_times:
    i = int(k * SR)
    n = int(0.3 * SR)
    if i < N:
        seg = 1 - 0.28 * np.exp(-np.arange(min(n, N - i)) / SR / 0.1)
        duck[i : i + len(seg)] = np.minimum(duck[i : i + len(seg)], seg)
music = (keys + mel + pads) * duck + bas * (0.55 + 0.45 * duck)
d = 0.0009 * np.sin(2 * np.pi * 0.5 * t) + 0.00012 * np.sin(2 * np.pi * 5.7 * t)
src = np.clip(t + d, 0, DUR - 1 / SR)
music = np.vstack([np.interp(src, t, music[c]) for c in range(2)])
drums = signal.sosfilt(signal.butter(2, 8000, "low", fs=SR, output="sos"), np.tanh(1.5 * drums) / 1.5, axis=1)
crack = np.zeros(N)
idx = rng.choice(N, size=int(DUR * 14), replace=False)
crack[idx] = rng.uniform(-1, 1, len(idx)) ** 3
crack = signal.sosfilt(signal.butter(2, 1500, "high", fs=SR, output="sos"), crack) * 0.25
hiss = signal.sosfilt(signal.butter(2, 5000, "low", fs=SR, output="sos"), rng.standard_normal(N)) * 0.004
vinyl = np.vstack([crack + hiss, np.roll(crack, 41) + hiss])
mix = music + drums + fx + vinyl

# Problem bars are heard "through the wall" (low-pass 750 Hz), opening across the last beat of bar 3.
open_at = 3 * BAR
cut = np.where(t < open_at - BEAT, 750.0, np.where(t < open_at, 750 * (9000 / 750) ** ((t - (open_at - BEAT)) / BEAT), 9000.0))
out = np.zeros_like(mix)
blk = 512
zi = None
for i in range(0, N, blk):
    sos = signal.butter(2, cut[i], "low", fs=SR, output="sos")
    if zi is None:
        zi = np.zeros((2, sos.shape[0], 2))
    for c in range(2):
        out[c, i : i + blk], zi[c] = signal.sosfilt(sos, mix[c, i : i + blk], zi=zi[c])
mix = np.tanh(1.15 * out) / np.tanh(1.15)
fade = np.ones(N)
fi = int(0.4 * SR)
fo = int(2.2 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.4
mix *= fade
mix /= np.max(np.abs(mix)) / 0.89
wavfile.write(os.path.join(OUT, "music.wav"), SR, (mix.T * 32767).astype(np.int16))
json.dump(
    {"bpm": BPM, "beat": BEAT, "bar": BAR, "bars": [round(b * BAR, 4) for b in range(BARS)], "duration": DUR},
    open(os.path.join(OUT, "cues.json"), "w"),
    indent=1,
)
print(f"wrote music.wav {DUR:.3f}s, bar {BAR:.4f}s")
