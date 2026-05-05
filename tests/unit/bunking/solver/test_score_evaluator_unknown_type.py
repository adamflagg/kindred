"""Regression: unknown request_type must not abort the entire scenario score."""

import logging

from bunking.solver.score_evaluator import evaluate_scenario_score


def test_unknown_request_type_treated_as_unsatisfied(caplog):
    requests = [
        {
            "id": "r1",
            "request_type": "bunk_with",
            "source_field": "bunk_with",
            "requester_id": 1,
            "requestee_id": 2,
            "priority": 5,
        },
        {
            "id": "r2",
            "request_type": "future_unknown_type",
            "source_field": "bunk_with",
            "requester_id": 1,
            "requestee_id": 3,
            "priority": 5,
        },
    ]
    # person 1 and 2 share bunk 10; person 3 is in bunk 11
    assignments = [
        {"person_cm_id": 1, "bunk_cm_id": 10},
        {"person_cm_id": 2, "bunk_cm_id": 10},
        {"person_cm_id": 3, "bunk_cm_id": 11},
    ]
    persons = [
        {"cm_id": 1, "grade": 5, "gender": "M"},
        {"cm_id": 2, "grade": 5, "gender": "M"},
        {"cm_id": 3, "grade": 5, "gender": "M"},
    ]
    bunks = [
        {"cm_id": 10, "name": "Bunk A", "gender": "M", "max_size": 12},
        {"cm_id": 11, "name": "Bunk B", "gender": "M", "max_size": 12},
    ]

    with caplog.at_level(logging.WARNING, logger="bunking.solver.score_evaluator"):
        breakdown = evaluate_scenario_score(requests, assignments, persons, bunks)

    # r1 should be satisfied (1+2 in same bunk), r2 should be treated as unsatisfied (caught)
    assert breakdown.satisfied_requests == 1
    assert any("unknown request_type" in r.message.lower() for r in caplog.records)
