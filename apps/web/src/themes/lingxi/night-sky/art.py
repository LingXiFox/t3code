# Derived from Deepusleepy/t3-nyx-theme (MIT License, Copyright (c) 2026 Deepusleepy)
import base64
import io
from dataclasses import dataclass

import numpy as np
from PIL import Image

SUPERSAMPLE = 3


@dataclass(frozen=True)
class Sky:
    width: int
    height: int
    seed: int
    speckles: bool


# Charcoal Black deep sky + Fox Orange / Warm Amber aurora + Cream White starlight
PALETTE_HEX = [
    "#000000", "#120d0c", "#211510", "#361f14", "#542b16", "#7a3a18",
    "#a64c1c", "#d96828", "#f07c38", "#ffb478", "#692418", "#96371e",
    "#c45324", "#e8844c", "#291712", "#fff6eb",
]

BAYER_8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
]) / 64 - 0.5


def hex_rgb(value: str) -> np.ndarray:
    return np.array([int(value[i:i + 2], 16) for i in (1, 3, 5)], float)


PALETTE = np.stack([hex_rgb(h) for h in PALETTE_HEX])


def lerp(a, b, t):
    t = np.clip(t, 0, 1)
    return a + (b - a) * (t[..., None] if np.ndim(t) else t)


def paint_sky(sky: Sky) -> np.ndarray:
    ys, xs = np.mgrid[0:sky.height * SUPERSAMPLE, 0:sky.width * SUPERSAMPLE]
    u = (xs + 0.5) / (sky.width * SUPERSAMPLE)
    v = (ys + 0.5) / (sky.height * SUPERSAMPLE)

    glow = np.exp(-(((u - 0.62) / 0.5) ** 2 + ((v - 0.45) / 0.55) ** 2))
    img = hex_rgb("#120d0c") * glow[..., None] * 0.9

    center = 0.78 - u * 0.72 + 0.035 * np.sin(u * 9.0) + 0.02 * np.sin(u * 23 + 1)
    width = 0.11 + 0.05 * np.sin(u * 5 + 0.7)
    d = (v - center) / width
    band = np.exp(-d * d * 0.9) * np.clip(u * 2.2, 0, 1) * np.clip((1.05 - u) * 4, 0, 1)

    stops = [
        (-1.8, "#291712"),
        (-1.0, "#f07c38"),
        (-0.35, "#ffb478"),
        (0.1, "#d96828"),
        (0.6, "#a64c1c"),
        (1.1, "#96371e"),
        (1.7, "#e8844c"),
        (2.4, "#692418"),
    ]
    color = np.zeros_like(img) + hex_rgb(stops[0][1])
    for (d0, c0), (d1, c1) in zip(stops, stops[1:]):
        inside = ((d >= d0) & (d < d1))[..., None]
        color = np.where(inside, lerp(hex_rgb(c0), hex_rgb(c1), (d - d0) / (d1 - d0)), color)
    color = np.where((d >= stops[-1][0])[..., None], hex_rgb(stops[-1][1]), color)

    streak = 0.75 + 0.25 * np.sin(u * 60 + v * 22) * np.sin(u * 17 + 2)
    img = lerp(img, color, band * streak * 1.15)

    curtain = np.exp(-((v - (center + 0.18)) / 0.25) ** 2) * (0.5 + 0.5 * np.sin(u * 140 + np.sin(u * 13) * 3)) ** 3
    img = lerp(img, hex_rgb("#96371e"), curtain * band.clip(0.15, 1) * 0.45)

    return img.reshape(sky.height, SUPERSAMPLE, sky.width, SUPERSAMPLE, 3).mean(axis=(1, 3))


def dither(img: np.ndarray, sky: Sky) -> np.ndarray:
    height, width = sky.height, sky.width
    rng = np.random.default_rng(sky.seed)
    threshold = np.tile(BAYER_8, (height // 8 + 1, width // 8 + 1))[:height, :width]
    jittered = img + threshold[..., None] * 38
    indices = ((jittered[:, :, None, :] - PALETTE[None, None]) ** 2).sum(-1).argmin(-1).astype(np.uint8)

    dark = img.sum(-1) < 40
    if sky.speckles:
        speck = dark & (rng.random((height, width)) < 0.009)
        indices[speck] = rng.choice([1, 2, 3, 14], size=speck.sum())
    stars = dark & (rng.random((height, width)) < 0.0022)
    indices[stars] = rng.choice([8, 9, 15], size=stars.sum())
    for _ in range(10):
        y, x = rng.integers(3, int(height * 0.6)), rng.integers(3, width - 3)
        if dark[y, x]:
            indices[y, x] = 15
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                indices[y + dy, x + dx] = 9
    return indices


def encode_webp(indices: np.ndarray) -> bytes:
    image = Image.fromarray(indices, "P")
    image.putpalette([int(c) for rgb in PALETTE for c in rgb])
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "WEBP", lossless=True, quality=100, method=6, exact=True)
    return buffer.getvalue()


def build_art_data_url(sky: Sky) -> str:
    webp = encode_webp(dither(paint_sky(sky), sky))
    return "data:image/webp;base64," + base64.b64encode(webp).decode()


FOX_PALETTE: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    "k": (26, 20, 18, 255),
    "e": (20, 16, 16, 255),
    "d": (166, 65, 22, 255),
    "o": (232, 106, 44, 255),
    "h": (255, 155, 66, 255),
    "w": (255, 244, 230, 255),
    "s": (255, 248, 240, 255),
}

FOX_SPRITE = [
    "............................",
    "....kk..........kk..........",
    "...kdkk........kkdk.........",
    "...kdok........kodk.........",
    "..kohook......koohok........",
    "..kohwookkkkkkoowhok........",
    "..kooohhhhhhhhhoook.........",
    "..koohhhhhhhhhhhook.........",
    "..kooheehhhhheehook.........",
    ".kkoowsewwwwwwsewook........",
    ".kwwwwwwwwkkwwwwwwwk........",
    "..kwwwwwwwwwwwwwwwk.........",
    "...kkkkkkkkkkkkkkk....kkk...",
    "....khhhoooooooook...kwwwk..",
    "...khhwwwwwoooooook.kwwwwk..",
    "...khwwwwwwwooooookkwwwhok..",
    "..kohwwwwwwwwoooookwhoohok..",
    "..kohwwwwwwwwoooookhoooook..",
    "..koohwwwwwoooooookhooodk...",
    "..koooohoooooooooooooddk....",
    "...kwwkkoooookwwkkooddk.....",
    "...kwwk.kkkkk.kwwkkkkk......",
    "....kk.........kk...........",
    "............................",
]


def build_fox_data_url() -> str:
    height = len(FOX_SPRITE)
    width = len(FOX_SPRITE[0])
    image = Image.new("RGBA", (width, height))
    pixels = image.load()
    assert pixels is not None
    for y, row in enumerate(FOX_SPRITE):
        assert len(row) == width
        for x, ch in enumerate(row):
            pixels[x, y] = FOX_PALETTE[ch]
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", lossless=True, quality=100, method=6, exact=True)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode()
