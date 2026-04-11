"""Generate OpenWiki DMG background image.

Produces a multi-resolution TIFF containing both 1x (660x400) and 2x
(1320x800) representations, so macOS Finder renders it crisp on both
Retina and non-Retina displays.

Run:
    python3 scripts/gen_dmg_bg.py

Output: src-tauri/resources/dmg_background.tiff
"""

import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

# Base size matches Tauri's bundle.macOS.dmg.windowSize (660x400 logical)
BASE_W, BASE_H = 660, 400

# Colors
BG = (255, 255, 255)
TEXT = (30, 30, 40)              # near-black for the main instruction
WARN = (224, 82, 24)             # warm orange — matches brand, screams "important"

FONT_CN = "/System/Library/Fonts/STHeiti Medium.ttc"

OUT_DIR = "/Users/pipiwang/Documents/文稿 - Rich ray/xiaoyun/src-tauri/resources"
OUT_TIFF = os.path.join(OUT_DIR, "dmg_background.tiff")


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def draw_centered(draw, text: str, y: int, font, color, width: int, stroke=0):
    """Draw horizontally-centered text. `stroke` fakes bold for fonts without
    a real bold variant."""
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    tw = bbox[2] - bbox[0]
    x = (width - tw) // 2
    draw.text(
        (x, y),
        text,
        fill=color,
        font=font,
        stroke_width=stroke,
        stroke_fill=color,
    )


def render(scale: int) -> Image.Image:
    """Render the background at a given integer scale factor."""
    w, h = BASE_W * scale, BASE_H * scale
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)

    # Main instruction — big, dark
    main_font = load_font(FONT_CN, 26 * scale)
    draw_centered(
        draw,
        "拖拽 OpenWiki 到 Applications 文件夹",
        275 * scale,
        main_font,
        TEXT,
        w,
    )

    # First-launch hint — large orange for maximum attention.
    # No stroke faux-bold: CJK characters look smudgy under heavy strokes.
    hint_font = load_font(FONT_CN, 22 * scale)
    draw_centered(
        draw,
        "首次打开！请右键点击 OpenWiki → 选「打开」",
        328 * scale,
        hint_font,
        WARN,
        w,
    )

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    img_1x = render(1)
    img_2x = render(2)

    with tempfile.TemporaryDirectory() as tmp:
        p1 = os.path.join(tmp, "bg_1x.png")
        p2 = os.path.join(tmp, "bg_2x.png")
        img_1x.save(p1, "PNG")
        img_2x.save(p2, "PNG")

        # tiffutil combines both representations into one multi-resolution TIFF
        # that Finder will pick the correct size from on Retina vs non-Retina.
        subprocess.run(
            ["tiffutil", "-cathidpicheck", p1, p2, "-out", OUT_TIFF],
            check=True,
        )

    size_kb = os.path.getsize(OUT_TIFF) / 1024
    print(f"Saved: {OUT_TIFF} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
