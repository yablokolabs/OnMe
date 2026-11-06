"""What the outfit photo shows, decided from the human parser's pixel counts.

FASHN VTON needs a garment category and a garment photo type. OnMe asks the user
for neither, so both are read from the parser's segmentation of the outfit photo.
Plain arithmetic over label counts, with no model and no dependency, so it is
tested on its own.
"""

UPPER = ("top",)
LOWER = ("skirt", "pants")
BODY = ("face", "arms", "hands", "legs", "feet", "torso")

# A share of the garment pixels above which a part counts as really there.
DRESS_SHARE = 0.3
PART_SHARE = 0.2

# A share of the whole image covered by a person's body for a "model" photo.
BODY_SHARE = 0.01


def _sum(counts, labels):
    return sum(counts.get(label, 0) for label in labels)


def choose_category(counts):
    """Returns "tops", "bottoms" or "one-pieces" for the garment in the photo."""
    dress = counts.get("dress", 0)
    upper = _sum(counts, UPPER)
    lower = _sum(counts, LOWER)
    total = dress + upper + lower
    if total == 0:
        return "tops"
    if dress / total >= DRESS_SHARE:
        return "one-pieces"
    if upper / total >= PART_SHARE and lower / total >= PART_SHARE:
        return "one-pieces"
    return "bottoms" if lower > upper else "tops"


def choose_photo_type(counts, total_pixels):
    """Returns "model" when someone is wearing the garment, else "flat-lay"."""
    if total_pixels <= 0:
        return "flat-lay"
    return "model" if _sum(counts, BODY) / total_pixels >= BODY_SHARE else "flat-lay"
