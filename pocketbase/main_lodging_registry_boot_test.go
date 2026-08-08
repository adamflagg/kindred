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
// when the registry file is present and readable yet no season is
// resolvable — that combination means an operator configured this
// deployment to have lodging data and it would otherwise silently come up
// with an empty registry behind nothing but a warn-level log line.
func TestLodgingRegistryBootDecision(t *testing.T) {
	seasonErr := errors.New("CAMPMINDER_SEASON_ID not set")

	t.Run("no registry file present: warns and lets the boot continue", func(t *testing.T) {
		logs := captureMainLogs(t)

		if err := lodgingRegistryBootDecision(seasonErr, false); err != nil {
			t.Fatalf("expected nil (boot continues) with no registry file present, got: %v", err)
		}
		if !strings.Contains(logs.String(), "lodging registry load skipped") {
			t.Errorf("expected a skip warning logged, got:\n%s", logs.String())
		}
	})

	t.Run("registry file present: fails the boot", func(t *testing.T) {
		err := lodgingRegistryBootDecision(seasonErr, true)
		if err == nil {
			t.Fatal("expected a boot error when the registry file is present but the season is unresolvable, got nil")
		}
		if !errors.Is(err, seasonErr) {
			t.Errorf("expected the boot error to wrap the underlying season error, got: %v", err)
		}
		if !strings.Contains(err.Error(), "CAMPMINDER_SEASON_ID") {
			t.Errorf("expected the boot error to name the fix (CAMPMINDER_SEASON_ID), got: %v", err)
		}
	})
}
