"""Count non-blank lines of hand-written source in the repository.

Usage: python scripts/loc.py [REVISION]

Counts git-tracked files only (so node_modules, build output and local databases are
never included) and excludes lockfiles, generated files and binary assets. Pass a git
revision to count that commit instead of the working tree.
"""

import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSIONS = {
    ".py": "Python",
    ".ts": "TypeScript",
    ".tsx": "TypeScript (TSX)",
    ".js": "JavaScript",
    ".css": "CSS",
    ".html": "HTML",
    ".yml": "YAML",
    ".toml": "TOML",
    ".conf": "nginx",
}
EXCLUDED_NAMES = {"package-lock.json", "tsconfig.tsbuildinfo"}
EXCLUDED_DIRS = {"node_modules", "dist", "build", "__pycache__", ".venv", "venv", "coverage", "assets"}


def tracked_files(revision: str | None) -> list[str]:
    command = ["git", "ls-tree", "-r", "--name-only", revision] if revision else ["git", "ls-files"]
    return subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()


def read(name: str, revision: str | None) -> str:
    if revision:
        return subprocess.run(
            ["git", "show", f"{revision}:{name}"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        ).stdout
    path = ROOT / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


def category(path: Path) -> str:
    parts = path.parts
    is_test = "tests" in parts or ".test." in path.name or "test" in parts
    side = parts[0] if parts[0] in {"backend", "frontend"} else "other"
    return f"{side} {'tests' if is_test else 'source'}"


def main() -> int:
    revision = sys.argv[1] if len(sys.argv) > 1 else None
    by_language: dict[str, int] = defaultdict(int)
    by_category: dict[str, int] = defaultdict(int)
    files = 0
    for name in tracked_files(revision):
        path = Path(name)
        if set(path.parts) & EXCLUDED_DIRS or path.name in EXCLUDED_NAMES:
            continue
        language = "Dockerfile" if path.name == "Dockerfile" else EXTENSIONS.get(path.suffix)
        if language is None:
            continue
        lines = sum(1 for line in read(name, revision).splitlines() if line.strip())
        by_language[language] += lines
        by_category[category(path)] += lines
        files += 1
    total = sum(by_language.values())
    print(f"Revision: {revision or 'working tree'}")
    print(f"Non-blank source lines: {total:,} in {files} files")
    print("\nBy language:")
    for language, lines in sorted(by_language.items(), key=lambda item: -item[1]):
        print(f"  {language:<18} {lines:>7,}")
    print("\nBy area:")
    for area, lines in sorted(by_category.items()):
        print(f"  {area:<18} {lines:>7,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
