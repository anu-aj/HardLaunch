"""One-time asset preparation. Running the app never downloads anything."""

from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

destination = Path(__file__).resolve().parent.parent / "web" / "assets" / "fonts"
destination.mkdir(parents=True, exist_ok=True)
base = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
for folder, source, target in [
    ("bricolagegrotesque", "BricolageGrotesque[opsz,wdth,wght].ttf", "bricolage.ttf"),
    ("instrumentsans", "InstrumentSans[wdth,wght].ttf", "instrument.ttf"),
]:
    for filename, output in ((source, target), ("OFL.txt", folder + "-OFL.txt")):
        with urlopen(base + folder + "/" + quote(filename), timeout=30) as response:
            (destination / output).write_bytes(response.read())
    print("Bundled", target)
