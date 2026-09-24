"""kindred#2759: the Jotform bunking-request change rule, computed server-side.

Fictional names only (tests/CLAUDE.md).
"""

from __future__ import annotations

import pytest

from api.schemas.lodging import BunkingRequestVersion
from api.services.jotform_bunking import (
    coming_with_tokens,
    diff_items,
    is_name_shaped,
    normalize_request,
    request_changed,
    request_items,
    resolve_change,
)


def _v(date: str, text: str) -> BunkingRequestVersion:
    return BunkingRequestVersion(submitted_at=f"2026-{date} 09:00:00", text=normalize_request(text))


class TestNormalisation:
    @pytest.mark.parametrize("text", ["no request", "No preference.", "N/A", "none", "no", "-", "No requests", "  "])
    def test_no_request_words_mean_no_request(self, text: str) -> None:
        assert normalize_request(text) == ""

    def test_a_name_is_kept_verbatim_but_trimmed(self) -> None:
        assert normalize_request("  Emma Johnson ") == "Emma Johnson"


class TestItems:
    def test_splits_on_every_ruled_separator(self) -> None:
        text = "Emma Johnson, Liam Garcia; Riley Sam / Olivia Chen & Samuel Johnson\nOlivia Kim and Emma Patel."
        assert request_items(text) == [
            "Emma Johnson",
            "Liam Garcia",
            "Riley Sam",
            "Olivia Chen",
            "Samuel Johnson",
            "Olivia Kim",
            "Emma Patel",
        ]

    def test_a_shared_surname_is_not_repaired(self) -> None:
        # The known, accepted edge (spec §6): nothing resolves names in 2026.
        assert request_items("Emma and Olivia Chen") == ["Emma", "Olivia Chen"]

    @pytest.mark.parametrize(
        ("text", "shaped"),
        [
            ("Emma Johnson, Liam Garcia", True),
            ("", True),
            ("I would love to room with Emma", False),
            ("Whoever is quiet", False),
            ("whomever", False),
            ("Not sure yet", False),
            ("Emma Johnson Garcia Kim Patel", False),  # more than 4 words
            ("Please put me near Liam", False),
        ],
    )
    def test_name_shape(self, text: str, shaped: bool) -> None:
        assert is_name_shaped(text) is shaped


class TestDiff:
    def test_add_remove_respell_and_a_drop_keeps_its_position(self) -> None:
        items = diff_items(
            ["Emma Johnson", "Liam Garcia", "Riley Sam"],
            ["Emma Johnson", "Riley Samm", "Olivia Chen"],
        )
        assert [(i.text, i.op, i.was) for i in items] == [
            ("Emma Johnson", "keep", ""),
            ("Liam Garcia", "remove", ""),
            ("Riley Samm", "respell", "Sam"),
            ("Olivia Chen", "add", ""),
        ]

    def test_respell_shows_only_the_words_that_moved(self) -> None:
        items = diff_items(["Emma Johnston"], ["Emma Johnson"])
        assert [(i.op, i.was) for i in items] == [("respell", "Johnston")]

    def test_a_shortened_surname_reads_as_a_respelling(self) -> None:
        # The measured edge: a double-barrelled surname cut to one part passes 0.88.
        items = diff_items(["Olivia Chen-Garcia"], ["Olivia Chen"])
        assert items[0].op == "respell"

    def test_unrelated_names_are_a_remove_plus_an_add(self) -> None:
        items = diff_items(["Liam Garcia"], ["Olivia Chen"])
        assert sorted((i.op, i.text) for i in items) == [("add", "Olivia Chen"), ("remove", "Liam Garcia")]


class TestResolveChange:
    def test_one_filing_has_no_change(self) -> None:
        assert resolve_change([_v("08-03", "Emma Johnson")]) is None

    def test_identical_filings_ignore_separators_and_case(self) -> None:
        change = resolve_change([_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "emma johnson / Liam Garcia")])
        assert change is not None
        assert (change.kind, change.count, change.from_date[:10], change.to_date[:10]) == (
            "identical",
            2,
            "2026-08-03",
            "2026-08-31",
        )

    def test_name_lists_diff_first_against_current(self) -> None:
        change = resolve_change(
            [
                _v("08-03", "Emma Johnson, Liam Garcia"),
                _v("08-20", "Emma Johnson"),
                _v("09-16", "Emma Johnson, Olivia Chen"),
            ]
        )
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [
            ("Emma Johnson", "keep"),
            ("Liam Garcia", "remove"),
            ("Olivia Chen", "add"),
        ]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-09-16")

    def test_any_prose_version_falls_back_to_every_version(self) -> None:
        versions = [_v("08-03", "Emma Johnson"), _v("08-31", "I'd love to be with Emma Johnson if possible")]
        change = resolve_change(versions)
        assert change is not None
        assert change.kind == "prose"
        assert [v.text for v in change.versions] == [v.text for v in versions]

    def test_a_later_blank_refile_shows_the_requested_names_removed(self) -> None:
        # Review Focus 1, owner ruling 2026-09-24: the newer filing is current
        # even when blank; the previously requested people show as removed.
        change = resolve_change([_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "")])
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [("Emma Johnson", "remove"), ("Liam Garcia", "remove")]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-08-31")

    def test_a_blank_refile_after_prose_falls_back_to_versions(self) -> None:
        change = resolve_change([_v("08-03", "I'd love to be with Emma Johnson if possible"), _v("08-31", "")])
        assert change is not None
        assert change.kind == "prose"
        assert [v.text for v in change.versions] == ["I'd love to be with Emma Johnson if possible", ""]


class TestComingWith:
    def test_checkbox_json_is_read_in_the_ruled_order(self) -> None:
        assert coming_with_tokens("", ["With Friends", "With Family"]) == ["family", "friends"]

    def test_text_fallback_and_every_option(self) -> None:
        assert coming_with_tokens("Solo, With Friends", None) == ["solo", "friends"]
        assert coming_with_tokens("With a Partner", None) == ["partner"]
        assert coming_with_tokens("", None) == []


class TestChanged:
    """P15 (owner, 2026-09-24): the card's amber dot reads `changed`, true when
    ANY two consecutive filings differ; the panel markup stays the NET change
    between the first and latest filings."""

    def test_a_request_that_moves_and_moves_back_is_changed_with_no_net_markup(self) -> None:
        versions = [
            _v("08-03", "Emma Johnson"),
            _v("08-20", "Emma Johnson, Liam Garcia"),
            _v("09-16", "Emma Johnson"),
        ]
        assert request_changed(versions) is True
        change = resolve_change(versions)
        assert change is not None
        assert change.kind == "list"
        assert [(i.text, i.op) for i in change.items] == [("Emma Johnson", "keep")]
        assert (change.from_date[:10], change.to_date[:10]) == ("2026-08-03", "2026-09-16")

    def test_identical_filings_are_not_changed(self) -> None:
        versions = [_v("08-03", "Emma Johnson, Liam Garcia"), _v("08-31", "emma johnson / Liam Garcia")]
        assert request_changed(versions) is False

    def test_one_filing_is_not_changed(self) -> None:
        assert request_changed([_v("08-03", "Emma Johnson")]) is False
        assert request_changed([]) is False

    def test_a_blank_refile_is_changed(self) -> None:
        assert request_changed([_v("08-03", "Emma Johnson"), _v("08-31", "no request")]) is True

    def test_two_blank_filings_are_not_changed(self) -> None:
        assert request_changed([_v("08-03", "none"), _v("08-31", "")]) is False
