"""Pure text search: tokenising, ranking and highlighted snippets.

Used by the global search endpoint and by the notes list filter. Matching is accent- and
case-insensitive ("Café" matches "cafe"). A query is a set of terms, optionally with
"quoted phrases"; every term must match somewhere in the document (AND semantics).

Scoring, per term, keeps the best field match:

    exact word 10 · word prefix 6 · inside a word 3      × field weight (title 3, other fields 1)

plus whole-query bonuses on the title (equal 40, starts with 20, contains the phrase 10).
Equal scores are ordered by recency, then alphabetically by title.
"""

import re
import unicodedata
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

T = TypeVar("T")

MAX_TERMS = 8
EXACT, PREFIX, INSIDE = 10.0, 6.0, 3.0
TITLE_WEIGHT, BODY_WEIGHT = 3.0, 1.0
TITLE_EQUALS, TITLE_STARTS, TITLE_CONTAINS = 40.0, 20.0, 10.0

_WORD = re.compile(r"\w+")
_PHRASE = re.compile(r'"([^"]+)"')


def fold(text: str) -> str:
    """Lower-case and strip accents: "Élan Vital" -> "elan vital"."""
    return fold_with_offsets(text)[0]


def fold_with_offsets(text: str) -> tuple[str, list[int]]:
    """Fold `text` and return, for every folded character, the index of the original character."""
    chars: list[str] = []
    offsets: list[int] = []
    for index, char in enumerate(text):
        decomposed = unicodedata.normalize("NFKD", char)
        for part in "".join(c for c in decomposed if not unicodedata.combining(c)).casefold():
            chars.append(part)
            offsets.append(index)
    return "".join(chars), offsets


def tokenize(text: str) -> list[str]:
    return _WORD.findall(fold(text))


@dataclass(frozen=True)
class Query:
    raw: str
    terms: tuple[str, ...]  # folded; a term containing a space is a quoted phrase
    phrase: str  # the whole query folded, whitespace collapsed

    def __bool__(self) -> bool:
        return bool(self.terms)


def parse_query(raw: str | None) -> Query:
    raw = (raw or "").strip()
    phrases = [" ".join(tokenize(p)) for p in _PHRASE.findall(raw)]
    words = tokenize(_PHRASE.sub(" ", raw))
    terms: list[str] = []
    for term in [p for p in phrases if p] + words:
        if term not in terms:
            terms.append(term)
    return Query(raw=raw, terms=tuple(terms[:MAX_TERMS]), phrase=" ".join(tokenize(raw)))


def _term_score(term: str, folded: str, words: Sequence[str]) -> float:
    if " " in term:
        if term not in folded:
            return 0.0
        bounded = re.search(rf"(?<!\w){re.escape(term)}(?!\w)", folded)
        return EXACT if bounded else INSIDE
    best = 0.0
    for word in words:
        if word == term:
            return EXACT
        if word.startswith(term):
            best = max(best, PREFIX)
        elif term in word:
            best = max(best, INSIDE)
    return best


def score_document(query: Query, title: str, fields: Sequence[str] = ()) -> float | None:
    """Relevance of one document, or None when some term matches nowhere."""
    if not query:
        return None
    weighted = [(title, TITLE_WEIGHT)] + [(f, BODY_WEIGHT) for f in fields if f]
    prepared = [(fold(text), weight) for text, weight in weighted]
    prepared = [(folded, _WORD.findall(folded), weight) for folded, weight in prepared]
    total = 0.0
    for term in query.terms:
        best = max((_term_score(term, folded, words) * weight for folded, words, weight in prepared), default=0.0)
        if best == 0:
            return None
        total += best
    folded_title = " ".join(prepared[0][1])
    if query.phrase and folded_title == query.phrase:
        total += TITLE_EQUALS
    elif query.phrase and folded_title.startswith(query.phrase):
        total += TITLE_STARTS
    elif len(query.terms) > 1 and query.phrase and query.phrase in folded_title:
        total += TITLE_CONTAINS
    return total


@dataclass(frozen=True)
class Hit(Generic[T]):
    item: T
    score: float


