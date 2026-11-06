#!/usr/bin/env python3
"""Original score for the Chaperone launch ad: organic ambient electronica, E major.
80 BPM, 12 bars = 36.0 s exactly (scene cuts land on bar lines every 3 s).
Palette (deliberately unlike earlier lofi cuts): kalimba arpeggios, bowed-string pad, marimba bass,
hand percussion (wood block, shaker, low tom), a heartbeat pulse under the problem section.
Everything is synthesised here; nothing to license. Writes music.wav and cues.json."""
import json
import os

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BPM = 80.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
BARS = 12
DUR = BARS * BAR
N = int(round(DUR * SR))
rng = np.random.default_rng(23)
OUT = os.path.dirname(os.path.abspath(__file__))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, start_s, x, gain=1.0, pan=0.0):
    i = int(round(start_s * SR))
    if i >= buf.shape[1] or i < 0:
        return
    x = x[: buf.shape[1] - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i : i + len(x)] += gain * l * x
    buf[1, i : i + len(x)] += gain * r * x


def tb(bar, beat):
    return bar * BAR + beat * BEAT


# ---------------- instruments ----------------
def kalimba(m, vel=0.7, length=1.8):
    """Tine: fundamental, a fast inharmonic overtone (~5.4x), and a soft thumb click."""
    f = mtof(m)
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.75)
    x += 0.35 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / 0.06)
    x += 0.12 * np.sin(2 * np.pi * 2.0 * f * t + 0.3) * np.exp(-t / 0.25)
    click = signal.sosfilt(signal.butter(2, [1500, 4500], "band", fs=SR, output="sos"), rng.standard_normal(n)) * np.exp(-t / 0.004) * 0.25
    return vel * (x + click) * np.minimum(1, t / 0.0015)


def marimba(m, vel=0.8, length=1.4):
    f = mtof(m)
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.45) + 0.25 * np.sin(2 * np.pi * 4.0 * f * t) * np.exp(-t / 0.05)
    return vel * x * np.minimum(1, t / 0.003)


def strings(m, dur, vel=0.5):
    """Bowed pad: detuned saws, slow bow attack, low-passed, gentle vibrato."""
    f = mtof(m)
    n = int((dur + 1.6) * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 4.8 * t + rng.uniform(0, 6))
    x = np.zeros(n)
    for d in (-0.08, -0.02, 0.03, 0.09):
        ph = 2 * np.pi * f * (1 + d / 12) * np.cumsum(vib) / SR + rng.uniform(0, 6)
        x += signal.sawtooth(ph) * 0.25
    x = signal.sosfilt(signal.butter(2, 1700, "low", fs=SR, output="sos"), x)
    e = np.minimum(1, t / 1.4) ** 1.5 * np.where(t < dur, 1, np.clip(1 - (t - dur) / 1.6, 0, 1))
    return vel * x * e


def heartbeat(vel=0.8):
    """Two soft low thumps (lub-dub)."""
    out = np.zeros(int(0.7 * SR))
    for off, v in ((0.0, 1.0), (0.22, 0.65)):
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        f = 42 + 30 * np.exp(-t / 0.03)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)
        i = int(off * SR)
        out[i : i + n] += v * x[: len(out) - i]
    return vel * out


def tom(vel=0.6):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 82 + 50 * np.exp(-t / 0.05)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.25)


def woodblock(vel=0.4, f=1250):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.022) + 0.4 * np.sin(2 * np.pi * f * 2.7 * t) * np.exp(-t / 0.008)
    return vel * x


def shaker(vel=0.25):
    n = int(0.11 * SR)
    t = np.arange(n) / SR
    x = signal.sosfilt(signal.butter(4, [5000, 11000], "band", fs=SR, output="sos"), rng.standard_normal(n))
    return vel * x * np.minimum(1, t / 0.02) * np.exp(-t / 0.035)


def air(dur, vel=0.3, rising=True):
    n = int(dur * SR)
    x = signal.sosfilt(signal.butter(2, [600, 6000], "band", fs=SR, output="sos"), rng.standard_normal(n))
    e = np.linspace(0, 1, n) ** 2.5 if rising else np.linspace(1, 0, n) ** 2
    return vel * x * e


def reverb_ir(seconds=3.4, seed=9):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal((2, n)) * np.exp(-t / 0.95)
    ir = signal.sosfilt(signal.butter(2, 5200, "low", fs=SR, output="sos"), ir, axis=1)
    ir[:, : int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))
    return ir / np.sqrt((ir**2).sum(axis=1, keepdims=True))


def convolve_st(x, ir, wet):
    out = np.zeros_like(x)
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c])[: x.shape[1]]
    return (1 - wet) * x + wet * out * 2.0


# ---------------- harmony ----------------
# E major: E - B - C#m - A, then F#m and A to lift into the resolution on E.
CH = {
    "E": [52, 56, 59, 63, 66], "B": [47, 54, 59, 61, 63], "C#m": [49, 56, 59, 61, 64],
    "A": [45, 52, 57, 59, 64], "F#m": [42, 49, 54, 57, 61], "Esus": [52, 57, 59, 64, 66],
}
PROG = ["E", "C#m", "A", "B", "E", "B", "C#m", "A", "F#m", "A", "B", "E"]

kal = np.zeros((2, N))
pad = np.zeros((2, N))
low = np.zeros((2, N))
perc = np.zeros((2, N))
fx = np.zeros((2, N))
pulses = []

