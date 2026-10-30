"""Run the HardLaunch local browser app: python main.py"""

import sys

sys.dont_write_bytecode = True  # Keep the project folder free of __pycache__ folders.

from hardlaunch.server import run  # noqa: E402 (must come after the setting above)

if __name__ == "__main__":
    run()
