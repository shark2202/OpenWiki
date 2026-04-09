#!/usr/bin/env python3
"""
OpenWiki Logo v4 — "Compile"

Fixes: mark fills more of the icon space, thicker strokes for clarity.
"""

import math
from PIL import Image, ImageDraw, ImageFont
import os

FONT_DIR = "/Users/pipiwang/.claude/plugins/cache/anthropic-agent-skills/document-skills/98669c11ca63/skills/canvas-design/canvas-fonts"

ACCENT = (249, 115, 22)       # #F97316
BG_DARK = (12, 10, 9)         # #0C0A09
TEXT_PRIMARY = (250, 250, 248) # #FAFAF8
TEXT_MUTED = (120, 113, 108)   # #78716C
SURFACE = (28, 25, 23)        # #1C1917
BORDER = (61, 57, 53)         # #3D3935
BG_LIGHT = (250, 250, 248)
TEXT_DARK = (28, 25, 23)
TEXT_MUTED_LIGHT = (168, 162, 158)


def draw_logo_mark(draw, cx, cy, size, accent=ACCENT, muted=TEXT_MUTED):
    """
    The "Compile" mark — bigger, bolder, fills the space.
    """
    s = size
    line_w = max(3, int(s * 0.04))
    thin_w = max(2, int(s * 0.022))

    # Core triangle — larger, fills ~45% of the icon
    core_r = s * 0.26
    core_cy = cy + s * 0.02
    node_r = max(3, s * 0.075)

    angles_core = [270, 30, 150]
    core_nodes = []
    for a in angles_core:
        rad = math.radians(a)
        nx = cx + core_r * math.cos(rad)
        ny = core_cy + core_r * math.sin(rad)
        core_nodes.append((nx, ny))

    # Edges
    for i in range(3):
        j = (i + 1) % 3
        draw.line([core_nodes[i], core_nodes[j]], fill=accent, width=line_w)

    # Core nodes
    for (nx, ny) in core_nodes:
        _circle(draw, nx, ny, node_r, accent)

    # Fragments — closer to the core, larger dots
    frag_r = max(2, s * 0.045)
    fragments = [
        (cx - s * 0.42, cy - s * 0.10),  # left
        (cx + s * 0.38, cy - s * 0.30),  # upper-right
        (cx + s * 0.22, cy + s * 0.42),  # lower-right
    ]

    for (fx, fy) in fragments:
        _circle(draw, fx, fy, frag_r, muted)

    # Compilation line
    draw.line([fragments[1], core_nodes[0]], fill=muted, width=thin_w)


def _circle(draw, cx, cy, r, color):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def generate_app_icon(size, output_path):
    """App icon with rounded rect, 4x supersampled."""
    ss = 4
    big = size * ss
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = big * 0.015
    corner_r = big * 0.22
    draw.rounded_rectangle(
        [margin, margin, big - margin, big - margin],
        radius=corner_r,
        fill=(*BG_DARK, 255)
    )
    draw.rounded_rectangle(
        [margin, margin, big - margin, big - margin],
        radius=corner_r,
        outline=(40, 37, 35, 255),
        width=max(1, int(big * 0.004))
    )

    # Mark fills 78% of the icon (was 58%)
    mark_size = big * 0.78
    draw_logo_mark(draw, big / 2, big / 2, mark_size)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(output_path, "PNG")
    print(f"  -> {output_path} ({size}x{size})")


def generate_full_logo(output_path, dark=True):
    width, height = 1200, 400
    if dark:
        bg, text_color, muted = (*BG_DARK, 255), TEXT_PRIMARY, TEXT_MUTED
    else:
        bg, text_color, muted = (*BG_LIGHT, 255), TEXT_DARK, TEXT_MUTED_LIGHT

    img = Image.new("RGBA", (width, height), bg)
    draw = ImageDraw.Draw(img)

    mark_size = height * 0.75
    draw_logo_mark(draw, height * 0.45, height * 0.48, mark_size, accent=ACCENT, muted=muted)

    try:
        font_main = ImageFont.truetype(os.path.join(FONT_DIR, "BricolageGrotesque-Bold.ttf"), size=72)
    except:
        font_main = ImageFont.load_default()
    try:
        font_sub = ImageFont.truetype(os.path.join(FONT_DIR, "GeistMono-Regular.ttf"), size=15)
    except:
        font_sub = ImageFont.load_default()

    text_x = height * 0.92
    text_y = height * 0.30

    draw.text((text_x, text_y), "Open", fill=ACCENT, font=font_main)
    open_w = font_main.getbbox("Open")[2] - font_main.getbbox("Open")[0]
    draw.text((text_x + open_w + 2, text_y), "Wiki", fill=text_color, font=font_main)
    draw.text((text_x + 3, text_y + 85), "Personal Knowledge Engine", fill=muted, font=font_sub)

    img.save(output_path, "PNG")
    print(f"  -> {output_path} ({width}x{height})")


