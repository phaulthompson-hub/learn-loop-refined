from datetime import datetime

import pytest

from app.services.search import (
    EXACT,
    INSIDE,
    PREFIX,
    TITLE_EQUALS,
    TITLE_STARTS,
    TITLE_WEIGHT,
    excerpt,
    fold,
    highlight_ranges,
    merge_ranges,
    parse_query,
    rank,
    score_document,
    snippet,
    strip_markdown,
    tokenize,
)


def marked(text: str, ranges) -> list[str]:
    return [text[start:end] for start, end in ranges]


# ---------- Tokens and queries ----------


def test_fold_removes_case_and_accents():
    assert fold("Élan VITAL café") == "elan vital cafe"


def test_tokenize_splits_on_punctuation():
    assert tokenize("SQL: joins, keys & F1-score!") == ["sql", "joins", "keys", "f1", "score"]


def test_parse_query_deduplicates_and_keeps_phrases():
    query = parse_query('Joins  "left join" joins')
    assert query.terms == ("left join", "joins")
    assert query.phrase == "joins left join joins"


def test_parse_query_limits_the_number_of_terms():
    assert len(parse_query(" ".join(f"w{i}" for i in range(20))).terms) == 8


@pytest.mark.parametrize("raw", ["", "   ", None, "!!! ..."])
def test_blank_queries_are_falsy(raw):
    assert not parse_query(raw)


# ---------- Scoring ----------


def test_exact_word_beats_prefix_beats_substring():
    query = parse_query("join")
    exact = score_document(query, "Notes", ["a join here"])
    prefix = score_document(query, "Notes", ["joining tables"])
    inside = score_document(query, "Notes", ["adjoin"])
    assert (exact, prefix, inside) == (EXACT, PREFIX, INSIDE)


def test_title_matches_are_weighted():
    query = parse_query("index")
    assert score_document(query, "Index tuning", []) == EXACT * TITLE_WEIGHT + TITLE_STARTS
    assert score_document(query, "Tuning", ["index"]) == EXACT


def test_every_term_must_match_somewhere():
    query = parse_query("sql window")
    assert score_document(query, "SQL basics", ["window functions"]) is not None
    assert score_document(query, "SQL basics", ["joins"]) is None


def test_quoted_phrase_must_appear_contiguously():
    query = parse_query('"left join"')
    assert score_document(query, "Joins", ["a left join keeps rows"]) == EXACT
    assert score_document(query, "Joins", ["join on the left"]) is None


def test_whole_title_bonuses():
    query = parse_query("gradient descent")
    equal = score_document(query, "Gradient Descent", [])
    starts = score_document(query, "Gradient descent cheat sheet", [])
    contains = score_document(query, "My gradient descent notes", [])
    assert equal == 2 * EXACT * TITLE_WEIGHT + TITLE_EQUALS
    assert equal > starts > contains


def test_accents_do_not_matter_when_scoring():
    assert score_document(parse_query("cafe"), "Café notes", []) is not None


def test_rank_orders_by_score_then_recency_then_title():
    items = [
        ("Keys and join tips", datetime(2022, 2, 27)),
        ("Old join notes", datetime(2021, 12, 30)),
        ("New join notes", datetime(2022, 3, 8)),
        ("Another join note", datetime(2022, 3, 8)),
        ("Unrelated", datetime(2022, 3, 13)),
    ]
    hits = rank(parse_query("join"), items, title=lambda i: i[0], fields=lambda _: (), recency=lambda i: i[1])
    assert [hit.item[0] for hit in hits] == [
        "Another join note",
        "New join notes",
        "Keys and join tips",
        "Old join notes",
    ]


def test_rank_puts_exact_title_first():
    items = ["Joins cheat sheet", "Joins", "Left joins"]
    hits = rank(parse_query("joins"), items, title=lambda t: t, fields=lambda _: ())
    assert hits[0].item == "Joins"


# ---------- Highlights ----------


