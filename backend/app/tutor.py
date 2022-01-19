"""Grounded tutor: lexical retrieval over course sources plus an optional LLM.

In demo mode (the default) the answer is composed locally from the best-matching
source chunk. In `openai` mode the retrieved chunks are sent to an OpenAI-compatible
endpoint; if that request fails, the tutor falls back to the local answer so the
core experience never depends on network access.
"""

import logging
import re

import httpx

from .concepts import FUNCTION_WORDS
from .config import get_settings
from .mastery import recommend

log = logging.getLogger(__name__)

CHUNK_SIZE = 900
CHUNK_STEP = 750
SYSTEM_PROMPT = (
    "You are a patient adaptive tutor. Answer only from the supplied sources, say when evidence is missing, "
    "use a simple analogy, then check understanding."
)


def query_terms(query: str) -> set[str]:
    # Only function words are dropped: verbs such as "compare" still say what the learner is after.
    return set(re.findall(r"[a-z]{3,}", query.lower())) - FUNCTION_WORDS


def chunk_text(content: str, size: int = CHUNK_SIZE, step: int = CHUNK_STEP) -> list[str]:
    return [content[i : i + size] for i in range(0, len(content), step)] or [""]


def retrieve(course, query: str, limit: int = 3) -> list[tuple[str, str]]:
    terms = query_terms(query)
    scored = []
    for source in sorted(course.sources, key=lambda s: s.id):
        for index, part in enumerate(chunk_text(source.content)):
            score = sum(part.lower().count(t) for t in terms)
            scored.append((-score, source.id, index, source.name, part))
    scored.sort()
    return [(name, part) for _, _, _, name, part in scored[:limit]]


def _focus_sentence(excerpt: str, terms: set[str]) -> str:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", excerpt) if s.strip()]
    ranked = sorted(sentences, key=lambda s: (-sum(s.lower().count(t) for t in terms), sentences.index(s)))
    return " ".join(ranked[:2]) if ranked else excerpt


def demo_answer(context: list[tuple[str, str]], message: str, focus: str) -> str:
    if not context or not context[0][1].strip():
        return "The uploaded material does not contain enough information to answer that yet."
    excerpt = _focus_sentence(context[0][1], query_terms(message))[:420].strip()
    return (
        f"Here is the simplest way to think about it: {excerpt} "
        f"Think of {focus} as one step in a recipe—understand its input, the change it makes, and its output."
    )


async def _remote_answer(
    context: list[tuple[str, str]], message: str, transport: httpx.AsyncBaseTransport | None
) -> str:
    settings = get_settings()
    prompt_context = "\n\n".join(f"SOURCE {n}:\n{p}" for n, p in context)
    payload = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{prompt_context}\n\nLEARNER: {message}"},
        ],
        "temperature": 0.3,
    }
    async with httpx.AsyncClient(timeout=30, transport=transport) as client:
        response = await client.post(
            f"{settings.openai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def tutor(course, message: str, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    context = retrieve(course, message)
    citations = list(dict.fromkeys(name for name, _ in context))
    target = recommend(course.concepts).concept or (course.concepts[0].name if course.concepts else None)
    focus = target or "the core idea"
    settings = get_settings()
    mode = "demo"
    answer = None
    if settings.ai_mode == "openai" and settings.openai_api_key:
        try:
            answer = await _remote_answer(context, message, transport)
            mode = "openai"
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            log.warning("Remote tutor unavailable, using local answer: %s", exc)
            mode = "fallback"
    if answer is None:
        answer = demo_answer(context, message, focus)
    return {
        "answer": answer,
        "citations": citations,
        "follow_up": f"Can you explain {target or 'this idea'} in your own words?",
        "mode": mode,
    }
