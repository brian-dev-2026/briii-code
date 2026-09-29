"""Generate the placeholder Briii Code icons into brand/icons/.

Replace brand/icons/app.ico (and the two PNGs) with your own artwork at any time;
this script only needs to run once.  Requires Pillow (pip install pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "brand" / "icons"
TOP, BOTTOM = (99, 102, 241), (168, 85, 247)  # indigo -> violet


def font(size):
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(size, rounded=True):
    scale = 4  # supersample for smooth edges
    s = size * scale
    grad = Image.new("RGB", (s, s))
    px = grad.load()
    for y in range(s):
        t = y / (s - 1)
        row = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
        for x in range(s):
            px[x, y] = row

    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, s - 1, s - 1), radius=s * 0.22 if rounded else 0, fill=255
    )
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    f = font(int(s * 0.62))
    box = draw.textbbox((0, 0), "B", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), "B", font=f, fill="white")
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [render(n) for n in sizes]
    frames[-1].save(OUT / "app.ico", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    render(150, rounded=False).save(OUT / "app_150x150.png")
    render(70, rounded=False).save(OUT / "app_70x70.png")
    print(f"Icons written to {OUT}")


if __name__ == "__main__":
    main()
