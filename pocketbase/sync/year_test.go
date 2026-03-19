package sync

import (
	"testing"
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

func TestParseSeasonYear_Missing(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for missing env var")
		return
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
