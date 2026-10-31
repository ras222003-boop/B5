"""Procedural drawings of household objects (pilot, 8 classes), composited onto backgrounds cut from the owner's own
room photos. Pure numpy/Pillow, no external assets, nothing downloaded. Everything is stylised on purpose: the question
this pilot answers is whether such drawings carry any signal for recognising the REAL objects.
Usage: render.py <out-dir> <per-class> <background-photos-dir>
"""
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 4  # supersampling
W = H = 256


def clamp(c):
    return tuple(int(max(0, min(255, v))) for v in c)


class Painter:
    """RGBA layer with cylinder/box shading helpers (all coordinates in 0..W space)."""

    def __init__(self):
        self.img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))

    def _mask(self, draw_fn):
        m = Image.new("L", self.img.size, 0)
        draw_fn(ImageDraw.Draw(m))
        return m

    def paint(self, draw_fn, color, shade="none", strength=0.5, alpha=255, edge=None):
        mask = self._mask(draw_fn)
        arr = np.asarray(mask, dtype=np.float32) / 255
        ys, xs = np.nonzero(arr > 0.5)
        if not len(xs):
            return
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        grad = np.ones_like(arr)
        yy, xx = np.mgrid[0 : arr.shape[0], 0 : arr.shape[1]]
        if shade == "cyl":  # lit from upper left, dark on the right limb
            u = (xx - x0) / max(1, x1 - x0)
            grad = 1.08 - strength * ((u - 0.35) * 1.6) ** 2
        elif shade == "vert":
            v = (yy - y0) / max(1, y1 - y0)
            grad = 1.05 - strength * v
        elif shade == "dome":
            u = (xx - x0) / max(1, x1 - x0)
            v = (yy - y0) / max(1, y1 - y0)
            grad = 1.1 - strength * (((u - 0.4) * 1.5) ** 2 + ((v - 0.3) * 1.3) ** 2)
        base = np.empty(arr.shape + (3,), dtype=np.float32)
        for k in range(3):
            base[..., k] = color[k] * np.clip(grad, 0.15, 1.3)
        layer = np.dstack([np.clip(base, 0, 255), arr * alpha]).astype(np.uint8)
        part = Image.fromarray(layer, "RGBA")
        self.img = Image.alpha_composite(self.img, part)
        if edge:
            ImageDraw.Draw(self.img).line  # edges are drawn by callers when needed

    def done(self):
        return self.img.resize((W, H), Image.LANCZOS)


def rrect(d, box, r, fill=255):
    d.rounded_rectangle([v * S for v in box], radius=r * S, fill=fill)


def ellipse(d, box, fill=255):
    d.ellipse([v * S for v in box], fill=fill)


def poly(d, pts, fill=255):
    d.polygon([(x * S, y * S) for x, y in pts], fill=fill)


def line(d, a, b, w, fill=255):
    d.line([a[0] * S, a[1] * S, b[0] * S, b[1] * S], fill=fill, width=int(w * S))


def jitter(rng, c, a=18):
    return clamp([v + rng.uniform(-a, a) for v in c])


# ---- classes -------------------------------------------------------------------------------------------------------
def air_fryer(p, rng):
    body = jitter(rng, rng.choice([(40, 30, 30), (30, 30, 34), (70, 50, 45)]))
    p.paint(lambda d: rrect(d, (70, 70, 190, 220), 38), body, "cyl", 0.55)
    p.paint(lambda d: ellipse(d, (70, 52, 190, 110)), jitter(rng, [min(255, v + 25) for v in body]), "dome", 0.5)
    p.paint(lambda d: rrect(d, (100, 78, 160, 92), 6), jitter(rng, (25, 25, 25)))  # vent
    p.paint(lambda d: rrect(d, (160, 128, 205, 148), 9), jitter(rng, (150, 110, 100)), "cyl", 0.4)  # handle
    p.paint(lambda d: rrect(d, (118, 118, 148, 126), 3), jitter(rng, (200, 200, 200)))  # panel


