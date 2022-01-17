"""Deterministic concept extraction from learning material.

The extractor is intentionally lexical (no model calls) so that it runs offline and
always produces the same concepts for the same text. Repeated two-word phrases such
as "gradient descent" are preferred over single words, and the selected concepts are
returned in the order they are first introduced in the material, which is also the
order used to build the prerequisite chain.
"""

import re
from collections import Counter
from dataclasses import dataclass

# fmt: off
FUNCTION_WORDS = {
    "about", "after", "also", "because", "before", "being", "between", "could", "does", "each", "from", "have",
    "into", "more", "most", "much", "other", "same", "should", "some", "such", "than", "that", "their", "them",
    "then", "there", "these", "they", "this", "those", "through", "under", "until", "using", "very", "what",
    "when", "where", "which", "while", "will", "with", "within", "would", "your", "only", "over", "well", "both",
    "like", "just", "even", "every", "too", "can", "may", "must", "the", "and", "for", "are", "was", "were",
    "has", "had", "its", "not", "one", "two", "all", "any", "how", "who", "why", "our", "but", "yet", "per",
    "via", "few", "own", "out", "off", "now", "you", "his", "her", "she", "him", "did", "let", "way", "least",
    "another", "together", "instead", "rather", "often", "always", "never", "usually", "typically", "therefore",
    "occasionally", "already", "without", "across", "against", "during", "inside", "whose", "whether", "unless",
}
# Words that are meaningful in a question but never name a concept on their own.
DESCRIPTIVE_WORDS = {
    # Verbs that describe what a concept does
    "make", "makes", "made", "used", "uses", "helps", "measures", "controls", "requires", "improve", "improves",
    "predicts", "performs", "found", "called", "known", "given", "keep", "keeps", "produce", "produces",
    "show", "shows", "compare", "compares", "gives", "give", "tells", "states", "reveals", "reduces", "reduce",
    "adds", "passes", "applying", "follow", "follows", "read", "reads", "moves", "becomes", "turns", "repeat",
    "repeats", "start", "decide", "decides", "means", "seeing", "stores", "directs", "assemble", "encodes",
    "separate", "include", "includes", "including", "combines", "fills", "groups", "speeds", "succeed", "fail",
    "introduces", "computes", "adjusts", "shares", "disables", "rescales", "preventing", "relying", "fitting",
    "discourages", "estimates", "assigns", "approaches", "grows", "reflects", "summarise", "summarises",
    "organises", "splits", "refers", "enforces", "filter", "sort", "leave", "leaves", "enters", "lack", "build",
    "captures", "releases", "breaks", "transports", "modifies", "packages", "pass", "carries", "results",
    "predict", "inherited", "hidden", "present",
    # Adjectives and quantities that leak through as "concepts"
    "large", "small", "different", "value", "values", "common", "possible", "simple", "specific", "several",
    "extra", "early", "local", "half", "identical", "harmful", "neutral", "beneficial", "observable", "basic",
    "living", "correct", "excessive", "discrete", "continuous", "measurable", "expected", "actual", "unseen",
    "slow", "slower", "faster", "stable", "wider", "extreme", "plausible", "typical", "unrelated", "overlapping",
    "harder", "easier", "accurate", "deliberately", "efficient", "responsible", "repeated", "duplicated",
    "missing", "matching", "concurrent", "uncommitted", "random", "symmetric", "linear", "numeric", "ordered",
    "number", "numbers", "study", "studies", "versions", "version", "copy", "copies", "choices", "direction",
    "data", "information", "shape", "shapes", "size", "sizes", "part", "parts", "kind", "kinds", "type", "types",
    "thing", "things", "change", "changes",
}
# fmt: on
STOP = FUNCTION_WORDS | DESCRIPTIVE_WORDS
MAX_SUMMARY = 300
# Single-word concepts need at least MIN_HEAD letters; words inside a phrase may be shorter
# ("primary key", "bar chart"). Tokens always have at least three letters.
MIN_HEAD = 4
MIN_TAIL = 3


@dataclass(frozen=True)
class ExtractedConcept:
    name: str
    summary: str


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if len(s.strip()) > 35]


