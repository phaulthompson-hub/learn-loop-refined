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


def test_highlights_prefer_word_starts():
    text = "Adjoin tables with a join; joins are everywhere"
    assert marked(text, highlight_ranges(text, parse_query("join"))) == ["join", "join"]


def test_highlights_fall_back_to_substrings():
    text = "Adjoining rooms"
    assert marked(text, highlight_ranges(text, parse_query("join"))) == ["join"]


def test_highlights_map_accented_text_back_to_original_offsets():
    text = "Le Café, the CAFE"
    assert marked(text, highlight_ranges(text, parse_query("cafe"))) == ["Café", "CAFE"]


def test_overlapping_highlights_are_merged():
    text = "loss function"
    assert highlight_ranges(text, parse_query('loss "loss function"')) == [(0, 13)]


def test_matches_separated_by_whitespace_become_one_highlight():
    text = "Gradient  descent, then gradient"
    assert marked(text, highlight_ranges(text, parse_query("gradient descent"))) == ["Gradient  descent", "gradient"]


def test_merge_ranges_joins_touching_and_drops_empty():
    assert merge_ranges([(5, 8), (0, 2), (2, 4), (7, 10), (3, 3)]) == [(0, 4), (5, 10)]


# ---------- Snippets ----------


def test_short_text_is_returned_whole_with_whitespace_collapsed():
    result = snippet("  SQL \n\n joins   explained ", parse_query("joins"))
    assert result.text == "SQL joins explained"
    assert marked(result.text, result.highlights) == ["joins"]


def test_snippet_windows_around_the_match_with_ellipses():
    text = " ".join(["filler"] * 40) + " the gradient step " + " ".join(["padding"] * 40)
    result = snippet(text, parse_query("gradient"), width=60)
    assert result.text.startswith("…") and result.text.endswith("…")
    assert len(result.text) <= 62
    assert marked(result.text, result.highlights) == ["gradient"]


def test_snippet_prefers_the_densest_cluster_of_matches():
    text = "loss " + "x " * 80 + "loss function and loss curve " + "y " * 80
    result = snippet(text, parse_query("loss"), width=50)
    assert marked(result.text, result.highlights) == ["loss", "loss"]


def test_snippet_without_matches_starts_at_the_beginning():
    text = "First words of the note. " + "More text here. " * 20
    result = snippet(text, parse_query("absent"), width=40)
    assert result.text.startswith("First words")
    assert result.text.endswith("…")
    assert result.highlights == []


def test_snippet_never_cuts_words_or_matches():
    text = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda"
    result = excerpt(text, [], 20)
    assert result.text == "alpha beta gamma…"


def test_excerpt_keeps_explicit_ranges_aligned():
    text = "Intro line.\n\nSee [[Loss functions]] for\tdetails."
    start = text.index("[[")
    result = excerpt(text, [(start, start + len("[[Loss functions]]"))], 200)
    assert result.text == "Intro line. See [[Loss functions]] for details."
    assert marked(result.text, result.highlights) == ["[[Loss functions]]"]


# ---------- Markdown to text ----------


def test_strip_markdown_removes_syntax_but_keeps_words():
    markdown = (
        "# Heading\n\n"
        "> quoted **bold** and _italic_ and ~~gone~~\n\n"
        "- [x] done item\n"
        "1. first [link](https://example.com) and `code`\n\n"
        "[[Target|alias]] and [[Plain#Section]]\n\n"
        "---\n"
        "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n"
        "```sql\nSELECT 1;\n```"
    )
    text = strip_markdown(markdown)
    for word in ("Heading", "quoted bold and italic and gone", "done item", "first link and code", "alias", "Plain"):
        assert word in text
    for syntax in ("#", "**", "[x]", "](", "[[", "`", "---", "|"):
        assert syntax not in text
    assert "SELECT 1;" in text


def test_strip_markdown_keeps_snake_case_words():
    assert strip_markdown("use snake_case_names and 2*3*4") == "use snake_case_names and 2*3*4"
