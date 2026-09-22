"""The adult-weekend cabin attribution rule (adult camper journey spec §4.2).

Every case here is one the 2026-09-16 prod snapshot actually contains (spec §4.3).
Fixtures are fictional; only the SHAPE of the dates mirrors the real weekends.
"""

from __future__ import annotations

from datetime import UTC, datetime

from api.services.person_housing_rules import (
    ADULT_WEEKEND_CABIN_FIELD_CM_IDS,
    AdultWeekend,
    AttributedCabin,
    CabinValue,
    attribute_adult_cabins,
    parse_instant,
    weekend_last_day_ends,
)

OLD_FIELD = 212997  # Adult Weekend Program Cabin, 2022-23
NEW_FIELD = 223823  # Reportable Family Camp Cabin, 2022+
WW = 1001  # a Women's-Weekend-shaped session (fictional id)
DD = 1002  # a Divorce-&-Discovery-shaped session (fictional id)


def _at(text: str) -> datetime:
    """A UTC instant from 'YYYY-MM-DDTHH:MM'."""
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def _value(year: int, raw: str, written: str | None, field: int = NEW_FIELD) -> CabinValue:
    return CabinValue(year=year, field_cm_id=field, raw=raw, written_at=_at(written) if written else None)


def _weekend(year: int, session_cm_id: int, last_day: str) -> AdultWeekend:
    """`last_day` is the session's end date, stored as midnight Pacific of that day."""
    ends = weekend_last_day_ends(f"{last_day} 07:00:00.000Z")
    assert ends is not None
    return AdultWeekend(year=year, session_cm_id=session_cm_id, last_day_ends=ends)


def _no_codes(raw: str, year: int) -> tuple[str, ...]:
    return ()


class TestParsing:
    def test_campminder_seven_digit_fractions_parse(self) -> None:
        assert parse_instant("2022-10-20T06:04:03.8176448+00:00") == datetime(2022, 10, 20, 6, 4, 3, 817644, tzinfo=UTC)

    def test_pocketbase_dates_parse(self) -> None:
        assert parse_instant("2025-10-19 07:00:00.000Z") == datetime(2025, 10, 19, 7, tzinfo=UTC)

    def test_blank_and_garbage_are_unknown_not_errors(self) -> None:
        assert parse_instant("") is None
        assert parse_instant("   ") is None
        assert parse_instant("not a date") is None

    def test_a_naive_value_is_read_as_utc(self) -> None:
        assert parse_instant("2022-09-15") == datetime(2022, 9, 15, tzinfo=UTC)

    def test_the_weekend_is_over_24h_after_its_last_day_stamp(self) -> None:
        assert weekend_last_day_ends("2022-10-02 07:00:00.000Z") == datetime(2022, 10, 3, 7, tzinfo=UTC)

    def test_an_unreadable_end_date_has_no_end(self) -> None:
        assert weekend_last_day_ends("") is None


class TestAllowlist:
    def test_only_the_two_cabin_fields(self) -> None:
        """Spec §4.1. Widening this is how Race, financial aid and the
        salary-bearing `20XX History` staff fields would reach the wire."""
        assert ADULT_WEEKEND_CABIN_FIELD_CM_IDS == (212997, 223823)


