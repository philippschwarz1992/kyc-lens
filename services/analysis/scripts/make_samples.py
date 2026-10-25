"""Write sample uploads built from the test fixtures, for trying the service with curl.

Usage: uv run python scripts/make_samples.py [directory]   (default: ./samples)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.fixtures import face, passport_photo, still_video  # noqa: E402

METADATA = {"challenges": [], "capturedAt": "2026-10-25T10:00:00.000Z", "mode": "document-and-face",
            "document": {"type": "passport"}}


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "samples")
    target.mkdir(parents=True, exist_ok=True)
    (target / "document-front.jpg").write_bytes(passport_photo())
    (target / "selfie.jpg").write_bytes(face("collins-portrait.jpg"))
    (target / "other-selfie.jpg").write_bytes(face("ride-portrait.jpg"))
    (target / "face-video.mp4").write_bytes(still_video(face("collins-portrait.jpg")))
    (target / "other-face-video.mp4").write_bytes(still_video(face("ride-portrait.jpg")))
    (target / "metadata.json").write_text(json.dumps(METADATA), encoding="utf-8")
    print(f"Samples written to {target}")


if __name__ == "__main__":
    main()
