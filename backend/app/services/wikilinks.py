"""Parsing and rewriting `[[wiki links]]` in markdown note bodies.

Supported forms:

* `[[Target]]`                – link to the note titled "Target"
* `[[Target|shown text]]`     – same target, custom label
* `[[Target#Heading]]`        – link to a heading inside the target (the heading is kept for the UI)

Links inside fenced code blocks (```` ``` ```` / `~~~`) and inline code spans are ignored, as is an
escaped `\\[[`. Titles match case-insensitively with whitespace collapsed, so `[[sql  Joins]]`
finds "SQL joins". Everything here is pure so the note API and tests share one implementation.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

MAX_TARGET = 160
_OPEN_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_CLOSE_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*$")
_LINK = re.compile(r"(?<!\\)\[\[([^\[\]\n]+?)\]\]")
_NOT_NEWLINE = re.compile(r"[^\n]")


@dataclass(frozen=True)
class WikiLink:
    target: str
    alias: str | None
    heading: str | None
    start: int  # offset of the opening "[[" in the body
    end: int  # offset just after the closing "]]"

    @property
    def key(self) -> str:
        return normalise_title(self.target)

    @property
    def label(self) -> str:
        return self.alias or self.target


@dataclass(frozen=True)
class LinkTarget:
    """A note a link could point at. `preferred` wins ties (the viewer's own notes)."""

    note_id: int
    title: str
    preferred: bool
    updated_at: datetime


def normalise_title(title: str) -> str:
    return " ".join(title.split()).casefold()


def _blank(text: str) -> str:
    return _NOT_NEWLINE.sub(" ", text)


def _mask_inline_code(line: str) -> str:
    """Blank out `code spans` on one line. A backtick run only closes on a run of the same length."""
    result = []
    index = 0
    while index < len(line):
        if line[index] != "`":
            result.append(line[index])
            index += 1
            continue
        run = len(line) - index - len(line[index:].lstrip("`"))
        closing = re.compile(rf"(?<!`)`{{{run}}}(?!`)").search(line, index + run)
        if closing is None:
            result.append(line[index : index + run])
            index += run
            continue
        result.append(_blank(line[index : closing.end()]))
        index = closing.end()
    return "".join(result)


def mask_code(text: str) -> str:
    """Replace code (fenced blocks, inline spans) with spaces of the same length, so offsets stay valid."""
    output = []
    fence: tuple[str, int] | None = None
    for line in text.splitlines(keepends=True):
        if fence is None:
            opening = _OPEN_FENCE.match(line)
            if opening:
                marker = opening.group(1)
                fence = (marker[0], len(marker))
                output.append(_blank(line))
            else:
                output.append(_mask_inline_code(line))
            continue
        closing = _CLOSE_FENCE.match(line)
        if closing and closing.group(1)[0] == fence[0] and len(closing.group(1)) >= fence[1]:
            fence = None
        output.append(_blank(line))
    return "".join(output)


def _clean(value: str) -> str:
    return " ".join(value.split())


def extract_links(text: str) -> list[WikiLink]:
    """Every wiki link in `text`, in document order (duplicates included)."""
    links = []
    for match in _LINK.finditer(mask_code(text)):
        inner = text[match.start(1) : match.end(1)]
        target_part, _, alias = inner.partition("|")
        target, _, heading = target_part.partition("#")
        target = _clean(target)
        if not target or len(target) > MAX_TARGET:
            continue
        links.append(
            WikiLink(
                target=target,
                alias=_clean(alias) or None,
                heading=_clean(heading) or None,
                start=match.start(),
                end=match.end(),
            )
        )
    return links


def unique_links(links: Iterable[WikiLink]) -> list[WikiLink]:
    """First occurrence of each distinct target (case-insensitive), in document order."""
    seen: set[str] = set()
    result = []
    for link in links:
        if link.key not in seen:
            seen.add(link.key)
            result.append(link)
    return result


def links_to(text: str, title: str) -> list[WikiLink]:
    key = normalise_title(title)
    return [link for link in extract_links(text) if link.key == key]


def title_index(targets: Iterable[LinkTarget]) -> dict[str, int]:
    """Map normalised titles to note ids. On duplicates the preferred note wins, then the most recent."""
    best: dict[str, LinkTarget] = {}
    for target in targets:
        key = normalise_title(target.title)
        current = best.get(key)
        rank = (target.preferred, target.updated_at, target.note_id)
        if current is None or rank > (current.preferred, current.updated_at, current.note_id):
            best[key] = target
    return {key: target.note_id for key, target in best.items()}


def rename_links(text: str, old_title: str, new_title: str) -> tuple[str, int]:
    """Point every link at `old_title` to `new_title`, keeping aliases and headings. Returns (text, count)."""
    matches = links_to(text, old_title)
    for link in reversed(matches):
        replacement = new_title
        if link.heading:
            replacement += f"#{link.heading}"
        if link.alias:
            replacement += f"|{link.alias}"
        text = f"{text[: link.start]}[[{replacement}]]{text[link.end :]}"
    return text, len(matches)


def resolve_links(text: str, index: Mapping[str, int]) -> list[tuple[WikiLink, int | None]]:
    """Distinct outgoing links with the note id each one resolves to (None when no such note exists)."""
    return [(link, index.get(link.key)) for link in unique_links(extract_links(text))]
