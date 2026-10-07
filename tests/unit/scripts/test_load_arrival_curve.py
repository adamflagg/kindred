"""The one-off arrival-curve loader (Scenarios addendum §S11.7). Every workbook here is built in the test with
openpyxl from fictional rows; the real workbook is never read by a test. The loader must print and store aggregates
only: no cell's text ever reaches its output."""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from scripts.financial_aid import load_arrival_curve as loader

HEADER = ["Unique ID", "Export Session Type", "Camper", "Timestamp"]  # the column is found by name, wherever it sits
NAMES = ("Emma Johnson", "Liam Garcia", "Olivia Chen", "1000001", "1000002", "1000003")


def _workbook(tmp_path: Path, rows: list[list[Any]], *, header: list[Any] = HEADER, sheet: str = "Raw Data") -> Path:
    book = openpyxl.Workbook()
    page = book.active
    assert page is not None
    page.title = sheet
    page.append(header)
    for row in rows:
        page.append(row)
    path = tmp_path / "fictional.xlsx"
    book.save(path)
    return path


ROWS: list[list[Any]] = [
    ["1000001", "Main", "Emma Johnson", datetime(2026, 1, 20, 10, 0)],  # a date-time cell
    ["1000002", "Main", "Liam Garcia", "2026/01/28 3:04:05 pm PST"],  # text with a trailing zone
    [None, None, None, None],  # a fully blank row inside the data
    ["1000003", "Main", "Olivia Chen", "1/29/2026 11:00:00 am"],  # text, month first
    [None, None, None, None],  # trailing template rows
    [None, "  ", None, None],
]


def test_the_two_text_shapes_and_a_date_time_cell_parse_and_anything_else_does_not() -> None:
    assert loader.parse_timestamp(datetime(2026, 1, 20, 10, 0)) == datetime(2026, 1, 20, 10, 0)
    assert loader.parse_timestamp("2026/01/28 3:04:05 pm PST") == datetime(2026, 1, 28, 15, 4, 5)
    assert loader.parse_timestamp("2026/03/08 8:30:00 am PDT") == datetime(2026, 3, 8, 8, 30)
    assert loader.parse_timestamp("1/29/2026 11:00:00 am") == datetime(2026, 1, 29, 11, 0)
    # An upper-case meridiem is the month-first shape's, never a zone (plan review, minor 8).
    assert loader.parse_timestamp("1/29/2026 11:00:00 AM") == datetime(2026, 1, 29, 11, 0)
    assert loader.parse_timestamp("1/29/2026 1:00:00 PM") == datetime(2026, 1, 29, 13, 0)
    # Disagreement 7: a zone other than Pacific is never read silently as Pacific.
    for bad in ("2026/01/28 3:04:05 pm EST", "soon", "2026-01-28", "", None, 46000):
        assert loader.parse_timestamp(bad) is None, bad


def test_blank_rows_are_skipped_and_every_other_row_counts(tmp_path: Path) -> None:
    assert loader.read_timestamps(_workbook(tmp_path, ROWS)) == [
        datetime(2026, 1, 20, 10, 0),
        datetime(2026, 1, 28, 15, 4, 5),
        datetime(2026, 1, 29, 11, 0),
    ]


def test_a_dry_run_prints_aggregates_only_and_writes_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    saved: list[Any] = []

    async def save(curve: Any) -> None:
        saved.append(curve)

    monkeypatch.setattr(loader, "save_curve", save)
    code = loader.main(["--workbook", str(_workbook(tmp_path, ROWS)), "--year", "2026", "--deadline", "2026-02-04"])
    out = capsys.readouterr()
    assert (code, saved) == (0, [])
    # Jan 20, 28, 29 against the Feb 4 deadline: weeks −3, −1, −1 (camp_week_offset), so 1/3, 1/3, 3/3.
    assert out.out.splitlines() == [
        "2026 arrival curve: aligned on the application deadline (2026-02-04)",
        "counted 3 · first 2026-01-20 · last 2026-01-29",
        "week -3: 33.3%",
        "week -2: 33.3%",
        "week -1: 100.0%",
        "Dry run: nothing written (add --write to store it).",
    ]
    for text in (*NAMES, "Main", "Unique ID", "pm PST"):
        assert text not in out.out + out.err


