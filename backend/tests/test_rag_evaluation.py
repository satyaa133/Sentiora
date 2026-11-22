from app.services.llm.prompts import ANSWER_SYSTEM_PROMPT
from app.services.llm.structured import TRAILER_MARKER


def test_answer_prompt_has_the_rag_v2_rules() -> None:
    prompt = ANSWER_SYSTEM_PROMPT.lower()
    assert "one unified answer" in prompt
    assert "[s2]" in prompt  # inline [S#] citation example
    assert "never paste raw source text" in prompt
    assert "general knowledge" in prompt and "say so" in prompt
    assert "never write separate" in prompt and "never repeat a point" in prompt
    assert "untrusted" in prompt


def test_answer_prompt_asks_for_the_metadata_trailer() -> None:
    """S6: one call returns the answer, its mode and follow-ups."""
    assert TRAILER_MARKER in ANSWER_SYSTEM_PROMPT
    assert '"mode: memory"' in ANSWER_SYSTEM_PROMPT
    assert "up to 3 follow-up questions" in ANSWER_SYSTEM_PROMPT
    assert "complete standalone question" in ANSWER_SYSTEM_PROMPT