def _runs(sentence: str) -> list[list[str]]:
    """Split a sentence into runs of adjacent words of three or more letters.

    Punctuation and very short words ("a", "of") end a run, so a phrase is only ever
    formed from words that really sit next to each other ("primary key, a column" does
    not produce "key column").
    """
    runs: list[list[str]] = []
    for clause in re.split(r"[,;:()\"]+", sentence.lower()):
        run: list[str] = []
        for word in re.findall(r"[a-z][a-z'-]*", clause):
            word = word.split("'")[0]
            if len(word) >= 3:
                run.append(word)
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
    return runs


def _tokens(sentence: str) -> list[str]:
    return [word for run in _runs(sentence) for word in run]


def _singular(token: str, vocabulary: set[str]) -> str:
    """Fold a simple plural ("tables") onto its singular when the singular also occurs in the text."""
    if token.endswith("s") and not token.endswith("ss") and token[:-1] in vocabulary:
        return token[:-1]
    return token


def _candidates(sentences: list[str]) -> tuple[Counter, Counter, dict[str, int]]:
    """Count unigrams and adjacent non-stopword bigrams, remembering first appearance."""
    runs = [run for sentence in sentences for run in _runs(sentence)]
    vocabulary = {token for run in runs for token in run}
    unigrams: Counter = Counter()
    bigrams: Counter = Counter()
    first_seen: dict[str, int] = {}
    position = 0
    for run in runs:
        tokens = [_singular(token, vocabulary) for token in run]
        for index, token in enumerate(tokens):
            position += 1
            if token in STOP:
                continue
            if len(token) >= MIN_HEAD:
                unigrams[token] += 1
                first_seen.setdefault(token, position)
            following = tokens[index + 1] if index + 1 < len(tokens) else None
            if following is not None and following not in STOP and len(following) >= MIN_TAIL:
                phrase = f"{token} {following}"
                bigrams[phrase] += 1
                first_seen.setdefault(phrase, position)
    return unigrams, bigrams, first_seen


def rank_phrases(text: str, limit: int = 6) -> list[str]:
    """Return up to `limit` key phrases, ordered by first appearance in the text."""
    sentences = split_sentences(text) or [text]
    unigrams, bigrams, first_seen = _candidates(sentences)
    repeated = {phrase: count for phrase, count in bigrams.items() if count >= 2}
    scores: dict[str, float] = {phrase: count * 2.5 for phrase, count in repeated.items()}
    for word, count in unigrams.items():
        covered = sum(c for phrase, c in repeated.items() if word in phrase.split())
        remaining = count - covered
        if remaining > 0:
            scores[word] = float(remaining)
    ranked = sorted(scores, key=lambda phrase: (-scores[phrase], first_seen[phrase], phrase))
    chosen: list[str] = []
    for phrase in ranked:
        words = set(phrase.split())
        # A word already covered by a chosen phrase (or a phrase containing a chosen word) adds nothing new.
        if any(words <= set(old.split()) or set(old.split()) <= words for old in chosen):
            continue
        chosen.append(phrase)
        if len(chosen) == limit:
            break
    return sorted(chosen, key=lambda phrase: first_seen[phrase])


def _summary_for(phrase: str, sentences: list[str], used: set[str]) -> str:
    pattern = re.compile(rf"\b{re.escape(phrase)}s?\b", re.I)
    matches = [(match.start(), index, s) for index, s in enumerate(sentences) if (match := pattern.search(s))]
    if not matches:
        return f"A key idea in this learning material related to {phrase}."
    unused = [m for m in matches if m[2] not in used] or matches
    # Prefer the sentence that introduces the phrase earliest, which is usually its definition.
    _, _, sentence = min(unused)
    return sentence[:MAX_SUMMARY]


def extract_concepts(text: str, limit: int = 6) -> list[ExtractedConcept]:
    sentences = split_sentences(text)
    phrases = rank_phrases(text, limit)
    used: set[str] = set()
    summaries: dict[str, str] = {}
    # Multi-word phrases are the most specific, so they pick their defining sentence first.
    for phrase in sorted(phrases, key=lambda p: -len(p.split())):
        summaries[phrase] = _summary_for(phrase, sentences, used)
        used.add(summaries[phrase])
    result = [ExtractedConcept(phrase.replace("-", " ").title(), summaries[phrase]) for phrase in phrases]
    return result or [ExtractedConcept("Core Idea", text.strip()[:MAX_SUMMARY])]