def test_write_upserts_the_curve_as_the_loader(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    saved: list[Any] = []

    async def save(curve: Any) -> None:
        saved.append(curve)

    monkeypatch.setattr(loader, "save_curve", save)
    monkeypatch.setenv("POCKETBASE_URL", "http://pocketbase.invalid:8090")
    code = loader.main(
        ["--workbook", str(_workbook(tmp_path, ROWS)), "--year", "2026", "--deadline", "2026-02-04", "--write"]
    )
    [curve] = saved
    assert (code, curve.year, curve.counted, curve.source, curve.anchor) == (0, 2026, 3, "workbook", date(2026, 2, 4))


def test_without_a_deadline_it_reads_the_approved_one_or_stores_a_calendar_curve(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def none(year: int) -> date | None:
        return None

    monkeypatch.setattr(loader, "approved_deadline", none)
    assert loader.main(["--workbook", str(_workbook(tmp_path, ROWS)), "--year", "2026"]) == 0
    assert capsys.readouterr().out.splitlines()[0] == "2026 arrival curve: aligned on the calendar (from 2026-01-01)"


def test_an_unreadable_timestamp_stops_naming_the_row_number_only(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review Focus 4: row 5 (the header is row 1) holds text that is no timestamp; nothing else may be printed."""
    saved: list[Any] = []
    monkeypatch.setattr(loader, "save_curve", lambda curve: saved.append(curve))
    monkeypatch.setenv("POCKETBASE_URL", "http://pocketbase.invalid:8090")
    rows = [*ROWS[:3], ["1000003", "Main", "Olivia Chen", "soon"]]
    code = loader.main(
        ["--workbook", str(_workbook(tmp_path, rows)), "--year", "2026", "--deadline", "2026-02-04", "--write"]
    )
    out = capsys.readouterr()
    assert (code, saved, out.out) == (2, [], "")
    assert out.err.strip() == "Raw Data row 5: the Timestamp is not a date and time. Nothing was written."
    for text in (*NAMES, "soon", "Main"):
        assert text not in out.err


def test_a_workbook_without_the_sheet_or_the_header_is_refused_by_name(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    wrong_sheet = _workbook(tmp_path, ROWS, sheet="Summary")
    assert loader.main(["--workbook", str(wrong_sheet), "--year", "2026", "--deadline", "2026-02-04"]) == 2
    assert capsys.readouterr().err.strip() == 'No sheet named "Raw Data". Nothing was written.'
    no_header = _workbook(tmp_path, ROWS, header=["Unique ID", "Export Session Type", "Camper", "Submitted"])
    assert loader.main(["--workbook", str(no_header), "--year", "2026", "--deadline", "2026-02-04"]) == 2
    assert capsys.readouterr().err.strip() == 'Raw Data row 1 has no "Timestamp" header. Nothing was written.'


def test_write_refuses_when_no_pocketbase_is_named(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Safety guard: the SDK helper defaults to the local dev server and dev credentials, so an unset POCKETBASE_URL
    must never reach a write (or an auth)."""
    saved: list[Any] = []

    async def save(curve: Any) -> None:
        saved.append(curve)

    monkeypatch.setattr(loader, "save_curve", save)
    monkeypatch.delenv("POCKETBASE_URL", raising=False)
    code = loader.main(
        ["--workbook", str(_workbook(tmp_path, ROWS)), "--year", "2026", "--deadline", "2026-02-04", "--write"]
    )
    out = capsys.readouterr()
    assert (code, saved, out.out) == (2, [], "")
    assert out.err.strip() == "Set POCKETBASE_URL to the PocketBase to write to. Nothing was written."
