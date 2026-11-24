"""In-process stand-in for a chat provider, for load tests only (D17).

``LLM_PROVIDER=fake`` makes every AI call use this client instead of a real
provider: it waits like a model would, then returns (or streams) a fixed answer
that cites the first source and ends with the metadata trailer, so the whole
Explain with AI path (AI gate, streaming, trailer parsing, usage rows) runs
without a network call or a bill. ``Settings`` refuses it in production.

It mimics the parts of the OpenAI SDK that ``rag_service`` reads:
``client.chat.completions.create(...)`` returning a completion, or an iterator
of chunks when ``stream=True``.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

# Roughly a fast hosted model: first token after 0.4 s, the rest over ~1.5 s.
FIRST_TOKEN_SECONDS = 0.4
STREAM_SECONDS = 1.5

ANSWER = (
    "This is a load-test answer from the fake AI provider. It stands in for a "
    "written explanation of the quoted passage and cites it [S1]. No real model "
    "was called and nothing left the server."
)
TRAILER = "\n<<<META>>>\nmode: memory\n- What else did I save about this?\n"
PROMPT_TOKENS = 1200
COMPLETION_TOKENS = 80


def _usage() -> SimpleNamespace:
    return SimpleNamespace(
        prompt_tokens=PROMPT_TOKENS, completion_tokens=COMPLETION_TOKENS, cost=0.0
    )


def _chunk(text: str | None, *, usage: SimpleNamespace | None = None) -> SimpleNamespace:
    choices = [] if text is None else [SimpleNamespace(delta=SimpleNamespace(content=text))]
    return SimpleNamespace(choices=choices, usage=usage)


class _Completions:
    def __init__(self, sleep: Any) -> None:
        self._sleep = sleep

    def create(self, *, stream: bool = False, **_: Any) -> Any:
        self._sleep(FIRST_TOKEN_SECONDS)
        text = ANSWER + TRAILER
        if not stream:
            self._sleep(STREAM_SECONDS)
            message = SimpleNamespace(content=text)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=_usage())
        return self._stream(text)

    def _stream(self, text: str) -> Iterator[SimpleNamespace]:
        words = text.split(" ")
        pause = STREAM_SECONDS / max(1, len(words))
        for index, word in enumerate(words):
            yield _chunk(word if index == 0 else " " + word)
            self._sleep(pause)
        yield _chunk(None, usage=_usage())


class FakeChatClient:
    """Drop-in for ``openai.OpenAI`` where ``rag_service`` uses it."""

    def __init__(self, sleep: Any = time.sleep) -> None:
        self.chat = SimpleNamespace(completions=_Completions(sleep))
