"""
The Desk's app icons — generated, not drawn by hand, so they can be remade.

The Desk is a SEPARATE installable app from the shop, so it needs an icon that
is not the shop's: two identical All Outdoor icons on a home screen is the same
as having no admin app at all.

The mark is the Desk's own, from components/desk/tabs.tsx's DeskMark — a
rounded square in --dk-ink carrying "AO" in --dk-ground — sitting on the Desk
ground. Inverted against the shop, which is dark-on-cream.

Two purposes, because Android masks them differently:
  · "any"      — the mark at full size, shown as authored.
  · "maskable" — the same mark inside the centre 60%, so a circular or
                 squircle mask cannot clip it. A maskable icon whose content
                 runs to the edge loses its corners on most Android launchers.

Run:  python scripts/make-desk-icons.py
"""

from PIL import Image, ImageDraw, ImageFont

GROUND = (16, 19, 18)  # --dk-ground #101312
INK = (238, 242, 240)  # --dk-ink    #EEF2F0
OUT = "public"

FONT_CANDIDATES = [
    "C:/Windows/Fonts/seguisb.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def load_font(px):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, px)
        except OSError:
            continue
    raise SystemExit("no bold font found — icons would render in the PIL default")


def draw_icon(size, mark_fraction):
    """mark_fraction: how much of the canvas the rounded square occupies."""
    # 4x supersample, then downscale — the rounded corners and the letterforms
    # are the whole icon at 192px, and aliasing on them reads as blur.
    scale = 4
    px = size * scale
    img = Image.new("RGB", (px, px), GROUND)
    d = ImageDraw.Draw(img)

    side = int(px * mark_fraction)
    x0 = (px - side) // 2
    y0 = (px - side) // 2
    # DeskMark is 26px with a 7px radius — the same ratio here.
    radius = int(side * (7 / 26))
    d.rounded_rectangle([x0, y0, x0 + side, y0 + side], radius=radius, fill=INK)

    text = "AO"
    font = load_font(int(side * 0.42))
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(
        (x0 + (side - tw) / 2 - box[0], y0 + (side - th) / 2 - box[1]),
        text,
        font=font,
        fill=GROUND,
    )
    return img.resize((size, size), Image.LANCZOS)


def main():
    made = []
    for size in (192, 512):
        # "any": the mark is generous, as it appears in the top bar.
        p = f"{OUT}/icon-desk-{size}.png"
        draw_icon(size, 0.78).save(p, optimize=True)
        made.append(p)

        # "maskable": inside the safe zone, so a circle mask keeps all of it.
        p = f"{OUT}/icon-desk-maskable-{size}.png"
        draw_icon(size, 0.56).save(p, optimize=True)
        made.append(p)

    for p in made:
        print("  wrote", p)


if __name__ == "__main__":
    main()
