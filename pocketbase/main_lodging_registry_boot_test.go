package main

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

// captureMainLogs mirrors the lodging package's captureLogs helper (unexported
// there, so this package needs its own copy) — redirects the default slog
// logger to a buffer for one test.
func captureMainLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// TestLodgingRegistryBootDecision pins issue #2054 Half 2: a season-less boot
// must still succeed for a clone with no private registry file (the existing
// graceful-degradation contract main.go documents), but must FAIL the boot
// when the registry file is present and readable, no season is resolvable,
// AND the database has no lodging rows yet — that three-way combination
// means an operator configured this deployment to have lodging data, this is
// a genuinely fresh/empty boot, and it would otherwise silently come up with
// an empty registry behind nothing but a warn-level log line.
//
// The third input (hasRows) matters on its own: SeedRegistry is a bootstrap
// that no-ops once any season already has rows (registry.go:175-185), so a
// production deployment with an already-seeded registry has nothing at risk
// when CAMPMINDER_SEASON_ID goes missing or malformed after the fact — the
// existing data is untouched either way. Gating only on file-presence, with
// no hasRows check, would turn a harmless env var hiccup on an
// already-seeded deployment into a full boot failure for a condition
// SeedRegistry itself would have silently ignored.
func TestLodgingRegistryBootDecision(t *testing.T) {
	seasonErr := errors.New("CAMPMINDER_SEASON_ID not set")

	t.Run("no registry file present: warns and lets the boot continue", func(t *testing.T) {
		logs := captureMainLogs(t)

		if err := lodgingRegistryBootDecision(seasonErr, false, false); err != nil {
			t.Fatalf("expected nil (boot continues) with no registry file present, got: %v", err)
		}
		if !strings.Contains(logs.String(), "lodging registry load skipped") {
			t.Errorf("expected a skip warning logged, got:\n%s", logs.String())
		}
	})

	t.Run("registry file present, database already has rows: warns and lets the boot continue", func(t *testing.T) {
		// This is the shape of a real production deployment: the registry
		// file is bind-mounted AND the DB was already seeded by a prior
		// successful boot. SeedRegistry would no-op here regardless of the
		// season, so a broken CAMPMINDER_SEASON_ID must not take the whole
		// app down over data that was never actually at risk.
		logs := captureMainLogs(t)

		if err := lodgingRegistryBootDecision(seasonErr, true, true); err != nil {
			t.Fatalf("expected nil (boot continues) when the database already has lodging rows, got: %v", err)
		}
		if !strings.Contains(logs.String(), "lodging registry load skipped") {
			t.Errorf("expected a skip warning logged, got:\n%s", logs.String())
		}
	})

	t.Run("registry file present, database empty: fails the boot", func(t *testing.T) {
		err := lodgingRegistryBootDecision(seasonErr, true, false)
		if err == nil {
			t.Fatal("expected a boot error when the registry file is present, " +
				"the database is empty, and the season is unresolvable, got nil")
		}
		if !errors.Is(err, seasonErr) {
			t.Errorf("expected the boot error to wrap the underlying season error, got: %v", err)
		}
		if !strings.Contains(err.Error(), "CAMPMINDER_SEASON_ID") {
			t.Errorf("expected the boot error to name the fix (CAMPMINDER_SEASON_ID), got: %v", err)
		}
	})
}