class TestOneWeekend:
    def test_a_single_value_labels_the_weekend(self) -> None:
        out = attribute_adult_cabins(
            [_value(2024, "River F", "2024-10-10T18:00")], [_weekend(2024, WW, "2024-10-20")], _no_codes
        )
        assert out == [AttributedCabin(year=2024, session_cm_id=WW, cabin_name="River F", cabin_name_raw="River F")]

    def test_the_name_is_the_raw_string_trimmed_never_the_present_unit_name(self) -> None:
        """Owner ruling 2026-09-22: as recorded that year. Resolving to a
        renamed unit changes nothing about the label, and inner spacing
        survives (housing_lookup_key: it is significant)."""

        def renamed(raw: str, year: int) -> tuple[str, ...]:
            return ("wawona",)

        out = attribute_adult_cabins(
            [_value(2022, "  Golden Triangle -  Doctor's House ", "2022-09-15T12:00", OLD_FIELD)],
            [_weekend(2022, WW, "2022-10-02")],
            renamed,
        )
        assert out[0].cabin_name == "Golden Triangle -  Doctor's House"
        assert out[0].cabin_name_raw == "  Golden Triangle -  Doctor's House "

    def test_the_same_text_in_both_fields_collapses_to_one(self) -> None:
        out = attribute_adult_cabins(
            [_value(2023, "Ridge C", "2023-10-16T12:00", OLD_FIELD), _value(2023, " ridge c", "2023-10-16T12:00")],
            [_weekend(2023, WW, "2023-10-22")],
            _no_codes,
        )
        assert len(out) == 1

    def test_two_spellings_of_one_unit_collapse_to_the_later_write(self) -> None:
        def same_unit(raw: str, year: int) -> tuple[str, ...]:
            return ("tenaya-1",)

        out = attribute_adult_cabins(
            [
                _value(2022, "Golden Triangle -Tenaya 1", "2022-09-14T12:00", OLD_FIELD),
                _value(2022, "Golden Triangle - Tenaya 1", "2022-09-15T12:00"),
            ],
            [_weekend(2022, WW, "2022-10-02")],
            same_unit,
        )
        assert [c.cabin_name for c in out] == ["Golden Triangle - Tenaya 1"]

    def test_a_value_written_after_the_weekend_loses_to_one_written_before(self) -> None:
        """The 2022-10-19 mis-key (spec §4.3): the real September cabin, plus a
        value typed in the D&D batch 17 days after her only weekend ended."""
        out = attribute_adult_cabins(
            [_value(2022, "River H", "2022-09-15T12:00", OLD_FIELD), _value(2022, "River C", "2022-10-19T19:01")],
            [_weekend(2022, WW, "2022-10-02")],
            _no_codes,
        )
        assert [c.cabin_name for c in out] == ["River H"]

    def test_the_latest_value_written_before_the_weekend_wins(self) -> None:
        """The 2023 re-assignment: Sep 19, then Oct 10, weekend ends Oct 15."""
        out = attribute_adult_cabins(
            [
                _value(2023, "Health Center - Upstairs 1", "2023-09-19T12:00", OLD_FIELD),
                _value(2023, "Golden Triangle - Tenaya 3", "2023-10-10T12:00"),
            ],
            [_weekend(2023, WW, "2023-10-15")],
            _no_codes,
        )
        assert [c.cabin_name for c in out] == ["Golden Triangle - Tenaya 3"]

    def test_a_value_written_during_the_last_day_still_counts_as_before(self) -> None:
        """end 2023-10-15 07:00Z + 24h = 2023-10-16 07:00Z; 06:59Z is still the last day."""
        out = attribute_adult_cabins(
            [_value(2023, "Early", "2023-09-01T12:00", OLD_FIELD), _value(2023, "Last day", "2023-10-16T06:59")],
            [_weekend(2023, WW, "2023-10-15")],
            _no_codes,
        )
        assert [c.cabin_name for c in out] == ["Last day"]

    def test_a_lone_late_edit_is_still_the_answer(self) -> None:
        """1 of 1,027 single values. The Go ingest treats one weekend as certain."""
        out = attribute_adult_cabins(
            [_value(2023, "Ridge B", "2023-11-02T12:00")], [_weekend(2023, WW, "2023-10-15")], _no_codes
        )
        assert [c.cabin_name for c in out] == ["Ridge B"]

    def test_two_places_written_at_the_same_instant_is_no_cabin(self) -> None:
        out = attribute_adult_cabins(
            [_value(2024, "River A", "2024-10-10T12:00", OLD_FIELD), _value(2024, "River B", "2024-10-10T12:00")],
            [_weekend(2024, WW, "2024-10-20")],
            _no_codes,
        )
        assert out == []

    def test_an_undated_value_counts_as_the_earliest_write(self) -> None:
        out = attribute_adult_cabins(
            [_value(2024, "Undated", None, OLD_FIELD), _value(2024, "Dated", "2024-10-01T12:00")],
            [_weekend(2024, WW, "2024-10-20")],
            _no_codes,
        )
        assert [c.cabin_name for c in out] == ["Dated"]


