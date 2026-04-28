from __future__ import annotations

import subprocess
import sys


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


if __name__ == "__main__":
    run([
        sys.executable,
        "-m",
        "ruff",
        "check",
        "src/app/main.py",
        "src/app/models.py",
        "src/app/workspace.py",
        "tests",
        "scripts",
    ])
    run([sys.executable, "-m", "pytest"])
