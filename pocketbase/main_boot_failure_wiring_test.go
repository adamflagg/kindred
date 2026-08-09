package main

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// TestBootFailureWiring exercises the three OnServe hook bodies that are
// supposed to call recordBootFailure(bootErr) immediately before returning
// their error -- lodgingRegistryOnServeHook's two branches and
// syncServiceOnServeHook. main_boot_failure_sentinel_test.go pins the
// sentinel's Set/Get/Reset contract in isolation; it never called these hook
// functions, so a future edit that dropped the recordBootFailure call at any
// of the three sites (while leaving everything else, including that other
// test file, untouched) would go undetected. This test closes that gap by
// calling the extracted hook functions directly, with the fallible call each
// branch depends on substituted via a package-level seam (see the var block
// above lodgingRegistryOnServeHook's declaration in main.go), and asserting
// bootFailure() becomes non-nil afterward. See issue #2140.
func TestBootFailureWiring(t *testing.T) {
	t.Cleanup(resetBootFailure)

	t.Run("lodgingRegistryOnServeHook records a failure on the unresolvable-season branch", func(t *testing.T) {
		resetBootFailure()

		origParseSeasonYear := parseSeasonYearFn
		origRegistryHasRows := registryHasRowsFn
		origRegistryFilePresent := registryFilePresentFn
		t.Cleanup(func() {
			parseSeasonYearFn = origParseSeasonYear
			registryHasRowsFn = origRegistryHasRows
			registryFilePresentFn = origRegistryFilePresent
		})

		parseSeasonYearFn = func() (int, error) { return 0, errors.New("no season configured") }
		registryHasRowsFn = func(_ core.App) (bool, error) { return false, nil }
		registryFilePresentFn = func() bool { return true }

		e := &core.ServeEvent{}
		err := lodgingRegistryOnServeHook(e)
		if err == nil {
			t.Fatal("expected lodgingRegistryOnServeHook to return an error")
		}
		if got := bootFailure(); got == nil {
			t.Fatal("expected bootFailure() to be recorded by lodgingRegistryOnServeHook's " +
				"unresolvable-season branch, got nil -- recordBootFailure(bootErr) missing at this call site")
		} else if !errors.Is(got, err) {
			t.Errorf("expected bootFailure() to be the hook's own returned error, got: %v (hook returned: %v)", got, err)
		}
	})

	t.Run("lodgingRegistryOnServeHook records a failure on the unloadable-registry branch", func(t *testing.T) {
		resetBootFailure()

		origParseSeasonYear := parseSeasonYearFn
		origSeedRegistry := seedRegistryFn
		t.Cleanup(func() {
			parseSeasonYearFn = origParseSeasonYear
			seedRegistryFn = origSeedRegistry
		})

		parseSeasonYearFn = func() (int, error) { return 2026, nil }
		seedRegistryFn = func(_ core.App, _ int) error { return errors.New("duplicate unit code") }

		e := &core.ServeEvent{}
		err := lodgingRegistryOnServeHook(e)
		if err == nil {
			t.Fatal("expected lodgingRegistryOnServeHook to return an error")
		}
		if got := bootFailure(); got == nil {
			t.Fatal("expected bootFailure() to be recorded by lodgingRegistryOnServeHook's " +
				"unloadable-registry branch, got nil -- recordBootFailure(bootErr) missing at this call site")
		} else if !errors.Is(got, err) {
			t.Errorf("expected bootFailure() to be the hook's own returned error, got: %v (hook returned: %v)", got, err)
		}
	})

	t.Run("syncServiceOnServeHook records a failure when InitializeSyncService fails", func(t *testing.T) {
		resetBootFailure()

		origInitializeSyncService := initializeSyncServiceFn
		t.Cleanup(func() { initializeSyncServiceFn = origInitializeSyncService })

		initializeSyncServiceFn = func(_ *pocketbase.PocketBase, _ *core.ServeEvent) error {
			return errors.New("sync service init boom")
		}

		e := &core.ServeEvent{}
		err := syncServiceOnServeHook(nil, e)
		if err == nil {
			t.Fatal("expected syncServiceOnServeHook to return an error")
		}
		if got := bootFailure(); got == nil {
			t.Fatal("expected bootFailure() to be recorded by syncServiceOnServeHook, got nil -- " +
				"recordBootFailure(bootErr) missing at this call site")
		} else if !errors.Is(got, err) {
			t.Errorf("expected bootFailure() to be the hook's own returned error, got: %v (hook returned: %v)", got, err)
		}
	})
}