for b, name in enumerate(PROG):
    notes = CH[name]
    root = notes[0]
    if b < 3:
        # Problem: sparse, a little uneasy. Single kalimba notes on beats 1 and 3, heartbeat on 1.
        for beat, j in ((0, 2), (2, 4), (3.5, 3)):
            add(kal, tb(b, beat), kalimba(notes[j] + 12, 0.55), 0.20, pan=0.35 * (j - 2) / 2)
        add(low, tb(b, 0), heartbeat(0.9), 0.55)
        pulses.append(tb(b, 0))
    else:
        # Product: flowing 16th-note arpeggio, up-down shape, slightly humanised.
        shape = [0, 2, 3, 4, 3, 2, 1, 2] if b % 2 else [0, 1, 2, 4, 3, 4, 2, 3]
        steps = 16 if b < BARS - 1 else 8
        for s in range(steps):
            j = shape[s % 8]
            oct_ = 12 if s % 8 < 4 else 24
            vel = (0.75 if s % 4 == 0 else 0.5) * rng.uniform(0.85, 1.0)
            add(kal, tb(b, s / 4) + rng.uniform(0, 0.006), kalimba(notes[j] + oct_ - 12, vel, 1.5), 0.17, pan=-0.5 + (s % 8) / 7)
        # strings from the reveal on
        for j, m in enumerate(notes[:4]):
            add(pad, b * BAR, strings(m + 12 if j else m, BAR * (1.0 if b < BARS - 1 else 1.3), 0.5), 0.045, pan=-0.45 + 0.3 * j)
        # marimba bass on 1 and the "and" of 2
        if b < BARS - 1:
            add(low, tb(b, 0), marimba(root - 12, 0.9), 0.42)
            add(low, tb(b, 1.5), marimba(root - 5, 0.6), 0.30)
        else:
            add(low, tb(b, 0), marimba(root - 12, 0.9, 2.4), 0.45)

# hand percussion bars 5..11 (index 4..10)
for b in range(4, 11):
    for beat in (0, 2.75):
        add(perc, tb(b, beat), tom(0.7 if beat == 0 else 0.45), 0.42)
        pulses.append(tb(b, beat))
    for beat in (1, 3):
        add(perc, tb(b, beat) + 0.01, woodblock(0.45, 1180), 0.20, pan=-0.3)
    if b % 2:
        add(perc, tb(b, 3.5), woodblock(0.3, 1560), 0.14, pan=0.3)
    for s in range(8):
        add(perc, tb(b, s / 2) + rng.uniform(-0.004, 0.004), shaker((0.3 if s % 2 else 0.2) * rng.uniform(0.8, 1.1)), 0.32, pan=0.4)

# transitions: air rising into the reveal (bar 4) and into the end card (bar 12); a soft gust after the refusal (bar 7)
add(fx, tb(2, 1), air(3 * BEAT, 0.5), 0.12)
add(fx, tb(10, 2), air(2 * BEAT, 0.5), 0.09)
add(fx, tb(6, 0), air(1.2, 0.4, rising=False), 0.07)
# high kalimba "sparkle" on the reveal and on the end card
for k, m in enumerate((76, 80, 83, 88)):
    add(fx, tb(3, 0) + k * 0.06, kalimba(m, 0.5, 2.2), 0.10, pan=-0.4 + 0.27 * k)
for k, m in enumerate((88, 83, 80, 76, 71)):
    add(fx, tb(11, 0) + 0.05 + k * 0.09, kalimba(m, 0.45, 2.5), 0.09, pan=0.4 - 0.2 * k)

# ---------------- mix ----------------
t = np.arange(N) / SR
ir = reverb_ir()
# ping-pong dotted-eighth delay on the kalimba
dly = int(0.75 * BEAT * SR)
echo = np.zeros_like(kal)
echo[0, dly:] = kal[1, :-dly] * 0.32
echo[1, 2 * dly :] = kal[0, : -2 * dly] * 0.2
kal = kal + echo
kal = convolve_st(kal, ir, 0.38)
pad = convolve_st(pad, ir, 0.55)
perc = convolve_st(perc, ir, 0.18)
fx = convolve_st(fx, ir, 0.5)
duck = np.ones(N)
for k in pulses:
    i = int(k * SR)
    n = int(0.32 * SR)
    if i < N:
        seg = 1 - 0.22 * np.exp(-np.arange(min(n, N - i)) / SR / 0.12)
        duck[i : i + len(seg)] = np.minimum(duck[i : i + len(seg)], seg)
mix = (kal + pad) * duck + low + perc + fx
# problem bars sit darker (low-pass 1.6 kHz), opening across the last beat of bar 3
open_at = 3 * BAR
cut = np.where(t < open_at - BEAT, 1600.0, np.where(t < open_at, 1600 * (12000 / 1600) ** ((t - (open_at - BEAT)) / BEAT), 12000.0))
out = np.zeros_like(mix)
blk = 512
zi = None
for i in range(0, N, blk):
    sos = signal.butter(2, cut[i], "low", fs=SR, output="sos")
    if zi is None:
        zi = np.zeros((2, sos.shape[0], 2))
    for c in range(2):
        out[c, i : i + blk], zi[c] = signal.sosfilt(sos, mix[c, i : i + blk], zi=zi[c])
mix = np.tanh(1.1 * out) / np.tanh(1.1)
fade = np.ones(N)
fi = int(0.3 * SR)
fo = int(2.4 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.3
mix *= fade
mix /= np.max(np.abs(mix)) / 0.89
wavfile.write(os.path.join(OUT, "music.wav"), SR, (mix.T * 32767).astype(np.int16))
json.dump(
    {"bpm": BPM, "beat": BEAT, "bar": BAR, "bars": [round(b * BAR, 4) for b in range(BARS)], "duration": DUR,
     "palette": "organic ambient electronica: kalimba, bowed strings, marimba bass, hand percussion, heartbeat"},
    open(os.path.join(OUT, "cues.json"), "w"),
    indent=1,
)
print(f"wrote music.wav {DUR:.3f}s, bar {BAR:.4f}s")
