package sync

import (
	"testing"
	"time"
)

func TestParseSeasonYear_Valid(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2026")
	year, err := ParseSeasonYear()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if year != 2026 {
		t.Fatalf("expected 2026, got %d", year)
	}
}

func TestParseSeasonYear_NonNumeric(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "abc")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for non-numeric value")
		return
	}
}

func TestParseSeasonYear_BelowRange(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2016")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for year below 2017")
		return
	}
}

func TestParseSeasonYear_AboveRange(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2051")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for year above 2050")
		return
	}
}

func TestParseSeasonYear_Boundaries(t *testing.T) {
	// Low boundary (2017)
	t.Setenv("CAMPMINDER_SEASON_ID", "2017")
	year, err := ParseSeasonYear()
	if err != nil {
		t.Fatalf("low boundary: unexpected error: %v", err)
	}
	if year != 2017 {
		t.Fatalf("low boundary: expected 2017, got %d", year)
	}

	// High boundary (2050)
	t.Setenv("CAMPMINDER_SEASON_ID", "2050")
	year, err = ParseSeasonYear()
	if err != nil {
		t.Fatalf("high boundary: unexpected error: %v", err)
	}
	if year != 2050 {
		t.Fatalf("high boundary: expected 2050, got %d", year)
	}
}

func pacific(t *testing.T, y int, m time.Month, d, hh, mm int) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("tzdata: %v", err)
	}
	return time.Date(y, m, d, hh, mm, 0, 0, loc)
}

func TestPrimarySeasonRule(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	cases := []struct {
		name string
		now  time.Time
		want int
	}{
		{"Jan 1", pacific(t, 2027, time.January, 1, 0, 0), 2027},
		{"Oct 14 23:59 PT", pacific(t, 2026, time.October, 14, 23, 59), 2026},
		{"Oct 15 00:00 PT", pacific(t, 2026, time.October, 15, 0, 0), 2027},
		{"Dec 31", pacific(t, 2026, time.December, 31, 23, 59), 2027},
		// Review Focus 5: 06:59 UTC Oct 15 is still Oct 14 in Pacific.
		{"Oct 15 06:59 UTC", time.Date(2026, time.October, 15, 6, 59, 0, 0, time.UTC), 2026},
		{"Oct 15 07:00 UTC", time.Date(2026, time.October, 15, 7, 0, 0, 0, time.UTC), 2027},
	}
	for _, c := range cases {
		got, err := PrimarySeason(c.now)
		if err != nil || got != c.want {
			t.Errorf("%s: PrimarySeason = %d, %v; want %d", c.name, got, err, c.want)
		}
	}
}

func TestPrimarySeasonOverrideWins(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2026")
	got, err := PrimarySeason(pacific(t, 2026, time.November, 1, 12, 0))
	if err != nil || got != 2026 {
		t.Fatalf("override: got %d, %v; want 2026", got, err)
	}
	if SeasonSource() != "override" {
		t.Errorf("SeasonSource = %q; want override", SeasonSource())
	}
}

func TestPrimarySeasonOverrideInvalidStillErrors(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "1999")
	if _, err := PrimarySeason(time.Now()); err == nil {
		t.Fatal("an out-of-range override must still error, as today")
	}
}

func TestSyncedSeasons(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	got, err := SyncedSeasons(pacific(t, 2026, time.October, 20, 3, 0))
	if err != nil || len(got) != 2 || got[0] != 2027 || got[1] != 2026 {
		t.Fatalf("SyncedSeasons = %v, %v; want [2027 2026]", got, err)
	}
	if SeasonSource() != "rule" {
		t.Errorf("SeasonSource = %q; want rule", SeasonSource())
	}
}

func TestParseSeasonYearUsesTheRule(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	orig := nowFn
	t.Cleanup(func() { nowFn = orig })
	nowFn = func() time.Time { return pacific(t, 2026, time.October, 16, 9, 0) }
	got, err := ParseSeasonYear()
	if err != nil || got != 2027 {
		t.Fatalf("ParseSeasonYear = %d, %v; want 2027 (no env var is no longer an error)", got, err)
	}
}

func TestMissingSeasonEnvIsNotAMissingVar(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	// Assert through the helper the check calls; if the check is inline, extract it as
	// `func seasonConfigProblem() error` and test that.
	if err := seasonConfigProblem(); err != nil {
		t.Fatalf("unset CAMPMINDER_SEASON_ID must not be a config problem: %v", err)
	}
	t.Setenv("CAMPMINDER_SEASON_ID", "abc")
	if err := seasonConfigProblem(); err == nil {
		t.Fatal("an invalid override must be reported")
	}
}

func TestSeasonLocationIsPacific(t *testing.T) {
	t.Parallel()
	if seasonLocation == nil || seasonLocation.String() != "America/Los_Angeles" {
		t.Fatalf("seasonLocation = %v; want America/Los_Angeles", seasonLocation)
	}
}
