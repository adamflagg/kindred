package sync

import "testing"

// These tests cover kindred#2263: attendees.go's processEnrollment keys an enrollment on
// (person, session) only — SessionProgramStatus's ProgramID is never read. If CampMinder ever
// emits two SessionProgramStatus entries for the same person+session pair (one per program,
// say), the second one silently collapses onto the first. Nobody can tell whether that
// actually happens without a live API response — this counter is the observation instead.
//
// Scope is deliberately narrow (see the package comment above duplicateSessionEnrollments in
// attendees.go): this only detects and logs the event. It does not add ProgramID to any key,
// does not touch idx_attendees_unique, and does not change attendee_status_history.

func TestAttendeesSync_DuplicateSessionEnrollments_NoDuplicates(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}
	sessionStatuses := []any{
		map[string]any{"SessionID": float64(100), "ProgramID": float64(1), "StatusID": float64(2)},
		map[string]any{"SessionID": float64(200), "ProgramID": float64(1), "StatusID": float64(2)},
	}

	dupes := s.duplicateSessionEnrollments(12345, sessionStatuses)

	if len(dupes) != 0 {
		t.Fatalf("expected no duplicates, got %v", dupes)
	}
	if s.DuplicateSessionEnrollments != 0 {
		t.Fatalf("expected counter 0, got %d", s.DuplicateSessionEnrollments)
	}
}

func TestAttendeesSync_DuplicateSessionEnrollments_DetectsDuplicate(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}
	sessionStatuses := []any{
		map[string]any{"SessionID": float64(500), "ProgramID": float64(10), "StatusID": float64(2)},
		map[string]any{"SessionID": float64(500), "ProgramID": float64(20), "StatusID": float64(2)},
	}

	dupes := s.duplicateSessionEnrollments(999, sessionStatuses)

	entries, ok := dupes[500]
	if !ok {
		t.Fatalf("expected session 500 to be flagged as duplicate, got %v", dupes)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries recorded for the duplicated session, got %d", len(entries))
	}
	if s.DuplicateSessionEnrollments != 1 {
		t.Fatalf("expected counter to record 1 extra entry, got %d", s.DuplicateSessionEnrollments)
	}
}

func TestAttendeesSync_DuplicateSessionEnrollments_MissingProgramIDRecordedAsAbsent(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}
	sessionStatuses := []any{
		map[string]any{"SessionID": float64(500), "ProgramID": float64(10), "StatusID": float64(2)},
		// Second entry has no ProgramID key at all — the counter must still catch the
		// duplicate SessionID and record the absence rather than dropping the entry.
		map[string]any{"SessionID": float64(500), "StatusID": float64(2)},
	}

	dupes := s.duplicateSessionEnrollments(999, sessionStatuses)

	entries, ok := dupes[500]
	if !ok || len(entries) != 2 {
		t.Fatalf("expected 2 entries for session 500, got %v", dupes)
	}
	if entries[0] != float64(10) {
		t.Fatalf("expected first ProgramID to be 10, got %v", entries[0])
	}
	if entries[1] != nil {
		t.Fatalf("expected second (missing) ProgramID to be recorded as nil, got %v", entries[1])
	}
}

func TestAttendeesSync_DuplicateSessionEnrollments_ThreeEntriesCountsTwoExtra(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}
	sessionStatuses := []any{
		map[string]any{"SessionID": float64(700), "ProgramID": float64(1)},
		map[string]any{"SessionID": float64(700), "ProgramID": float64(2)},
		map[string]any{"SessionID": float64(700), "ProgramID": float64(3)},
	}

	dupes := s.duplicateSessionEnrollments(1, sessionStatuses)

	if len(dupes[700]) != 3 {
		t.Fatalf("expected 3 entries for session 700, got %d", len(dupes[700]))
	}
	// Three entries for one (person, session) key means two entries are "extra" beyond the
	// first — that is the count that matters for judging how often it happens over a season.
	if s.DuplicateSessionEnrollments != 2 {
		t.Fatalf("expected counter to record 2 extra entries, got %d", s.DuplicateSessionEnrollments)
	}
}

func TestAttendeesSync_DuplicateSessionEnrollments_IgnoresMalformedEntries(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}
	sessionStatuses := []any{
		"not a map",
		map[string]any{"ProgramID": float64(1)}, // missing SessionID entirely
		map[string]any{"SessionID": "not-a-number", "ProgramID": float64(1)},
		map[string]any{"SessionID": float64(300), "ProgramID": float64(1)},
	}

	dupes := s.duplicateSessionEnrollments(1, sessionStatuses)

	if len(dupes) != 0 {
		t.Fatalf("expected no duplicates among malformed/singleton entries, got %v", dupes)
	}
	if s.DuplicateSessionEnrollments != 0 {
		t.Fatalf("expected counter 0, got %d", s.DuplicateSessionEnrollments)
	}
}

func TestAttendeesSync_DuplicateSessionEnrollments_AccumulatesAcrossCalls(t *testing.T) {
	t.Parallel()

	s := &AttendeesSync{}

	// Simulates two different attendees in the same sync run, each with one duplicated
	// session. A season-wide counter must accumulate rather than reset per attendee.
	s.duplicateSessionEnrollments(1, []any{
		map[string]any{"SessionID": float64(100), "ProgramID": float64(1)},
		map[string]any{"SessionID": float64(100), "ProgramID": float64(2)},
	})
	s.duplicateSessionEnrollments(2, []any{
		map[string]any{"SessionID": float64(200), "ProgramID": float64(1)},
		map[string]any{"SessionID": float64(200), "ProgramID": float64(2)},
	})

	if s.DuplicateSessionEnrollments != 2 {
		t.Fatalf("expected counter to accumulate to 2 across calls, got %d", s.DuplicateSessionEnrollments)
	}
}
