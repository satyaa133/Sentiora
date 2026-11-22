"""OTP generation, storage, and verification via Redis."""
import logging
import secrets

from redis import Redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

OTP_TTL_SECONDS = 600          # 10 minutes
RESEND_COOLDOWN_SECONDS = 60   # 1 minute between resends
MAX_OTP_ATTEMPTS = 5


def _get_redis() -> Redis:
    return Redis.from_url(get_settings().redis_url, decode_responses=True)


def _otp_key(email: str) -> str:
    return f"otp:code:{email.lower()}"


def _attempts_key(email: str) -> str:
    return f"otp:attempts:{email.lower()}"


def _resend_key(email: str) -> str:
    return f"otp:resend:{email.lower()}"


def generate_and_store_otp(email: str) -> str:
    """Generate a 6-digit OTP, store it in Redis, reset attempt counter."""
    otp = f"{secrets.randbelow(1_000_000):06d}"
    r = _get_redis()
    r.setex(_otp_key(email), OTP_TTL_SECONDS, otp)
    r.delete(_attempts_key(email))
    r.setex(_resend_key(email), RESEND_COOLDOWN_SECONDS, "1")
    return otp


def verify_otp(email: str, otp: str) -> tuple[bool, str]:
    """Verify an OTP. Returns (success, error_code)."""
    r = _get_redis()
    raw_attempts = r.get(_attempts_key(email))
    attempts = int(str(raw_attempts)) if raw_attempts is not None else 0
    if attempts >= MAX_OTP_ATTEMPTS:
        return False, "OTP_MAX_ATTEMPTS"
    stored = r.get(_otp_key(email))
    if not stored:
        return False, "OTP_EXPIRED"
    if str(stored) != otp.strip():
        new_count = r.incr(_attempts_key(email))
        r.expire(_attempts_key(email), OTP_TTL_SECONDS)
        logger.warning(
            "OTP_INVALID for %s — attempt %d/%d", email.lower(), new_count, MAX_OTP_ATTEMPTS
        )
        return False, "OTP_INVALID"
    # Correct — clean up all keys
    r.delete(_otp_key(email))
    r.delete(_attempts_key(email))
    return True, ""


def can_resend(email: str) -> bool:
    """True when the resend cooldown has expired."""
    return bool(_get_redis().exists(_resend_key(email)) == 0)


def get_resend_ttl(email: str) -> int:
    """Seconds remaining on the resend cooldown (0 if expired)."""
    ttl = _get_redis().ttl(_resend_key(email))
    ttl_int = int(str(ttl)) if ttl is not None else 0
    return max(0, ttl_int)