def generate_showcase(output_path):
    width, height = 1200, 900
    img = Image.new("RGBA", (width, height), (*BG_DARK, 255))
    draw = ImageDraw.Draw(img)

    # Icon at top — larger
    icon_size = 280
    ss = 4
    big = icon_size * ss
    icon_img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    icon_draw = ImageDraw.Draw(icon_img)
    margin = big * 0.015
    corner_r = big * 0.22
    icon_draw.rounded_rectangle(
        [margin, margin, big - margin, big - margin],
        radius=corner_r, fill=(*SURFACE, 255)
    )
    icon_draw.rounded_rectangle(
        [margin, margin, big - margin, big - margin],
        radius=corner_r, outline=(50, 47, 44, 255),
        width=max(1, int(big * 0.004))
    )
    draw_logo_mark(icon_draw, big / 2, big / 2, big * 0.78)
    icon_img = icon_img.resize((icon_size, icon_size), Image.LANCZOS)

    icon_x = (width - icon_size) // 2
    icon_y = int(height * 0.12)
    img.paste(icon_img, (icon_x, icon_y), icon_img)

    try:
        font_brand = ImageFont.truetype(os.path.join(FONT_DIR, "BricolageGrotesque-Bold.ttf"), size=64)
    except:
        font_brand = ImageFont.load_default()
    try:
        font_mono = ImageFont.truetype(os.path.join(FONT_DIR, "GeistMono-Regular.ttf"), size=14)
    except:
        font_mono = ImageFont.load_default()
    try:
        font_sub = ImageFont.truetype(os.path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), size=20)
    except:
        font_sub = ImageFont.load_default()
    try:
        font_desc = ImageFont.truetype(os.path.join(FONT_DIR, "InstrumentSans-Regular.ttf"), size=15)
    except:
        font_desc = ImageFont.load_default()

    brand_w = font_brand.getbbox("OpenWiki")[2] - font_brand.getbbox("OpenWiki")[0]
    open_w = font_brand.getbbox("Open")[2] - font_brand.getbbox("Open")[0]
    brand_x = (width - brand_w) / 2
    brand_y = height * 0.50

    draw.text((brand_x, brand_y), "Open", fill=ACCENT, font=font_brand)
    draw.text((brand_x + open_w + 1, brand_y), "Wiki", fill=TEXT_PRIMARY, font=font_brand)

    tagline = "Personal Knowledge Engine"
    tag_w = font_sub.getbbox(tagline)[2] - font_sub.getbbox(tagline)[0]
    draw.text(((width - tag_w) / 2, brand_y + 78), tagline, fill=TEXT_MUTED, font=font_sub)

    desc = "Fragments in. Knowledge out."
    desc_w = font_desc.getbbox(desc)[2] - font_desc.getbbox(desc)[0]
    draw.text(((width - desc_w) / 2, brand_y + 112), desc, fill=BORDER, font=font_desc)

    line_y = height * 0.88
    draw.line([(width/2 - 60, line_y), (width/2 + 60, line_y)], fill=BORDER, width=1)
    ver = "v0.1.0"
    ver_w = font_mono.getbbox(ver)[2] - font_mono.getbbox(ver)[0]
    draw.text(((width - ver_w) / 2, line_y + 10), ver, fill=BORDER, font=font_mono)

    img.save(output_path, "PNG")
    print(f"  -> {output_path} ({width}x{height})")


if __name__ == "__main__":
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(project_root, "src-tauri", "icons")
    downloads = os.path.expanduser("~/Downloads")
    os.makedirs(icons_dir, exist_ok=True)

    print("Generating OpenWiki logos v4 (bigger mark, thicker strokes)...\n")

    print("[App Icons]")
    generate_app_icon(32, os.path.join(icons_dir, "32x32.png"))
    generate_app_icon(128, os.path.join(icons_dir, "128x128.png"))
    generate_app_icon(256, os.path.join(icons_dir, "128x128@2x.png"))
    generate_app_icon(256, os.path.join(icons_dir, "icon.png"))

    print("\n[Full Logos]")
    generate_full_logo(os.path.join(downloads, "openwiki-logo-dark.png"), dark=True)
    generate_full_logo(os.path.join(downloads, "openwiki-logo-light.png"), dark=False)

    print("\n[Showcase]")
    generate_showcase(os.path.join(downloads, "openwiki-showcase.png"))

    print("\n[ICO]")
    sizes_ico = [16, 32, 48, 256]
    ico_images = []
    for s in sizes_ico:
        generate_app_icon(s, f"/tmp/ico_{s}.png")
        ico_images.append(Image.open(f"/tmp/ico_{s}.png"))
    ico_path = os.path.join(icons_dir, "icon.ico")
    ico_images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in sizes_ico],
                       append_images=ico_images[1:])
    print(f"  -> {ico_path}")

    print("\n[macOS iconset]")
    iconset_dir = "/tmp/openwiki_icon.iconset"
    os.makedirs(iconset_dir, exist_ok=True)
    for fname, sz in {
        'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
    }.items():
        generate_app_icon(sz, os.path.join(iconset_dir, fname))

    print("\nDone!")
