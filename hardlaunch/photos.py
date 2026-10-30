"""Small local profile photos, without an image library or upload directory."""

import base64
import binascii

MAX_PHOTO_BYTES = 2 * 1024 * 1024


def validate_photo(photo):
    """Check the size, encoding and file signature. The browser checks decoding."""
    if photo == "":
        return
    if not isinstance(photo, str) or len(photo) > MAX_PHOTO_BYTES * 4 // 3 + 100:
        raise ValueError("Choose a JPEG, PNG or WebP photo no larger than 2 MB.")
    prefix, separator, encoded = photo.partition(",")
    if not separator or prefix not in ("data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"):
        raise ValueError("Choose a JPEG, PNG or WebP photo.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("That photo could not be read. Please choose it again.") from None
    signatures = {
        "data:image/jpeg;base64": raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9"),
        "data:image/png;base64": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "data:image/webp;base64": raw.startswith(b"RIFF") and raw[8:12] == b"WEBP",
    }
    if len(raw) > MAX_PHOTO_BYTES or not signatures[prefix]:
        raise ValueError("Choose a valid JPEG, PNG or WebP photo no larger than 2 MB.")
