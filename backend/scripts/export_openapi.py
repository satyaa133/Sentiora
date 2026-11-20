"""Write the API's OpenAPI schema to docs/api/openapi.json.

The schema is generated from the FastAPI routes and Pydantic models, so it is
the exact contract the code serves. docs/API.md explains the conventions around
it (envelope, errors, auth, rate limits).

    npm run docs:api
    npm run docs:api -- --check   # exit 1 if the committed file is out of date
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.main import app

OUTPUT = Path(__file__).resolve().parents[2] / "docs" / "api" / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare with the committed file instead of writing it.",
    )
    args = parser.parse_args()

    schema = render()
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        # A Windows checkout may have CRLF line endings; compare content only.
        if current.replace("\r\n", "\n") != schema:
            print(f"{OUTPUT} is out of date. Run: npm run docs:api", file=sys.stderr)
            return 1
        print(f"{OUTPUT} is up to date.")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(schema, encoding="utf-8", newline="\n")
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
