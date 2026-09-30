"""A scenario's request set (sub-project 9b; clean spec §7.4, §9.2; D129, D138): the note every affected figure
carries. Fictional only."""

from __future__ import annotations

from datetime import UTC, date, datetime

from bunking.financial_aid.received import split_by_received
from bunking.financial_aid.scenarios import RequestSet, RequestSetNote, request_set_note

CUTOFF = datetime(2027, 2, 2, 8, 0, tzinfo=UTC)  # the first instant after Feb 1, camp time (Pacific, PST)


def test_the_note_labels_the_figures_and_counts_what_it_left_out() -> None:
    received = {"a": CUTOFF, "b": None, "c": datetime(2027, 1, 5, tzinfo=UTC)}
    split = split_by_received(received, CUTOFF, live=received.keys())
    note = request_set_note(RequestSet("round1_deadline", date(2027, 2, 1)), split)
    assert note == RequestSetNote(
        basis="round1_deadline",
        through=date(2027, 2, 1),
        label="requests received through Feb 1, 2027",
        left_out=1,
        unknown=1,
    )
    assert RequestSetNote.model_validate(note.model_dump(mode="json")) == note
