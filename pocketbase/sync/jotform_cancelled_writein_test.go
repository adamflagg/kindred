package sync

import (
	"testing"

	"github.com/camp/kindred/pocketbase/jotform"
	"github.com/pocketbase/pocketbase/core"
)

// registration adds one attendee row of the test weekend with a status TEXT,
// for a person who may or may not exist yet.
func registration(t *testing.T, app core.App, cmID int, first, last string, statusID int, status string) {
	t.Helper()
	session, err := app.FindFirstRecordByFilter("camp_sessions", "cm_id = {:id}", map[string]any{"id": jfSession})
	if err != nil {
		t.Fatal(err)
	}
	person, err := app.FindFirstRecordByFilter("persons", "cm_id = {:id}", map[string]any{"id": cmID})
	pid := ""
	if err == nil {
		pid = person.Id
	} else {
		pid = saveRecord(t, app, "persons", map[string]any{
			"cm_id": cmID, "year": jfYear, "first_name": first, "last_name": last,
		})
	}
	saveRecord(t, app, "attendees", map[string]any{
		"person": pid, "person_id": cmID, "session": session.Id, "status_id": statusID, "status": status,
		"year": jfYear,
	})
}

func setStatusText(t *testing.T, app core.App, cmID int, status string) {
	t.Helper()
	att, err := app.FindFirstRecordByFilter("attendees", "person_id = {:id}", map[string]any{"id": cmID})
	if err != nil {
		t.Fatal(err)
	}
	att.Set("status", status)
	if err := app.Save(att); err != nil {
		t.Fatal(err)
	}
}

func pullOne(t *testing.T, app core.App, subs ...jotform.Submission) {
	t.Helper()
	fake := &fakeJotform{subs: map[string][]jotform.Submission{"261700000000001": subs}}
	if _, err := runJotform(t, app, fake); err != nil {
		t.Fatal(err)
	}
}

func TestJotformCancelledRegistrationMatchesItself(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	setStatusText(t, app, 1000006, "cancelled")
	pullOne(t, app, submission("6600000000000000010", "2026-08-03 09:00:00", "Liam", "Garcia", "Olivia Chen"))

	got := subRecord(t, app, "6600000000000000010")
	if got.GetString("match_status") != "cancelled" || got.GetInt("person_cm_id") != 1000006 ||
		got.GetInt("match_tier") != 1 || got.GetString("registration_status") != "cancelled" {
		t.Errorf("a filer registered but cancelled must match that registration as cancelled: %v", got.PublicExport())
	}
}

func TestJotformCancelledKeepsTheOtherStatusText(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	registration(t, app, 1000030, "Noah", "Patel", 8, "incomplete")
	pullOne(t, app, submission("6600000000000000011", "2026-08-03 09:00:00", "Noah", "Patel", ""))

	got := subRecord(t, app, "6600000000000000011")
	if got.GetString("match_status") != "cancelled" || got.GetString("registration_status") != "incomplete" {
		t.Errorf("an incomplete registration still takes this path, keeping its own status: %v", got.PublicExport())
	}
}

func TestJotformCancelledAmbiguousStaysUnmatched(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	registration(t, app, 1000031, "Ava", "Kim", 32, "cancelled")
	registration(t, app, 1000032, "Ava", "Kim", 32, "cancelled")
	pullOne(t, app, submission("6600000000000000012", "2026-08-03 09:00:00", "Ava", "Kim", ""))

	if got := subRecord(t, app, "6600000000000000012"); got.GetString("match_status") != "unmatched" ||
		got.GetInt("person_cm_id") != 0 {
		t.Errorf("two cancelled namesakes are staff's call: %v", got.PublicExport())
	}
}

func TestJotformEnrolledMatchWinsOverACancelledNamesake(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	registration(t, app, 1000033, "Olivia", "Chen", 32, "cancelled")
	pullOne(t, app, submission("6600000000000000013", "2026-08-03 09:00:00", "Olivia", "Chen", ""))

	if got := subRecord(t, app, "6600000000000000013"); got.GetString("match_status") != "auto" ||
		got.GetInt("person_cm_id") != 1000004 || got.GetString("registration_status") != "" {
		t.Errorf("the enrolled guest wins: %v", got.PublicExport())
	}
}

