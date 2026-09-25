"""calculate_age must not write the raw birthdate into the logs.

Code scanning alert #389 (py/clear-text-logging-sensitive-data): the failure
branch logged the unparseable value, and the ValueError text repeats it too.
"""

import logging

from api.routers.validation import calculate_age


def test_unparseable_birthdate_returns_zero():
    assert calculate_age("not-a-date-2014") == 0.0


def test_unparseable_birthdate_is_not_logged(caplog):
    with caplog.at_level(logging.DEBUG):
        calculate_age("not-a-date-2014")

    assert caplog.records, "the parse failure should still be logged"
    for record in caplog.records:
        message = record.getMessage()
        assert "2014" not in message
        assert "not-a-date" not in message


def test_valid_birthdate_still_computes_age():
    assert calculate_age("2014-05-03") > 0
