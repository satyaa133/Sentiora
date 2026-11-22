"""Print the sign-up verification code (OTP) for an email from the e2e Redis.

The e2e stack (tests/e2e_stack.py) sends no real email: the Playwright specs
read the code the API stored and type it on the Verify Email page.

    node scripts/run-python.mjs -m tests.e2e_otp someone@example.com
"""

from __future__ import annotations

import sys

from redis import Redis

from app.services.otp_service import _otp_key
from tests.e2e_stack import _e2e_redis_url


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m tests.e2e_otp EMAIL", file=sys.stderr)
        return 2
    code = Redis.from_url(_e2e_redis_url(), decode_responses=True).get(_otp_key(argv[0]))
    if not code:
        print(f"no verification code stored for {argv[0]}", file=sys.stderr)
        return 1
    print(code)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
