"""Render the repo-native geometric icon.svg shape to PWA PNG sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

for size in (192, 512):
    scale = size / 192
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size, size), radius=40 * scale, fill="#2d6553")
    points = [(62, 56), (130, 56), (130, 74), (105, 74), (105, 136), (87, 136), (87, 74), (62, 74)]
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in points], fill="#ffffff")
    image.save(Path(__file__).resolve().parent.parent / "public" / f"icon-{size}.png")
