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


def rank(
    query: Query,
    items: Iterable[T],
    title: Callable[[T], str],
    fields: Callable[[T], Sequence[str]],
    recency: Callable[[T], datetime | None] = lambda _: None,
) -> list[Hit[T]]:
    """Matching items, best first; ties go to the most recent, then to the title alphabetically."""
    hits = []
    for item in items:
        score = score_document(query, title(item), fields(item))
        if score is not None:
            hits.append(Hit(item, score))

    def order(hit: Hit[T]):
        moment = recency(hit.item)
        return (-hit.score, -(moment.timestamp() if moment else 0.0), title(hit.item).casefold())

    return sorted(hits, key=order)


# ---------- Highlights and snippets ----------

Range = tuple[int, int]


def merge_ranges(ranges: Iterable[Range]) -> list[Range]:
    merged: list[list[int]] = []
    for start, end in sorted(r for r in ranges if r[1] > r[0]):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def highlight_ranges(text: str, query: Query) -> list[Range]:
    """Character ranges of `text` that match query terms. Word-start matches are preferred per term."""
    if not query or not text:
        return []
    folded, offsets = fold_with_offsets(text)
    ranges: list[Range] = []
    for term in query.terms:
        spans = [(m.start(), m.end()) for m in re.finditer(re.escape(term), folded)]
        at_word_start = [s for s in spans if s[0] == 0 or not folded[s[0] - 1].isalnum()]
        for start, end in at_word_start or spans:
            ranges.append((offsets[start], offsets[end - 1] + 1))
    merged = merge_ranges(ranges)
    # Matches separated only by whitespace read as one phrase ("gradient descent"), so join them.
    joined: list[Range] = []
    for start, end in merged:
        if joined and not text[joined[-1][1] : start].strip():
            joined[-1] = (joined[-1][0], end)
        else:
            joined.append((start, end))
    return joined


@dataclass(frozen=True)
class Snippet:
    text: str
    highlights: list[Range]


def _squash(text: str, ranges: Sequence[Range]) -> tuple[str, list[Range]]:
    """Collapse whitespace runs to one space and trim, moving highlight ranges along with the text."""
    out: list[str] = []
    positions: list[int] = []  # new index of each original character
    for char in text:
        positions.append(len(out))
        if char.isspace():
            if out and out[-1] != " ":
                out.append(" ")
        else:
            out.append(char)
    positions.append(len(out))
    squashed = "".join(out)
    trimmed = squashed.rstrip()
    shift = len(trimmed) - len(trimmed.lstrip())
    trimmed = trimmed.lstrip()
    moved = [
        (max(0, positions[s] - shift), min(len(trimmed), positions[e] - shift))
        for s, e in ranges
        if positions[e] - shift > 0 and positions[s] - shift < len(trimmed)
    ]
    return trimmed, merge_ranges(moved)


def _word_start(text: str, index: int) -> int:
    """Move `index` forward to the start of the next word (unless already at one)."""
    if index <= 0:
        return 0
    if text[index - 1].isspace():
        return index
    space = text.find(" ", index)
    return index if space == -1 else space + 1


def _word_end(text: str, index: int, floor: int) -> int:
    """Move `index` back to the end of the previous word, but never to or before `floor`."""
    if index >= len(text):
        return len(text)
    space = text.rfind(" ", 0, index + 1)
    return index if space <= floor else space


def excerpt(text: str, ranges: Sequence[Range], width: int = 160) -> Snippet:
    """A window of about `width` characters around the densest cluster of `ranges`, with ellipses."""
    clean, ranges = _squash(text, ranges)
    if len(clean) <= width:
        return Snippet(clean, list(ranges))
    start = 0
    if ranges:
        lead = width // 4

        def covered(r: Range) -> int:
            window_start = max(0, r[0] - lead)
            return sum(1 for s, e in ranges if s >= window_start and e <= window_start + width)

        best = max(ranges, key=lambda r: (covered(r), -r[0]))
        start = max(0, min(best[0] - lead, len(clean) - width))
        start = min(_word_start(clean, start), best[0])
    end = min(len(clean), start + width)
    if end < len(clean):
        # Never cut a highlighted match in half.
        end = max(_word_end(clean, end, start), max((e for s, e in ranges if s < end), default=0))
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(clean) else ""
    body = clean[start:end].strip()
    lead_trim = len(clean[start:end]) - len(clean[start:end].lstrip())
    offset = len(prefix) - start - lead_trim
    moved = [
        (max(s + offset, len(prefix)), min(e + offset, len(prefix) + len(body)))
        for s, e in ranges
        if e > start and s < end
    ]
    return Snippet(prefix + body + suffix, merge_ranges(moved))


def snippet(text: str, query: Query | None, width: int = 160) -> Snippet:
    """Excerpt `text` around the query matches (or its beginning when nothing matches)."""
    ranges = highlight_ranges(text, query) if query else []
    return excerpt(text, ranges, width)


# ---------- Markdown to plain text ----------

_MD_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^ {0,3}(`{3,}|~{3,}).*$", re.M), ""),  # code fence markers (content is kept)
    (re.compile(r"^ {0,3}([-*_])( *\1){2,} *$", re.M), ""),  # horizontal rules
    (re.compile(r"^ {0,3}\|?( *:?-+:? *\|)+ *:?-*:? *$", re.M), ""),  # table separator rows
    (re.compile(r"^ {0,3}#{1,6}\s+", re.M), ""),  # heading markers
    (re.compile(r"^ {0,3}(> ?)+", re.M), ""),  # blockquotes
    (re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?", re.M), ""),  # list markers and task boxes
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),  # images -> alt text
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),  # links -> label
    (re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]"), r"\2"),  # [[target|alias]] -> alias
    (re.compile(r"\[\[([^\]|#]+)(?:#[^\]]*)?\]\]"), r"\1"),  # [[target]] -> target
    (re.compile(r"(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1"), r"\2"),  # bold / strikethrough
    (re.compile(r"(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])"), r"\2"),  # italics
    (re.compile(r"`+([^`]*)`+"), r"\1"),  # inline code
    (re.compile(r"\s*\|\s*"), " "),  # table cell separators
)


def strip_markdown(markdown: str) -> str:
    """Readable plain text from markdown, for snippets, word counts and search."""
    text = markdown
    for pattern, replacement in _MD_RULES:
        text = pattern.sub(replacement, text)
    return re.sub(r"[ \t]+", " ", text).strip()
