from datetime import datetime

from app.services.wikilinks import (
    LinkTarget,
    extract_links,
    links_to,
    mask_code,
    normalise_title,
    rename_links,
    resolve_links,
    title_index,
    unique_links,
)

EARLY = datetime(2022, 2, 27, 9)
LATE = datetime(2022, 3, 8, 9)


def targets(text: str) -> list[str]:
    return [link.target for link in extract_links(text)]


def test_extracts_plain_links_in_order_with_offsets():
    body = "Start with [[Loss functions]], then [[Gradient descent]]."
    links = extract_links(body)
    assert [link.target for link in links] == ["Loss functions", "Gradient descent"]
    assert body[links[0].start : links[0].end] == "[[Loss functions]]"
    assert body[links[1].start : links[1].end] == "[[Gradient descent]]"


def test_alias_and_heading_are_split_from_the_target():
    (link,) = extract_links("See [[SQL joins#Left join|the left join section]]")
    assert link.target == "SQL joins"
    assert link.heading == "Left join"
    assert link.alias == "the left join section"
    assert link.label == "the left join section"


def test_label_falls_back_to_the_target():
    (link,) = extract_links("[[Precision vs recall]]")
    assert link.alias is None
    assert link.label == "Precision vs recall"


def test_whitespace_inside_links_is_collapsed():
    (link,) = extract_links("[[  Loss\tfunctions   compared ]]")
    assert link.target == "Loss functions compared"


def test_links_in_inline_code_are_ignored():
    assert targets("Type `[[Note]]` to link, like [[Real note]].") == ["Real note"]


def test_double_backtick_spans_can_contain_single_backticks():
    assert targets("``a ` [[Hidden]] `` and [[Shown]]") == ["Shown"]
    # A run of three backticks does not close a two-backtick span, so this link counts.
    assert targets("``a [[Counted]] ```") == ["Counted"]


def test_unclosed_backtick_is_literal():
    assert targets("A stray ` before [[Shown]]") == ["Shown"]


def test_links_in_fenced_code_blocks_are_ignored():
    body = "[[Before]]\n```python\nx = '[[Inside]]'\n```\n[[After]]"
    assert targets(body) == ["Before", "After"]


def test_tilde_fences_and_longer_closing_fences():
    body = "~~~\n[[Inside]]\n~~~~\n[[After]]"
    assert targets(body) == ["After"]


def test_fence_only_closes_on_the_same_marker():
    body = "```\n[[Inside]]\n~~~\n[[Still inside]]\n```\n[[After]]"
    assert targets(body) == ["After"]


def test_unclosed_fence_hides_the_rest_of_the_document():
    assert targets("[[One]]\n```\n[[Two]]\n[[Three]]") == ["One"]


def test_escaped_and_empty_links_are_ignored():
    assert targets(r"\[[Escaped]] [[]] [[   ]] [[#Only heading]] [[Kept]]") == ["Kept"]


def test_links_do_not_span_lines_or_nest():
    assert targets("[[Broken\nlink]] [[a [[Inner]] b]]") == ["Inner"]


def test_overlong_targets_are_ignored():
    assert targets(f"[[{'x' * 161}]] [[{'y' * 160}]]") == ["y" * 160]


def test_mask_code_keeps_length_and_newlines():
    body = "a `code` b\n```\nfenced\n```\nc"
    masked = mask_code(body)
    assert len(masked) == len(body)
    assert masked.count("\n") == body.count("\n")
    assert "code" not in masked and "fenced" not in masked
    assert masked.startswith("a ") and masked.endswith("c")


def test_normalise_title_is_case_and_space_insensitive():
    assert normalise_title("  SQL   Joins ") == normalise_title("sql joins") == "sql joins"


def test_unique_links_keeps_first_spelling():
    links = unique_links(extract_links("[[Joins]] [[joins|again]] [[Keys]] [[JOINS]]"))
    assert [(link.target, link.alias) for link in links] == [("Joins", None), ("Keys", None)]


def test_links_to_matches_case_insensitively():
    body = "[[Loss Functions]] and [[loss functions|losses]] but not [[Loss]]"
    assert [link.label for link in links_to(body, "loss functions")] == ["Loss Functions", "losses"]


def test_title_index_prefers_own_notes_then_most_recent():
    index = title_index(
        [
            LinkTarget(1, "Joins", preferred=False, updated_at=LATE),
            LinkTarget(2, "joins", preferred=True, updated_at=EARLY),
            LinkTarget(3, "Keys", preferred=False, updated_at=EARLY),
            LinkTarget(4, "KEYS", preferred=False, updated_at=LATE),
        ]
    )
    assert index == {"joins": 2, "keys": 4}


def test_resolve_links_flags_unresolved_targets():
    index = {"loss functions": 7}
    resolved = resolve_links("[[Loss functions]] [[Query plans]] [[loss functions]]", index)
    assert [(link.target, note_id) for link, note_id in resolved] == [("Loss functions", 7), ("Query plans", None)]


def test_rename_links_keeps_alias_and_heading():
    body = "[[Joins]], [[joins#Left join|left joins]] and `[[Joins]]` and [[Keys]]"
    renamed, count = rename_links(body, "Joins", "SQL joins field guide")
    assert count == 2
    assert renamed == (
        "[[SQL joins field guide]], [[SQL joins field guide#Left join|left joins]] and `[[Joins]]` and [[Keys]]"
    )


def test_rename_links_without_matches_returns_text_unchanged():
    assert rename_links("[[Other]]", "Joins", "Keys") == ("[[Other]]", 0)
