#!/usr/bin/env python3
"""SYSTEMA — procedural album artwork generator.
Deterministic Swiss-geometric covers for the remaining catalog entries."""
import math
import random
from PIL import Image, ImageDraw, ImageFilter

S = 512  # square output
OUT = "/home/user/systema/app/public/art"


def base(color, w=S, h=S):
    img = Image.new("RGB", (w, h), color)
    return img, ImageDraw.Draw(img)


def finish(img, seed):
    # subtle print grain
    rng = random.Random(seed)
    px = img.load()
    for _ in range(900):
        x, y = rng.randrange(0, img.width, 2), rng.randrange(0, img.height, 2)
        v = rng.randint(-6, 6)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    return img


def save(img, name, seed=7):
    finish(img, seed).save(f"{OUT}/{name}.jpg", quality=92)


# --- immunity: organic chrome ribbons on deep green-black ----------------
img, d = base((8, 12, 16))
d.rectangle((0, 0, S, S), fill=(10, 14, 18))
ribs = [
    (0.0, 0.82), (0.12, 0.55), (0.3, 0.42), (0.48, 0.5), (0.62, 0.38),
    (0.78, 0.45), (0.9, 0.3), (1.02, 0.28),
]
for i in range(len(ribs) - 1):
    x1, y1 = ribs[i][0] * S, ribs[i][1] * S
    x2, y2 = ribs[i + 1][0] * S, ribs[i + 1][1] * S
    for wdt, col in ((46, (120, 132, 142)), (30, (196, 206, 214)), (12, (238, 242, 246))):
        d.line([(x1, y1), (x2, y2)], fill=col, width=wdt)
img = img.filter(ImageFilter.GaussianBlur(1.2))
save(img, "immunity", 11)


# --- havaye-gham: indigo + gold geometric star lattice --------------------
img, d = base((16, 14, 46))
gold = (196, 158, 84)
d.rectangle((0, 0, S, S), fill=(14, 12, 40))
# corner star lattice
cx, cy, r = 380, 130, 150
for k in range(8):
    ang = math.pi / 4 * k + math.pi / 8
    x = cx + r * math.cos(ang) * 0.9
    y = cy + r * math.sin(ang) * 0.9
    d.polygon(
        [(x, y - 26), (x + 9, y - 9), (x + 26, y), (x + 9, y + 9), (x, y + 26),
         (x - 9, y + 9), (x - 26, y), (x - 9, y - 9)],
        outline=gold, width=3,
    )
# concentric thin arcs
for rr in (60, 105, 150):
    d.arc((cx - rr, cy - rr, cx + rr, cy + rr), 200, 340, fill=gold, width=2)
# crescent line
d.arc((120, 300, 420, 460), 20, 200, fill=(214, 182, 110), width=5)
save(img, "havaye-gham", 5)