class TestTwoWeekends:
    def test_a_value_written_between_them_belongs_to_the_second(self) -> None:
        """8 of the 10 measured cases. The first weekend's value was
        overwritten, so a blank there is the honest answer."""
        out = attribute_adult_cabins(
            [_value(2024, "Tioga 4", "2024-10-21T12:00")],
            [_weekend(2024, DD, "2024-04-28"), _weekend(2024, WW, "2024-10-27")],
            _no_codes,
        )
        assert out == [AttributedCabin(year=2024, session_cm_id=WW, cabin_name="Tioga 4", cabin_name_raw="Tioga 4")]

    def test_one_value_per_field_labels_both_weekends(self) -> None:
        """The two 2022 women: 212997 written before WW, 223823 before D&D."""
        out = attribute_adult_cabins(
            [_value(2022, "Ridge L", "2022-09-15T12:00", OLD_FIELD), _value(2022, "River H", "2022-10-24T12:00")],
            [_weekend(2022, WW, "2022-10-02"), _weekend(2022, DD, "2022-10-30")],
            _no_codes,
        )
        assert {(c.session_cm_id, c.cabin_name) for c in out} == {(WW, "Ridge L"), (DD, "River H")}

    def test_a_value_written_before_both_belongs_to_the_first(self) -> None:
        """2025 Adults Unplugged + D&D — owner ruling 2026-09-22."""
        out = attribute_adult_cabins(
            [_value(2025, "El Cap", "2025-10-06T12:00")],
            [_weekend(2025, WW, "2025-10-12"), _weekend(2025, DD, "2025-10-26")],
            _no_codes,
        )
        assert [(c.session_cm_id, c.cabin_name) for c in out] == [(WW, "El Cap")]

    def test_a_value_written_after_every_weekend_belongs_to_the_last(self) -> None:
        out = attribute_adult_cabins(
            [_value(2025, "Late", "2025-12-01T12:00")],
            [_weekend(2025, WW, "2025-10-12"), _weekend(2025, DD, "2025-10-26")],
            _no_codes,
        )
        assert [(c.session_cm_id, c.cabin_name) for c in out] == [(DD, "Late")]

    def test_weekends_order_by_when_they_end_not_by_input_order(self) -> None:
        out = attribute_adult_cabins(
            [_value(2024, "Tioga 4", "2024-10-21T12:00")],
            [_weekend(2024, WW, "2024-10-27"), _weekend(2024, DD, "2024-04-28")],
            _no_codes,
        )
        assert [c.session_cm_id for c in out] == [WW]

    def test_a_weekend_listed_twice_counts_once(self) -> None:
        out = attribute_adult_cabins(
            [_value(2024, "River F", "2024-10-10T12:00")],
            [_weekend(2024, WW, "2024-10-20"), _weekend(2024, WW, "2024-10-20")],
            _no_codes,
        )
        assert len(out) == 1

    def test_the_same_place_written_before_each_of_two_weekends_labels_both(self) -> None:
        """PR1 review fix (2026-09-22, controller ruling): collapsing same-place
        values BEFORE assigning them to weekends kept only the later write, so
        the earlier weekend lost a value it genuinely had. Collapsing must
        happen PER WEEKEND, after assignment: "River H" written once before WW
        ends and again (a different field) before DD ends is two separate
        answers, one per weekend, not one collapsed answer for whichever
        weekend the later write lands in."""
        out = attribute_adult_cabins(
            [_value(2022, "River H", "2022-09-15T12:00", OLD_FIELD), _value(2022, "River H", "2022-10-24T12:00")],
            [_weekend(2022, WW, "2022-10-02"), _weekend(2022, DD, "2022-10-30")],
            _no_codes,
        )
        assert {(c.session_cm_id, c.cabin_name) for c in out} == {(WW, "River H"), (DD, "River H")}

    def test_three_weekends_each_take_their_own_value(self) -> None:
        """Already passes under both the old and new order -- included as a
        regression guard alongside the two-weekend fix above, since three
        weekends is the shape most likely to expose an off-by-one in the
        per-weekend pool split."""
        au = 1003  # an Adults-Unplugged-shaped session (fictional id)
        out = attribute_adult_cabins(
            [
                _value(2022, "Ridge A", "2022-08-01T12:00"),
                _value(2022, "Ridge B", "2022-09-01T12:00"),
                _value(2022, "Ridge C", "2022-10-01T12:00"),
            ],
            [
                _weekend(2022, WW, "2022-08-10"),
                _weekend(2022, DD, "2022-09-10"),
                _weekend(2022, au, "2022-10-10"),
            ],
            _no_codes,
        )
        assert {(c.session_cm_id, c.cabin_name) for c in out} == {
            (WW, "Ridge A"),
            (DD, "Ridge B"),
            (au, "Ridge C"),
        }


class TestScope:
    def test_a_year_with_no_enrolled_weekend_gets_nothing(self) -> None:
        """A cancelled enrollment is never passed in as a weekend (54 such cabins)."""
        assert attribute_adult_cabins([_value(2023, "Ridge H", "2023-10-16T12:00")], [], _no_codes) == []

    def test_a_weekend_with_no_value_gets_nothing(self) -> None:
        assert attribute_adult_cabins([], [_weekend(2026, WW, "2026-10-18")], _no_codes) == []

    def test_values_only_attribute_within_their_own_year(self) -> None:
        assert (
            attribute_adult_cabins(
                [_value(2023, "Ridge A", "2023-10-01T12:00")], [_weekend(2024, WW, "2024-10-20")], _no_codes
            )
            == []
        )

    def test_a_blank_value_is_ignored(self) -> None:
        assert (
            attribute_adult_cabins(
                [_value(2024, "   ", "2024-10-01T12:00")], [_weekend(2024, WW, "2024-10-20")], _no_codes
            )
            == []
        )

    def test_output_is_ordered_by_year_then_weekend(self) -> None:
        out = attribute_adult_cabins(
            [
                _value(2025, "B", "2025-10-01T12:00"),
                _value(2023, "A", "2023-10-01T12:00"),
            ],
            [_weekend(2025, WW, "2025-10-19"), _weekend(2023, WW, "2023-10-15")],
            _no_codes,
        )
        assert [c.year for c in out] == [2023, 2025]
