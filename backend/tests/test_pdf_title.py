"""S5: readable titles for PDFs saved without a metadata title."""

from __future__ import annotations

import pytest

from app.services.ingest.pdf_title import first_heading, readable_pdf_title

ARXIV = """Provided proper attribution is provided, Google hereby grants permission to
reproduce the tables and figures in this paper solely for use in journalistic or
scholarly works.
Attention Is All You Need
Ashish Vaswani
Google Brain
avaswani@google.com"""


def test_an_id_title_becomes_the_first_heading() -> None:
    assert readable_pdf_title("1706.03762", ARXIV) == "Attention Is All You Need"


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("TCS NQT.pdf", "TCS NQT"),
        ("Unit1_Neural_Networks_Complete_Notes", "Unit1_Neural_Networks_Complete_Notes"),
        ("Attention is all you need", "Attention is all you need"),
        ("lecture-notes.PDF", "lecture-notes"),
    ],
)
def test_titles_with_words_are_kept(title: str, expected: str) -> None:
    assert readable_pdf_title(title, ARXIV) == expected


def test_generic_file_names_use_the_heading() -> None:
    assert readable_pdf_title("download.pdf", ARXIV) == "Attention Is All You Need"


def test_without_a_heading_the_title_is_unchanged() -> None:
    text = "TCS NQT is a 3 hour test with foundation and advanced sections.\nIt has two papers."
    assert first_heading(text) is None
    assert readable_pdf_title("2401.00001", text) == "2401.00001"


def test_sentences_emails_and_short_lines_are_not_titles() -> None:
    assert first_heading("a\nGoogle Brain avaswani@google.com\nThis Is A Sentence.\nDeep Residual Learning") == "Deep Residual Learning"
