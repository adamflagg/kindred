package main

import (
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/lodging"
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

// TestLodgingRegistrySeedBootDecision pins issue #2141: the sibling error
// path in the same OnServe hook that #2054 Half 2 rewrote.
//
// Before this, the season-unresolvable branch failed the boot while the
// branch three lines below it -- SeedRegistry itself failing on a malformed
// registry file, a duplicate code, an unknown area/parent/alias-member
// reference -- only warned. Same hook, same symptom (an empty registry, every
// cabin string failing to resolve), on a likelier trigger: a hand-edited
// registry file is more prone to a JSON typo than an env var is to going
// missing.
//
// The hasRows bound #2054 Half 2 chose comes free here rather than needing a
// second check: SeedRegistry returns nil early once ANY season has rows
// (registry.go:175-185), so a non-nil error out of it already implies a
// genuinely empty registry. An absent file is likewise already nil, so a
// clone with no kindred-local keeps booting.
func TestLodgingRegistrySeedBootDecision(t *testing.T) {
	t.Run("no error: boot continues", func(t *testing.T) {
		if err := lodgingRegistrySeedBootDecision(nil); err != nil {
			t.Fatalf("expected nil when the seed succeeded, got: %v", err)
		}
	})

	t.Run("row-check failure: warns and lets the boot continue", func(t *testing.T) {
		// The loader could not even determine whether the registry already
		// has rows, so it does not know whether anything is at risk. Fail
		// open, exactly as the season branch above already does rather than
		// compounding one failure with a second, less legible one.
		logs := captureMainLogs(t)
		rowsErr := fmt.Errorf("%w: checking lodging_areas for existing rows",
			lodging.ErrRegistryRowCheck)

		if err := lodgingRegistrySeedBootDecision(rowsErr); err != nil {
			t.Fatalf("expected nil (boot continues) on a row-check failure, got: %v", err)
		}
		if !strings.Contains(logs.String(), "lodging registry") {
			t.Errorf("expected a warning logged about the registry, got:\n%s", logs.String())
		}
	})

	t.Run("bad registry file: fails the boot", func(t *testing.T) {
		fileErr := errors.New("parsing lodging registry /config/lodging_registry.json: " +
			"invalid character 'N'")

		err := lodgingRegistrySeedBootDecision(fileErr)
		if err == nil {
			t.Fatal("expected a boot error when the registry file failed to load, got nil " +
				"-- an unreadable registry must not boot to an empty one behind a warn line")
		}
		if !errors.Is(err, fileErr) {
			t.Errorf("expected the boot error to wrap the underlying load error, got: %v", err)
		}
	})
}
