"""Password hashing and opaque session tokens, using only the standard library.

Passwords are stored as `pbkdf2_sha256$<iterations>$<salt>$<hash>`. Session tokens are
random strings handed to the client once; only their SHA-256 digest is stored, so a
leaked database cannot be replayed as a login.
"""

import base64
import hashlib
import hmac
import secrets

from .config import get_settings

ALGORITHM = "pbkdf2_sha256"
MIN_PASSWORD_LENGTH = 8


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii").rstrip("=")


def hash_password(password: str, *, salt: str | None = None, iterations: int | None = None) -> str:
    salt = salt or secrets.token_hex(12)
    iterations = iterations or get_settings().password_iterations
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), iterations)
    return f"{ALGORITHM}${iterations}${salt}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored.split("$", 3)
    except ValueError:
        return False
    if algorithm != ALGORITHM or not iterations.isdigit():
        return False
    candidate = hash_password(password, salt=salt, iterations=int(iterations))
    return hmac.compare_digest(candidate.rsplit("$", 1)[1], expected)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def password_problems(password: str) -> list[str]:
    """Human-readable reasons a new password is too weak (empty list when acceptable)."""
    problems = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"must be at least {MIN_PASSWORD_LENGTH} characters")
    if password.isalpha() or password.isdigit():
        problems.append("must mix letters with numbers or symbols")
    if password.strip() != password:
        problems.append("must not start or end with spaces")
    return problems
