from app.services.llm.prompts import ANSWER_SYSTEM_PROMPT, META_SYSTEM_PROMPT
from app.services.llm.structured import ANSWER_META_SCHEMA, RESPONSE_FORMAT


def test_answer_prompt_has_the_rag_v2_rules() -> None:
    prompt = ANSWER_SYSTEM_PROMPT.lower()
    assert "one unified answer" in prompt
    assert "[s2]" in prompt  # inline [S#] citation example
    assert "never paste raw source text" in prompt
    assert "general knowledge" in prompt and "say so" in prompt
    assert "never write separate" in prompt and "never repeat a point" in prompt
    assert "untrusted" in prompt


def test_metadata_schema_is_strict() -> None:
    assert RESPONSE_FORMAT["type"] == "json_schema"
    assert RESPONSE_FORMAT["json_schema"]["strict"] is True
    assert ANSWER_META_SCHEMA["additionalProperties"] is False
    assert set(ANSWER_META_SCHEMA["required"]) == {"mode", "usedSources", "followUps"}
    assert ANSWER_META_SCHEMA["properties"]["mode"]["enum"] == [
        "memory",
        "general",
        "mixed",
    ]
    assert ANSWER_META_SCHEMA["properties"]["followUps"]["maxItems"] == 3
    assert "complete, natural, standalone question" in META_SYSTEM_PROMPT
