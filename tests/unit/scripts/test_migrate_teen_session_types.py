"""Tests for the teen session-type migration script."""

from unittest.mock import MagicMock

from scripts.migrate_teen_session_types import classify_new_session_type, run_migration


class TestClassifyNewSessionType:
    def test_cit_training_becomes_scit(self):
        assert classify_new_session_type("Counselor In-Training", "training") == "scit"

    def test_sit_training_becomes_scit(self):
        assert classify_new_session_type("Specialist In-Training", "training") == "scit"

    def test_tli_stays_tli(self):
        assert classify_new_session_type("Teen Leadership Institute", "tli") == "tli"

    def test_unrelated_training_session_stays_training(self):
        # Defensive: if a non-CIT/SIT session ever had type=training (e.g. staff training),
        # only rename when name matches CIT/SIT.
        assert classify_new_session_type("Staff Training Week", "training") == "training"

    def test_main_session_unchanged(self):
        assert classify_new_session_type("Session 2", "main") == "main"

    def test_idempotent_scit(self):
        assert classify_new_session_type("Counselor In-Training", "scit") == "scit"


def _make_session(id: str, name: str, session_type: str, year: int) -> MagicMock:
    """Build a mock session record. `name` is set post-construction because
    MagicMock's constructor reserves the `name` kwarg for the mock itself."""
    rec = MagicMock(id=id, session_type=session_type, year=year)
    rec.name = name
    return rec


class TestRunMigration:
    def test_updates_matching_rows_only(self):
        fake_pb = MagicMock()
        fake_pb.collection.return_value.get_full_list.return_value = [
            _make_session("a", "Counselor In-Training", "training", 2024),
            _make_session("b", "Specialist In-Training", "training", 2024),
            _make_session("c", "Teen Leadership Institute", "tli", 2024),
            _make_session("d", "Session 2", "main", 2024),
        ]
        updated = run_migration(fake_pb, dry_run=False)
        assert updated == [("a", "training", "scit"), ("b", "training", "scit")]
        update_calls = fake_pb.collection.return_value.update.call_args_list
        assert len(update_calls) == 2
        assert update_calls[0].args[0] == "a"
        assert update_calls[0].args[1] == {"session_type": "scit"}

    def test_dry_run_makes_no_updates(self):
        fake_pb = MagicMock()
        fake_pb.collection.return_value.get_full_list.return_value = [
            _make_session("a", "CIT", "training", 2023),
        ]
        updated = run_migration(fake_pb, dry_run=True)
        assert updated == [("a", "training", "scit")]
        fake_pb.collection.return_value.update.assert_not_called()

    def test_idempotent_second_run(self):
        fake_pb = MagicMock()
        fake_pb.collection.return_value.get_full_list.return_value = [
            _make_session("a", "CIT", "scit", 2023),
        ]
        updated = run_migration(fake_pb, dry_run=False)
        assert updated == []
        fake_pb.collection.return_value.update.assert_not_called()