# --- trans-europe-express: constructivist rail perspective ----------------
img, d = base((238, 238, 234))
d.rectangle((0, 0, S, S), fill=(236, 236, 231))
# perspective grid: horizon at 200
h = 200
vp = (S // 2, h)
for i in range(-10, 11):
    x = S // 2 + i * 26
    d.line([(x, S), vp], fill=(198, 44, 38), width=3 if abs(i) < 2 else 2)
# rails
for off in (-34, 34):
    d.line([(vp[0] + off * 4, 120), (vp[0] + off, h)], fill=(18, 18, 18), width=5)
# sleepers
for t in range(6):
    y = h + (S - h) * (t / 6) ** 2
    x0 = vp[0] - 12 - t * 22
    x1 = vp[0] + 12 + t * 22
    d.line([(x0, y), (x1, y)], fill=(18, 18, 18), width=4)
# sun block
d.rectangle((0, 0, S, 90), fill=(18, 18, 18))
d.rectangle((0, 0, S, 18), fill=(198, 44, 38))
save(img, "trans-europe-express", 3)


# --- shab-e-hojom: moonlit skyline, deep blue night ------------------------
img, d = base((9, 14, 32))
d.rectangle((0, 0, S, S), fill=(8, 13, 30))
# moon
d.ellipse((330, 60, 430, 160), fill=(226, 232, 244))
d.ellipse((345, 48, 435, 138), fill=(8, 13, 30))  # crescent cut
# haze band
band = Image.new("L", (S, 200), 0)
ImageDraw.Draw(band).rectangle((0, 0, S, 200), fill=255)
band = band.filter(ImageFilter.GaussianBlur(26))
haze = Image.new("RGB", (S, 200), (26, 40, 78))
img.paste(haze, (0, 300), band)
# skyline silhouette — stepped roofs
rng = random.Random(9)
y = 330
x = 0
while x < S:
    w = rng.randint(36, 84)
    hh = rng.randint(60, 190)
    d.rectangle((x, y - hh, x + w, S), fill=(4, 7, 18))
    # occasional antenna
    if rng.random() > 0.6:
        d.rectangle((x + w // 2, y - hh - 22, x + w // 2 + 3, y - hh), fill=(4, 7, 18))
    # lit windows
    for _ in range(rng.randint(2, 6)):
        wx = x + rng.randint(4, max(5, w - 10))
        wy = y - hh + rng.randint(6, hh - 12)
        d.rectangle((wx, wy, wx + 4, wy + 6), fill=(255, 196, 120))
    x += w + 4
save(img, "shab-e-hojom", 9)


# --- power-corruption-lies: de stijl geometric bloom ------------------------
img, d = base((244, 240, 230))
d.rectangle((0, 0, S, S), fill=(244, 240, 230))
cx, cy = 256, 250
petals = [(0, -110), (104, -34), (64, 90), (-64, 90), (-104, -34)]
cols = [(198, 44, 38), (30, 60, 160), (232, 186, 40), (30, 60, 160), (198, 44, 38)]
for (dx, dy), c in zip(petals, cols):
    d.ellipse((cx + dx - 58, cy + dy - 58, cx + dx + 58, cy + dy + 58), fill=c)
d.ellipse((cx - 42, cy - 42, cx + 42, cy + 42), fill=(244, 240, 230))
d.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=(20, 20, 20))
# black bands
d.rectangle((0, 462, S, S), fill=(20, 20, 20))
d.rectangle((0, 462, 120, 512), fill=(30, 60, 160))
d.rectangle((368, 462, 512, 512), fill=(198, 44, 38))
save(img, "power-corruption-lies", 2)


# --- functional-beats: dark violet grid, glowing squares (AI playlist) -------
img, d = base((9, 7, 17))
d.rectangle((0, 0, S, S), fill=(9, 7, 17))
rng = random.Random(4)
for gy in range(4):
    for gx in range(4):
        x0 = 56 + gx * 112
        y0 = 56 + gy * 112
        d.rectangle((x0, y0, x0 + 84, y0 + 84), fill=(20, 15, 38), outline=(44, 34, 78), width=2)
        if rng.random() > 0.45:
            glow = rng.randint(0, 255)
            d.rectangle((x0 + 10, y0 + 10, x0 + 74, y0 + 74),
                        fill=(120 + glow // 3, 74 + glow // 4, 216))
# soft glow overlay
glow = Image.new("RGB", (S, S), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((80, 80, 430, 430), fill=(120, 70, 220))
glow = glow.filter(ImageFilter.GaussianBlur(70))
img = Image.blend(img, Image.blend(img, glow, 0.35), 0.5)
save(img, "functional-beats", 4)


# --- deep-focus: calm gray field, single thin line ---------------------------
img, d = base((212, 214, 218))
d.rectangle((0, 0, S, S), fill=(211, 213, 217))
# gradient darkening toward top
for i in range(200):
    shade = int(211 - i * 0.28)
    d.rectangle((0, i, S, i + 1), fill=(shade, shade + 2, shade + 6))
d.rectangle((0, 268, S, 272), fill=(244, 246, 248))
d.rectangle((0, 272, S, 275), fill=(40, 42, 46))
# small index mark
d.rectangle((64, 380, 80, 396), fill=(40, 42, 46))
save(img, "deep-focus", 6)


# --- persian-nights: midnight blue + gold constellation ----------------------
img, d = base((7, 10, 30))
d.rectangle((0, 0, S, S), fill=(6, 9, 28))
rng = random.Random(12)
stars = []
for _ in range(34):
    stars.append((rng.randrange(20, S - 20), rng.randrange(20, S - 20), rng.choice([2, 2, 3, 4])))
for x, y, r in stars:
    d.ellipse((x - r, y - r, x + r, y + r), fill=(222, 200, 140))
# constellation lines (nearest-neighbour chain)
ordered = sorted(stars, key=lambda p: (p[1] * 1.4 + p[0]))
for a, b in zip(ordered, ordered[1:]):
    if abs(a[0] - b[0]) < 130 and abs(a[1] - b[1]) < 90:
        d.line([(a[0], a[1]), (b[0], b[1])], fill=(150, 128, 82), width=1)
# big star
d.ellipse((64, 396, 108, 440), fill=(226, 206, 150))
save(img, "persian-nights", 12)


# --- art-default: Swiss blue/white/black blocks ------------------------------
img, d = base((255, 255, 255))
d.rectangle((0, 0, S, S), fill=(255, 255, 255))
d.rectangle((0, 0, S, 96), fill=(13, 20, 40))
d.rectangle((0, 96, 208, 296), fill=(29, 78, 216))
d.rectangle((208, 96, S, 200), fill=(226, 231, 240))
d.rectangle((352, 200, S, 296), fill=(198, 44, 38))
d.rectangle((0, 296, 128, S), fill=(13, 20, 40))
d.rectangle((0, 296, S, 304), fill=(13, 20, 40))
d.rectangle((240, 360, 268, 388), fill=(29, 78, 216))
d.rectangle((272, 360, 300, 388), fill=(29, 78, 216))
save(img, "art-default", 1)

print("done —", sorted(p.split("/")[-1] for p in __import__("glob").glob(f"{OUT}/*.jpg")))