func TestJotformCancelledFlipsBackWhenTheGuestReEnrolls(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	setStatusText(t, app, 1000006, "cancelled")
	sub := submission("6600000000000000014", "2026-08-03 09:00:00", "Liam", "Garcia", "")
	pullOne(t, app, sub)
	if got := subRecord(t, app, "6600000000000000014"); got.GetString("match_status") != "cancelled" {
		t.Fatalf("precondition: %v", got.PublicExport())
	}

	att, err := app.FindFirstRecordByFilter("attendees", "person_id = 1000006")
	if err != nil {
		t.Fatal(err)
	}
	att.Set("status_id", 2)
	att.Set("status", "enrolled")
	if err := app.Save(att); err != nil {
		t.Fatal(err)
	}
	pullOne(t, app, sub)

	if got := subRecord(t, app, "6600000000000000014"); got.GetString("match_status") != "auto" ||
		got.GetInt("person_cm_id") != 1000006 || got.GetString("registration_status") != "" {
		t.Errorf("a re-enrolled guest must match normally on the next pull: %v", got.PublicExport())
	}
}

func TestJotformStaffAndIgnoredRowsAreNeverMadeCancelled(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	subs := []jotform.Submission{
		submission("6600000000000000015", "2026-08-03 09:00:00", "Liam", "Garcia", ""),
		submission("6600000000000000016", "2026-08-04 09:00:00", "Liam", "Garcia", ""),
	}
	pullOne(t, app, subs...)
	staff := subRecord(t, app, "6600000000000000015")
	staff.Set("match_status", "staff")
	staff.Set("person_cm_id", 1000005)
	if err := app.Save(staff); err != nil {
		t.Fatal(err)
	}
	ignored := subRecord(t, app, "6600000000000000016")
	ignored.Set("match_status", "ignored")
	ignored.Set("person_cm_id", 0)
	if err := app.Save(ignored); err != nil {
		t.Fatal(err)
	}
	pullOne(t, app, subs...)

	if got := subRecord(t, app, "6600000000000000015"); got.GetString("match_status") != "staff" ||
		got.GetInt("person_cm_id") != 1000005 {
		t.Errorf("a staff link was overwritten: %v", got.PublicExport())
	}
	if got := subRecord(t, app, "6600000000000000016"); got.GetString("match_status") != "ignored" {
		t.Errorf("an ignore was overwritten: %v", got.PublicExport())
	}
}

// A write-in link is a staff decision: while any write-in row of the weekend
// (live or any scenario) carries its key, the pull never touches it, even when
// the filer would now auto-match.
func TestJotformWriteInLinkSurvivesThePull(t *testing.T) {
	t.Parallel()
	for _, table := range []string{"lodging_write_ins", "lodging_write_ins_draft"} {
		t.Run(table, func(t *testing.T) {
			t.Parallel()
			app := newJotformTestApp(t)
			seedWeekend(t, app)
			sub := submission("6600000000000000017", "2026-08-03 09:00:00", "Olivia", "Chen", "")
			pullOne(t, app, sub)
			rec := subRecord(t, app, "6600000000000000017")
			rec.Set("match_status", "write_in")
			rec.Set("person_cm_id", 0)
			rec.Set("write_in_key", "k-olivia")
			if err := app.Save(rec); err != nil {
				t.Fatal(err)
			}
			saveRecord(t, app, table, map[string]any{
				"session_cm_id": jfSession, "year": jfYear, "occupant_name": "Olivia C", "write_in_key": "k-olivia",
				"scenario": "scen1",
			})
			pullOne(t, app, sub)

			if got := subRecord(t, app, "6600000000000000017"); got.GetString("match_status") != "write_in" ||
				got.GetString("write_in_key") != "k-olivia" || got.GetInt("person_cm_id") != 0 {
				t.Errorf("the pull cleared a live write-in link: %v", got.PublicExport())
			}
		})
	}
}

// A write-in removed everywhere is a dropped link: the filing is re-decided
// like any unmatched one (here: it auto-matches), and the key is cleared.
func TestJotformDroppedWriteInLinkIsReDecided(t *testing.T) {
	t.Parallel()
	app := newJotformTestApp(t)
	seedWeekend(t, app)
	sub := submission("6600000000000000018", "2026-08-03 09:00:00", "Olivia", "Chen", "")
	pullOne(t, app, sub)
	rec := subRecord(t, app, "6600000000000000018")
	rec.Set("match_status", "write_in")
	rec.Set("person_cm_id", 0)
	rec.Set("write_in_key", "k-gone")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	// A write-in with the key on ANOTHER weekend does not keep it alive.
	saveRecord(t, app, "lodging_write_ins", map[string]any{
		"session_cm_id": jfSession + 1, "year": jfYear, "occupant_name": "Olivia C", "write_in_key": "k-gone",
	})
	pullOne(t, app, sub)

	if got := subRecord(t, app, "6600000000000000018"); got.GetString("match_status") != "auto" ||
		got.GetInt("person_cm_id") != 1000004 || got.GetString("write_in_key") != "" {
		t.Errorf("a dropped write-in link must be re-decided: %v", got.PublicExport())
	}
}
