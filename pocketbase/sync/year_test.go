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
	}
}

func TestParseSeasonYear_NonNumeric(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "abc")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for non-numeric value")
	}
}

func TestParseSeasonYear_BelowRange(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2016")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for year below 2017")
	}
}

func TestParseSeasonYear_AboveRange(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2051")
	_, err := ParseSeasonYear()
	if err == nil {
		t.Fatal("expected error for year above 2050")
	}
}

func TestParseSeasonYear_BoundaryLow(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2017")
	year, err := ParseSeasonYear()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if year != 2017 {
		t.Fatalf("expected 2017, got %d", year)
	}
}

func TestParseSeasonYear_BoundaryHigh(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2050")
	year, err := ParseSeasonYear()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if year != 2050 {
		t.Fatalf("expected 2050, got %d", year)
	}
}
