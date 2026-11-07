#!/usr/bin/env python3
"""Original score for the Chaperone TEE clip: darkwave / synthwave, A minor, 100 BPM.
Palette (unlike the earlier lofi e-piano and kalimba/marimba cuts): detuned saw arpeggios in
16ths with a slow filter sweep, a pumping saw pad (sidechain-style gating), an 8th-note analog
bass, a sine-sweep kick, offbeat hats and a clap. Everything is synthesised here; nothing to
license. Usage: python3 music.py <seconds> -> music.wav"""
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BPM = 100.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 68.0
BARS = int(np.ceil((DUR + 1.0) / BAR))
N = int(BARS * BAR * SR)
OUT = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def saw(f, t):
    return 2.0 * ((f * t) % 1.0) - 1.0


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR / 2 - 100) / (SR / 2), "low")
    return signal.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def put(x, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    x = x[: N - i] * gain
    L[i:i + len(x)] += x * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(x)] += x * np.sqrt(0.5 * (1 + pan))


# Am - F - C - G, one bar each (root notes and triads, MIDI)
CHORDS = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [48, 52, 55]), (55, [55, 59, 62])]


def chord(bar):
    return CHORDS[bar % 4]


def env_ad(n, a, d):
    t = np.arange(n) / SR
    e = np.minimum(t / a, 1.0) * np.exp(-np.maximum(t - a, 0) / d)
    return e


# ---------------------------------------------------------------- arp (16ths)
ARP = [0, 1, 2, 3, 2, 1, 4, 2]
for bar in range(BARS):
    _, triad = chord(bar)
    tones = [triad[0], triad[1], triad[2], triad[0] + 12, triad[1] + 12]
    sweep = 900 + 2600 * (0.5 - 0.5 * np.cos(2 * np.pi * bar / 16))  # slow filter breathing
    if bar < 2:
        sweep = 700 + 300 * bar
    for s in range(16):
        m = tones[ARP[s % 8]] + 12
        n = int(0.16 * SR)
        t = np.arange(n) / SR
        f = mtof(m)
        x = 0.5 * saw(f * 1.004, t) + 0.5 * saw(f * 0.996, t)
        x = lp(x, sweep) * env_ad(n, 0.003, 0.09)
        put(x, bar * BAR + s * BEAT / 4, 0.16, -0.45 if s % 2 else 0.45)
        # dotted-8th echo, quieter and darker
        put(lp(x, sweep * 0.6), bar * BAR + s * BEAT / 4 + 0.75 * BEAT, 0.06, 0.45 if s % 2 else -0.45)

# ---------------------------------------------------------------- pad (pumping)
for bar in range(BARS):
    _, triad = chord(bar)
    n = int(BAR * SR) + int(0.3 * SR)
    t = np.arange(n) / SR
    padL = np.zeros(n)
    padR = np.zeros(n)
    for m in triad:
        f = mtof(m - 12)
        padL += saw(f * 0.997, t) + saw(f * 1.006, t)
        padR += saw(f * 1.003, t) + saw(f * 0.994, t)
    att = np.minimum(t / 0.25, 1.0) * np.minimum(1.0, (n / SR - t) / 0.3)
    pump = 1 - 0.65 * np.exp(-((t % BEAT) / 0.11))
    g = 0.035 if bar >= 2 else 0.05
    i = int(bar * BAR * SR)
    k = min(n, N - i)
    L[i:i + k] += (lp(padL, 1100) * att * pump)[:k] * g
    R[i:i + k] += (lp(padR, 1100) * att * pump)[:k] * g

# ---------------------------------------------------------------- bass (8ths)
for bar in range(2, BARS):
    root, _ = chord(bar)
    for e in range(8):
        n = int(0.28 * SR)
        t = np.arange(n) / SR
        f = mtof(root - 24 + (12 if e in (3, 7) else 0))
        x = 0.6 * saw(f, t) + 0.4 * np.sign(np.sin(2 * np.pi * f * t))
        x = lp(x, 380, 3) * env_ad(n, 0.004, 0.16)
        put(x, bar * BAR + e * BEAT / 2, 0.30)

# ---------------------------------------------------------------- drums
def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.14)


def hat():
    n = int(0.05 * SR)
    return hp(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR / 0.012)


def clap():
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = signal.lfilter(*signal.butter(2, [900 / (SR / 2), 3200 / (SR / 2)], "band"), rng.standard_normal(n))
    e = np.exp(-t / 0.06) * (1 + 0.6 * ((t % 0.012) < 0.004) * (t < 0.03))
    return noise * e


K, H, C = kick(), hat(), clap()
last_drum_bar = BARS - 3
for bar in range(2, last_drum_bar):
    for b in range(4):
        put(K, bar * BAR + b * BEAT, 0.55)
        if bar >= 4:
            put(H, bar * BAR + b * BEAT + BEAT / 2, 0.10, 0.25)
        if bar >= 6 and b in (1, 3):
            put(C, bar * BAR + b * BEAT, 0.16, -0.1)

# ---------------------------------------------------------------- master
mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.6) / 1.6
end = int(DUR * SR)
mix = mix[:end]
fade = int(2.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
mix /= np.max(np.abs(mix)) / 0.89
wavfile.write(os.path.join(OUT, "music.wav"), SR, (mix * 32767).astype(np.int16))
print(f"music.wav {DUR:.1f}s, {BARS} bars at {BPM:.0f} BPM")
