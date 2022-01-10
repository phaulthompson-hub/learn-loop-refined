"""Password hashing, session tokens and password strength rules (app/security.py)."""

import hashlib

import pytest

from app.security import (
    ALGORITHM,
    MIN_PASSWORD_LENGTH,
    hash_password,
    new_token,
    password_problems,
    token_digest,
    verify_password,
)


def test_hash_has_algorithm_iterations_salt_and_digest():
    stored = hash_password("correct-horse-1", salt="abc123", iterations=1500)
    algorithm, iterations, salt, digest = stored.split("$")
    assert (algorithm, iterations, salt) == (ALGORITHM, "1500", "abc123")
    assert digest and "=" not in digest


def test_hash_uses_a_fresh_salt_each_time():
    first, second = hash_password("same-password-1"), hash_password("same-password-1")
    assert first != second
    assert verify_password("same-password-1", first)
    assert verify_password("same-password-1", second)


def test_hash_is_deterministic_for_a_fixed_salt_and_work_factor():
    assert hash_password("pw-12345", salt="s", iterations=1000) == hash_password("pw-12345", salt="s", iterations=1000)
    assert hash_password("pw-12345", salt="s", iterations=1000) != hash_password("pw-12345", salt="s", iterations=1001)


def test_verify_accepts_only_the_original_password():
    stored = hash_password("s3cret-pass")
    assert verify_password("s3cret-pass", stored)
    assert not verify_password("s3cret-pass ", stored)
    assert not verify_password("S3cret-pass", stored)
    assert not verify_password("", stored)


def test_verify_keeps_the_stored_work_factor():
    stored = hash_password("legacy-pass-1", iterations=1234)
    assert verify_password("legacy-pass-1", stored)


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "not-a-hash",
        "md5$1000$salt$digest",
        "pbkdf2_sha256$many$salt$digest",
        "pbkdf2_sha256$1000$salt",
    ],
)
def test_verify_rejects_malformed_hashes(stored):
    assert verify_password("anything-1", stored) is False


def test_verify_rejects_a_tampered_digest():
    stored = hash_password("tamper-me-1")
    prefix, digest = stored.rsplit("$", 1)
    flipped = ("A" if digest[0] != "A" else "B") + digest[1:]
    assert not verify_password("tamper-me-1", f"{prefix}${flipped}")


def test_session_tokens_are_random_and_stored_as_sha256():
    tokens = {new_token() for _ in range(20)}
    assert len(tokens) == 20
    token = tokens.pop()
    assert len(token) >= 40
    assert token_digest(token) == hashlib.sha256(token.encode()).hexdigest()
    assert len(token_digest(token)) == 64
    assert token_digest(token) != token


@pytest.mark.parametrize(
    ("password", "expected"),
    [
        ("abc1", ["must be at least 8 characters"]),
        ("abcdefgh", ["must mix letters with numbers or symbols"]),
        ("12345678", ["must mix letters with numbers or symbols"]),
        ("abcdefg", ["must be at least 8 characters", "must mix letters with numbers or symbols"]),
        (" padded-pass-1 ", ["must not start or end with spaces"]),
        ("learnloop123", []),
        ("correct horse battery!", []),
        ("пароль-2022", []),
    ],
)
def test_password_problems(password, expected):
    assert password_problems(password) == expected


def test_minimum_length_is_inclusive():
    assert password_problems("a" * (MIN_PASSWORD_LENGTH - 2) + "1!") == []
    assert "must be at least 8 characters" in password_problems("a1" * 3)
