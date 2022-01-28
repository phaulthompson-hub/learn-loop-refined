"""Reusable field types and validators shared by every feature's request schemas."""

import re
from collections.abc import Callable, Iterator
from functools import cache
from typing import Any, Generic, TypeVar

from pydantic.generics import GenericModel
from pydantic.validators import strict_str_validator

T = TypeVar("T")

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")


def _stripped(min_length: int, max_length: int):
    def check(value: str) -> str:
        value = value.strip()
        if len(value) < min_length:
            raise ValueError(f"must be at least {min_length} characters" if min_length > 1 else "must not be blank")
        if len(value) > max_length:
            raise ValueError(f"must be at most {max_length} characters")
        return value

    return check


def _color(value: str) -> str:
    if not HEX_COLOR.match(value):
        raise ValueError("must be a hex colour like #1d6d45")
    return value.lower()


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL.match(value):
        raise ValueError("must be a valid email address")
    return value


class CheckedStr(str):
    """Base for string field types: only real strings are accepted, then `check` normalises or rejects them.

    Subclasses are only used as annotations; validated values are plain `str`.
    """

    check: Callable[[str], str]
    schema_extra: dict[str, Any] = {}

    @classmethod
    def __get_validators__(cls) -> Iterator[Callable[..., Any]]:
        yield strict_str_validator
        yield cls.validate

    @classmethod
    def validate(cls, value: str) -> str:
        return cls.check(value)

    @classmethod
    def __modify_schema__(cls, field_schema: dict[str, Any]) -> None:
        field_schema.update(cls.schema_extra)


def checked_str(name: str, check: Callable[[str], str], **schema_extra: Any) -> type[str]:
    """Build a `str` field type that validates with `check` (and documents `schema_extra` in OpenAPI)."""
    return type(name, (CheckedStr,), {"check": staticmethod(check), "schema_extra": schema_extra})


@cache
def Text(min_length: int = 1, max_length: int = 200) -> type[str]:  # noqa: N802 - reads like a type in annotations
    """A string that is stripped, then length-checked (so "   " fails `min_length=1`)."""
    return checked_str("Text", _stripped(min_length, max_length), minLength=min_length, maxLength=max_length)


Color = checked_str("Color", _color, pattern=HEX_COLOR.pattern)
Email = checked_str("Email", _email, format="email")


class Page(GenericModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


def error_loc(loc: tuple[int | str, ...]) -> list[int | str]:
    """A validation error's location without pydantic's `__root__` marker for model-level (root validator) errors.

    Model-level errors then point at the object itself (e.g. `["body"]`), which clients show without a field name.
    """
    return [part for part in loc if part != "__root__"]
