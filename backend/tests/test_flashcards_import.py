import pytest
from pydantic import ValidationError

from app.schemas.flashcards import BACK_MAX, FRONT_MAX, CardCreate, SessionIn, normalise_front, parse_import


def test_accepts_front_back_and_optional_hint():
    accepted, rejected = parse_import(
        "Mitosis :: Two identical daughter cells\nMeiosis :: Gametes :: Half the chromosomes"
    )
    assert rejected == []
    assert accepted == [
        {"line": 1, "front": "Mitosis", "back": "Two identical daughter cells", "hint": ""},
        {"line": 2, "front": "Meiosis", "back": "Gametes", "hint": "Half the chromosomes"},
    ]


def test_blank_lines_and_comments_are_skipped_but_keep_line_numbers():
    text = "# Chapter 3\n\n   \nATP :: Energy currency\n"
    accepted, rejected = parse_import(text)
    assert rejected == []
    assert [line["line"] for line in accepted] == [4]


def test_whitespace_around_parts_is_trimmed():
    accepted, _ = parse_import("   Gene   ::   A DNA segment   ")
    assert accepted[0]["front"] == "Gene"
    assert accepted[0]["back"] == "A DNA segment"


@pytest.mark.parametrize(
    ("line", "reason"),
    [
        ("No separator here", "Missing the ' :: ' separator between front and back"),
        (" :: back only", "Front is empty"),
        ("front only ::", "Back is empty"),
        ("a :: b :: c :: d", "Too many ' :: ' separators (use front :: back :: hint)"),
        ("x" * (FRONT_MAX + 1) + " :: back", f"Front is longer than {FRONT_MAX} characters"),
        ("front :: " + "y" * (BACK_MAX + 1), f"Back is longer than {BACK_MAX} characters"),
        ("front :: back :: " + "z" * 256, "Hint is longer than 255 characters"),
    ],
)
def test_invalid_lines_are_rejected_with_a_reason(line, reason):
    accepted, rejected = parse_import(line)
    assert accepted == []
    assert rejected[0]["line"] == 1
    assert rejected[0]["reason"] == reason


def test_rejected_text_is_truncated_for_display():
    _, rejected = parse_import("q" * 600)
    assert len(rejected[0]["text"]) == 200


def test_duplicates_within_the_paste_point_at_the_first_line():
    accepted, rejected = parse_import("ATP :: energy\nRNA :: messenger\n  atp   :: again")
    assert [a["front"] for a in accepted] == ["ATP", "RNA"]
    assert rejected == [{"line": 3, "text": "atp   :: again", "reason": "Duplicate of line 1"}]


def test_duplicates_of_existing_cards_are_rejected():
    accepted, rejected = parse_import("What is a gene? :: DNA\nNew card :: back", ["what is  a GENE?"])
    assert [a["front"] for a in accepted] == ["New card"]
    assert rejected[0]["reason"] == "A card with this front already exists"


def test_mixed_input_reports_every_line():
    text = "a :: 1\nbroken\nb :: 2\n :: 3\nc :: 3"
    accepted, rejected = parse_import(text)
    assert [a["line"] for a in accepted] == [1, 3, 5]
    assert [r["line"] for r in rejected] == [2, 4]


def test_normalise_front_ignores_case_and_spacing():
    assert normalise_front("  What IS\tATP? ") == normalise_front("what is atp?")


def test_card_schema_strips_and_validates_lengths():
    card = CardCreate(front="  Gene  ", back=" DNA ")
    assert (card.front, card.back, card.hint) == ("Gene", "DNA", "")
    with pytest.raises(ValidationError):
        CardCreate(front="   ", back="x")
    with pytest.raises(ValidationError):
        CardCreate(front="x", back="y" * (BACK_MAX + 1))


def test_session_schema_rejects_more_misses_than_reviews():
    with pytest.raises(ValidationError):
        SessionIn(reviewed=3, again=4, duration_seconds=60)
    with pytest.raises(ValidationError):
        SessionIn(reviewed=0, duration_seconds=60)
    assert SessionIn(reviewed=3, again=3, duration_seconds=60).again == 3