def kettle(p, rng):
    body = jitter(rng, rng.choice([(25, 25, 28), (190, 190, 195), (50, 40, 40)]))
    p.paint(lambda d: poly(d, [(86, 70), (170, 70), (184, 215), (72, 215)]), body, "cyl", 0.6)
    p.paint(lambda d: ellipse(d, (90, 60, 166, 84)), jitter(rng, [min(255, v + 30) for v in body]), "dome", 0.4)
    p.paint(lambda d: poly(d, [(86, 88), (50, 62), (60, 56), (92, 78)]), body, "cyl", 0.5)  # spout
    p.paint(lambda d: (line(d, (176, 90), (216, 100), 9), line(d, (216, 100), (206, 190), 9), line(d, (206, 190), (180, 198), 9)), jitter(rng, (35, 35, 35)))  # handle
    p.paint(lambda d: ellipse(d, (160, 56, 176, 70)), jitter(rng, (30, 30, 30)))


def trash_bin(p, rng):
    col = jitter(rng, rng.choice([(35, 35, 38), (60, 60, 64), (120, 90, 60)]))
    p.paint(lambda d: poly(d, [(70, 80), (186, 80), (166, 220), (90, 220)]), col, "cyl", 0.5, alpha=235)
    p.paint(lambda d: ellipse(d, (70, 70, 186, 96)), jitter(rng, [v // 2 for v in col]), "dome", 0.3)
    for y in range(100, 216, 14):
        p.paint(lambda d, y=y: line(d, (74 + (y - 80) * 0.14, y), (182 - (y - 80) * 0.14, y), 1.6), jitter(rng, [v + 50 for v in col]))
    for x in range(86, 172, 12):
        p.paint(lambda d, x=x: line(d, (x, 98), (x + (128 - x) * 0.18, 216), 1.2), jitter(rng, [v + 40 for v in col]))


def microwave_oven(p, rng):
    body = jitter(rng, rng.choice([(30, 30, 32), (200, 200, 205), (60, 60, 66)]))
    p.paint(lambda d: rrect(d, (40, 90, 216, 200), 8), body, "vert", 0.35)
    p.paint(lambda d: rrect(d, (52, 102, 148, 186), 5), jitter(rng, (15, 15, 18)), "dome", 0.35)
    p.paint(lambda d: ellipse(d, (160, 112, 184, 136)), jitter(rng, (170, 170, 175)), "dome", 0.5)
    p.paint(lambda d: ellipse(d, (160, 146, 184, 170)), jitter(rng, (170, 170, 175)), "dome", 0.5)
    p.paint(lambda d: rrect(d, (190, 108, 206, 180), 3), jitter(rng, (90, 90, 95)))
    for x in (60, 190):
        p.paint(lambda d, x=x: rrect(d, (x, 198, x + 14, 206), 2), jitter(rng, (20, 20, 20)))


def fridge(p, rng):
    body = jitter(rng, rng.choice([(225, 225, 220), (235, 232, 225), (190, 190, 195)]), 10)
    p.paint(lambda d: rrect(d, (78, 20, 186, 236), 6), body, "cyl", 0.22)
    p.paint(lambda d: line(d, (78, 98), (186, 98), 2.2), jitter(rng, (110, 110, 110)))
    p.paint(lambda d: rrect(d, (90, 60, 96, 92), 2), jitter(rng, (150, 150, 150)))
    p.paint(lambda d: rrect(d, (90, 112, 96, 176), 2), jitter(rng, (150, 150, 150)))
    p.paint(lambda d: rrect(d, (120, 30, 156, 44), 3), rng.choice([(200, 40, 40), (40, 80, 160), (60, 60, 60)]))


def water_dispenser(p, rng):
    body = jitter(rng, (225, 228, 232), 10)
    p.paint(lambda d: rrect(d, (82, 96, 176, 236), 6), body, "cyl", 0.25)
    p.paint(lambda d: rrect(d, (92, 130, 166, 152), 4), jitter(rng, (50, 110, 190)), "vert", 0.2)
    p.paint(lambda d: rrect(d, (92, 168, 166, 190), 4), jitter(rng, (50, 110, 190)), "vert", 0.2)
    p.paint(lambda d: rrect(d, (118, 112, 140, 124), 2), jitter(rng, (200, 60, 60)))
    jug = jitter(rng, rng.choice([(80, 130, 110), (70, 110, 150), (60, 90, 70)]))
    p.paint(lambda d: rrect(d, (92, 16, 166, 98), 22), jug, "cyl", 0.5, alpha=215)
    p.paint(lambda d: rrect(d, (118, 8, 140, 22), 4), jitter(rng, (50, 70, 60)))


def split_ac(p, rng):
    body = jitter(rng, (238, 238, 240), 8)
    p.paint(lambda d: rrect(d, (22, 70, 234, 150), 10), body, "vert", 0.28)
    p.paint(lambda d: rrect(d, (34, 128, 222, 140), 4), jitter(rng, (205, 205, 208)))
    p.paint(lambda d: rrect(d, (176, 90, 214, 100), 2), jitter(rng, (60, 60, 70)))
    p.paint(lambda d: ellipse(d, (200, 110, 206, 116)), rng.choice([(60, 200, 90), (230, 60, 60)]))
    p.paint(lambda d: line(d, (30, 76), (226, 76), 1.4), jitter(rng, (210, 210, 212)))


def oil_heater(p, rng):
    col = jitter(rng, (232, 230, 224), 12)
    for i in range(9):
        x = 70 + i * 15
        p.paint(lambda d, x=x: rrect(d, (x, 42, x + 11, 210), 5), col, "cyl", 0.38)
    p.paint(lambda d: rrect(d, (44, 62, 80, 214), 6), jitter(rng, (240, 240, 238), 8), "cyl", 0.25)
    p.paint(lambda d: ellipse(d, (50, 130, 72, 152)), jitter(rng, (225, 225, 225)), "dome", 0.5)
    p.paint(lambda d: rrect(d, (52, 74, 74, 90), 2), jitter(rng, (150, 150, 150)))
    p.paint(lambda d: ellipse(d, (62, 214, 82, 232)), jitter(rng, (30, 30, 30)), "dome", 0.5)
    p.paint(lambda d: ellipse(d, (186, 214, 206, 232)), jitter(rng, (30, 30, 30)), "dome", 0.5)
    p.paint(lambda d: (line(d, (80, 60), (60, 18), 2.5), line(d, (60, 18), (30, 24), 2.5)), (28, 28, 28))


def dishwasher(p, rng):
    body = jitter(rng, rng.choice([(238, 238, 240), (210, 210, 214), (60, 60, 64)]), 8)
    p.paint(lambda d: rrect(d, (52, 24, 204, 236), 5), body, "vert", 0.22)
    p.paint(lambda d: rrect(d, (52, 24, 204, 56), 4), jitter(rng, [v - 40 for v in body]), "vert", 0.15)
    for x in (70, 96, 122):
        p.paint(lambda d, x=x: ellipse(d, (x, 34, x + 10, 44)), jitter(rng, (230, 230, 230)))
    p.paint(lambda d: rrect(d, (172, 36, 194, 46), 2), jitter(rng, (60, 200, 120)))
    p.paint(lambda d: rrect(d, (76, 74, 180, 82), 3), jitter(rng, (150, 150, 155)), "cyl", 0.3)
    p.paint(lambda d: rrect(d, (52, 216, 204, 236), 3), jitter(rng, (40, 40, 44)))


def wardrobe(p, rng):
    wood = jitter(rng, rng.choice([(190, 150, 100), (150, 100, 60), (225, 205, 170)]), 14)
    p.paint(lambda d: rrect(d, (42, 10, 214, 244), 4), wood, "vert", 0.28)
    p.paint(lambda d: line(d, (128, 14), (128, 240), 2.4), jitter(rng, [v - 60 for v in wood]))
    p.paint(lambda d: rrect(d, (116, 112, 122, 152), 2), jitter(rng, (170, 170, 175)))
    p.paint(lambda d: rrect(d, (134, 112, 140, 152), 2), jitter(rng, (170, 170, 175)))
    p.paint(lambda d: rrect(d, (50, 18, 120, 34), 2), jitter(rng, [v - 25 for v in wood]))
    p.paint(lambda d: rrect(d, (136, 18, 206, 34), 2), jitter(rng, [v - 25 for v in wood]))


def window_ac(p, rng):
    body = jitter(rng, rng.choice([(235, 230, 215), (220, 220, 222), (200, 190, 170)]), 10)
    p.paint(lambda d: rrect(d, (26, 66, 230, 196), 8), body, "vert", 0.3)
    p.paint(lambda d: rrect(d, (44, 86, 156, 176), 4), jitter(rng, [v - 45 for v in body]))
    for x in range(50, 152, 7):
        p.paint(lambda d, x=x: line(d, (x, 90), (x, 172), 1.6), jitter(rng, [v - 95 for v in body]))
    p.paint(lambda d: ellipse(d, (176, 92, 202, 118)), jitter(rng, (150, 150, 150)), "dome", 0.5)
    p.paint(lambda d: ellipse(d, (176, 132, 202, 158)), jitter(rng, (150, 150, 150)), "dome", 0.5)
    p.paint(lambda d: rrect(d, (170, 168, 214, 178), 2), jitter(rng, (90, 90, 90)))


def bathroom_scale(p, rng):
    body = jitter(rng, rng.choice([(190, 195, 205), (230, 230, 232), (60, 60, 64)]), 12)
    p.paint(lambda d: poly(d, [(60, 120), (196, 120), (214, 214), (42, 214)]), body, "vert", 0.3)
    for y in range(140, 208, 9):
        p.paint(lambda d, y=y: line(d, (56 - (y - 120) * 0.0, y), (200, y), 1.4), jitter(rng, [v - 40 for v in body]))
    p.paint(lambda d: rrect(d, (96, 124, 160, 142), 5), jitter(rng, (235, 235, 230)), "dome", 0.25)
    p.paint(lambda d: ellipse(d, (118, 126, 138, 140)), jitter(rng, (120, 120, 120)))


def robot_vacuum(p, rng):
    body = jitter(rng, rng.choice([(40, 40, 44), (220, 220, 224), (70, 50, 40)]), 10)
    p.paint(lambda d: ellipse(d, (34, 96, 222, 214)), body, "dome", 0.45)
    p.paint(lambda d: ellipse(d, (64, 112, 192, 196)), jitter(rng, [min(255, v + 18) for v in body]), "dome", 0.3)
    p.paint(lambda d: ellipse(d, (112, 134, 144, 160)), jitter(rng, (190, 190, 195)), "dome", 0.4)
    p.paint(lambda d: rrect(d, (84, 100, 172, 110), 4), jitter(rng, [v + 30 for v in body]))
    p.paint(lambda d: ellipse(d, (118, 102, 138, 112)), jitter(rng, (30, 30, 30)))


def pressure_cooker(p, rng):
    metal = jitter(rng, rng.choice([(170, 172, 178), (120, 120, 124), (60, 60, 64)]), 12)
    p.paint(lambda d: rrect(d, (62, 112, 194, 218), 8), metal, "cyl", 0.55)
    p.paint(lambda d: rrect(d, (56, 90, 200, 124), 14), jitter(rng, [v + 18 for v in metal]), "dome", 0.5)
    p.paint(lambda d: rrect(d, (118, 70, 138, 94), 5), jitter(rng, (40, 40, 40)))
    p.paint(lambda d: rrect(d, (28, 138, 66, 152), 6), jitter(rng, (35, 35, 35)))
    p.paint(lambda d: rrect(d, (190, 138, 228, 152), 6), jitter(rng, (35, 35, 35)))
    p.paint(lambda d: ellipse(d, (150, 76, 168, 92)), jitter(rng, (200, 60, 50)), "dome", 0.5)


CLASSES = {
    "air_fryer": air_fryer, "kettle": kettle, "trash_bin": trash_bin, "microwave_oven": microwave_oven,
    "fridge": fridge, "water_dispenser": water_dispenser, "split_ac": split_ac, "oil_heater": oil_heater,
    "dishwasher": dishwasher, "wardrobe": wardrobe, "window_ac": window_ac, "bathroom_scale": bathroom_scale,
    "robot_vacuum": robot_vacuum, "pressure_cooker": pressure_cooker,
}


def clean(crop):
    """No annotation overlay: no mint-green outline, no red outline, no white label pill."""
    a = np.asarray(crop, dtype=np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mint = ((r < 120) & (g > 200) & (b > 100) & (b < 200)).mean()
    red = ((r > 215) & (g < 60) & (b < 60)).mean()
    white = ((r > 246) & (g > 246) & (b > 246)).mean()
    return mint < 0.0005 and red < 0.0005 and white < 0.004


def background(rng, photos):
    if photos and rng.random() < 0.8:
        im = Image.open(rng.choice(photos)).convert("RGB")
        w, h = im.size
        for _ in range(40):
            s = rng.randint(min(w, h) // 4, min(w, h) // 2)
            x, y = rng.randint(0, w - s), rng.randint(0, h - s)
            crop = im.crop((x, y, x + s, y + s)).resize((W, H), Image.BILINEAR)
            if clean(crop):
                return crop.filter(ImageFilter.GaussianBlur(rng.choice([0, 0.8, 1.6])))
    c = [rng.randint(60, 200) for _ in range(3)]
    arr = np.ones((H, W, 3)) * c + np.linspace(-25, 25, H)[:, None, None] + np.random.default_rng(rng.randint(0, 9999)).normal(0, 6, (H, W, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def compose(cls, rng, photos):
    p = Painter()
    CLASSES[cls](p, rng)
    layer = p.done()
    scale = rng.uniform(0.55, 1.0)
    angle = rng.uniform(-9, 9)
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=False)
    # mild perspective skew
    sk = rng.uniform(-0.12, 0.12)
    layer = layer.transform(layer.size, Image.AFFINE, (1, sk, -sk * H / 2, 0, 1, 0), resample=Image.BICUBIC)
    nw = int(W * scale)
    layer = layer.resize((nw, nw), Image.LANCZOS)
    bg = background(rng, photos)
    ox, oy = rng.randint(-10, W - nw + 10), rng.randint(0, max(1, H - nw))
    shadow = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 90))
    sh.putalpha(layer.getchannel("A").point(lambda v: int(v * 0.35)))
    shadow.paste(sh, (ox + 6, oy + 8), sh)
    out = Image.alpha_composite(bg.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(5)))
    out.alpha_composite(layer, (ox, oy)) if 0 <= ox <= W - nw and 0 <= oy <= H - nw else out.paste(layer, (ox, oy), layer)
    img = out.convert("RGB")
    gain = rng.uniform(0.6, 1.25)
    arr = np.clip(np.asarray(img, dtype=np.float32) * gain + np.random.default_rng(rng.randint(0, 9999)).normal(0, rng.choice([0, 3, 7]), (H, W, 3)), 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)
    if rng.random() < 0.3:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 1.4)))
    return img


def main():
    out = Path(sys.argv[1])
    per = int(sys.argv[2])
    photos = sorted(Path(sys.argv[3]).glob("*.jpg")) if len(sys.argv) > 3 else []
    if out.exists():
        raise SystemExit("refusing to overwrite " + str(out))
    out.mkdir(parents=True)
    meta = []
    for ci, cls in enumerate(CLASSES):
        for i in range(per):
            rng = random.Random(f"{cls}-{i}-pilot1")
            img = compose(cls, rng, photos)
            name = f"{cls}-{i:03d}.jpg"
            img.save(out / name, "JPEG", quality=90)
            meta.append({"file": name, "class": cls})
    (out / "index.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(json.dumps({"images": len(meta), "classes": list(CLASSES)}))


if __name__ == "__main__":
    main()
