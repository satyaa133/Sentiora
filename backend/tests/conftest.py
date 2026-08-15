import pytest


@pytest.fixture(autouse=True)
def disable_rq_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep capture tests in-process so a live Windows worker cannot race them."""

    def _unavailable() -> None:
        raise RuntimeError("rq disabled in tests")

    monkeypatch.setattr("app.services.memory_service.create_queues", _unavailable)


@pytest.fixture(autouse=True)
def disable_live_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Do not call the real embedding provider during pytest (keys in local .env)."""
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: None,
    )
