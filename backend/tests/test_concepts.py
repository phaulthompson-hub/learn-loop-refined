import pytest

from app.concepts import FUNCTION_WORDS, STOP, extract_concepts, rank_phrases, split_sentences
from app.seeding.materials import BIOLOGY_MATERIALS, NORTHWIND_MATERIALS, SQL_TEXT, VIZ_TEXT
from app.seeding.materials import ML_TEXT as DEMO_TEXT

NOTES = """Photosynthesis converts light energy into chemical energy inside the chloroplast.
The chloroplast contains chlorophyll, a pigment that absorbs light energy.
Cellular respiration releases chemical energy from glucose in the mitochondria.
Light energy drives the production of glucose, and cellular respiration consumes glucose again.
Chlorophyll gives leaves their green colour and captures light energy for the chloroplast."""

MATERIALS = {m.key: m.text for m in NORTHWIND_MATERIALS + BIOLOGY_MATERIALS}


def names(text: str, limit: int = 6) -> list[str]:
    return [c.name for c in extract_concepts(text, limit)]


def test_split_sentences_drops_short_fragments():
    sentences = split_sentences("Short one. This sentence is clearly long enough to be kept around.\nTiny")
    assert sentences == ["This sentence is clearly long enough to be kept around."]


def test_repeated_two_word_phrases_become_concepts():
    found = names(NOTES)
    assert "Light Energy" in found
    assert "Cellular Respiration" in found
    assert "Chemical Energy" in found


def test_phrases_are_ordered_by_first_appearance():
    phrases = rank_phrases(NOTES)
    positions = [NOTES.lower().index(p) for p in phrases]
    assert positions == sorted(positions)


def test_single_words_covered_by_a_phrase_are_not_duplicated():
    words = [set(name.lower().split()) for name in names(NOTES)]
    for index, current in enumerate(words):
        others = words[:index] + words[index + 1 :]
        assert not any(current <= other or other <= current for other in others)


def test_phrases_sharing_one_word_can_both_be_concepts():
    found = names(NOTES)
    assert {"Light Energy", "Chemical Energy"} <= set(found)


def test_limit_is_respected():
    assert len(extract_concepts(NOTES, limit=3)) == 3


def test_stop_words_never_become_concepts():
    filler = "These which would their there about. " * 10
    text = filler + "Entropy measures disorder and entropy always grows over time."
    found = {name.lower() for name in names(text)}
    assert not found & STOP
    assert "entropy" in found


@pytest.mark.parametrize("word", ["keeps", "different", "produces", "shows", "compare", "value", "data"])
def test_descriptive_words_are_stop_words(word):
    assert word in STOP


def test_tutor_keeps_meaningful_verbs_out_of_the_function_word_list():
    assert FUNCTION_WORDS < STOP
    assert "compare" not in FUNCTION_WORDS
    assert "the" in FUNCTION_WORDS


def test_short_second_word_forms_a_phrase():
    found = names(SQL_TEXT)
    assert "Primary Key" in found
    assert "Foreign Key" in found


def test_short_first_word_forms_a_phrase_but_not_a_single_concept():
    assert "Bar Chart" in names(VIZ_TEXT)
    text = "The bar holds drinks. " * 3 + "A bar exam is long and hard for every candidate who sits the paper."
    assert "Bar" not in names(text)


def test_phrases_do_not_span_punctuation_or_skipped_words():
    text = (
        "Every table needs a primary key, a column that identifies each row uniquely in the table. "
        "The primary key, a column again, is indexed so primary key lookups stay fast for readers."
    )
    found = [n.lower() for n in names(text)]
    assert "key column" not in found
    assert "primary key" in found


def test_plurals_fold_onto_the_singular_when_both_appear():
    text = (
        "A table stores facts about one kind of entity in the database. "
        "Tables are linked by keys, and joining tables recombines the facts again later. "
        "Each table is described by a schema that names its columns and their types clearly."
    )
    found = names(text)
    assert "Table" in found
    assert "Tables" not in found


def test_plural_only_words_are_kept_as_written():
    assert "Examples" in names(DEMO_TEXT)


def test_each_concept_summary_mentions_the_concept():
    for concept in extract_concepts(NOTES):
        assert concept.name.lower() in concept.summary.lower()


@pytest.mark.parametrize("key", sorted(MATERIALS))
def test_seeded_materials_yield_six_distinct_concepts(key):
    concepts = extract_concepts(MATERIALS[key])
    assert len(concepts) == 6
    assert len({c.name for c in concepts}) == 6
    assert not {c.name.lower() for c in concepts} & STOP
    for concept in concepts:
        assert concept.name.lower() in concept.summary.lower().replace("-", " ")


def test_summaries_are_distinct_when_possible():
    summaries = [c.summary for c in extract_concepts(DEMO_TEXT)]
    assert len(summaries) == len(set(summaries))


def test_summary_prefers_the_defining_sentence():
    concepts = {c.name: c.summary for c in extract_concepts(DEMO_TEXT)}
    assert concepts["Gradient Descent"].startswith("Gradient descent is an optimization method")
    assert concepts["Loss Function"].startswith("The loss function measures")


def test_phrases_choose_their_defining_sentence_before_single_words():
    concepts = {c.name: c.summary for c in extract_concepts(SQL_TEXT)}
    assert concepts["Primary Key"].startswith("Every table should have a primary key")
    assert concepts["Foreign Key"].startswith("A foreign key is a column")


def test_demo_text_extraction_is_stable():
    first = extract_concepts(DEMO_TEXT)
    assert first == extract_concepts(DEMO_TEXT)
    assert [c.name for c in first] == [
        "Machine Learning",
        "Performance",
        "Examples",
        "Model",
        "Loss Function",
        "Gradient Descent",
    ]


def test_seeded_sql_and_biology_concepts():
    assert names(MATERIALS["sql"]) == [
        "Table",
        "Column",
        "Primary Key",
        "Foreign Key",
        "Join",
        "Database Normalization",
    ]
    assert "Cellular Respiration" in names(MATERIALS["cells"])


def test_text_without_keywords_falls_back_to_core_idea():
    concepts = extract_concepts("   the and for are was were has had   ")
    assert len(concepts) == 1
    assert concepts[0].name == "Core Idea"


def test_summaries_are_truncated():
    long_sentence = "Thermodynamics " + "thermodynamics explains heat and work " * 30 + "."
    concepts = extract_concepts(long_sentence + " " + long_sentence)
    assert all(len(c.summary) <= 300 for c in concepts)
