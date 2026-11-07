"""How large a photo may be once decoded.

The backend limits a photo's bytes, but a small compressed file can decode to
hundreds of megabytes. Pillow reads the dimensions from the header without
decoding the pixels, so this check runs before any pixel is in memory.
"""

# 64 megapixels: above every phone camera's full-resolution photo (48-50 MP).
MAX_PIXELS = 64_000_000


def too_large(width, height):
    return width * height > MAX_PIXELS
