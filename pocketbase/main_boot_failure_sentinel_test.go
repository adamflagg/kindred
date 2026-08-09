package main

import (
	"errors"
	"testing"
)

// TestBootFailureSentinel pins issue #2140: an OnServe hook error that stops
// the boot never reaches main()'s os.Exit(1) block, because
// pocketbase.Execute() runs cobra's RootCmd in a goroutine and discards its
// return value -- app.Start() comes back nil regardless of whether a
// boot-stopping hook failed. The sentinel is how main() finds out anyway: a
// hook that decides to abort the boot also records its error here, and
// main() checks it after app.Start() returns.
//
// This test cannot exercise the real fix end-to-end -- that would require
// calling os.Exit(1) inside the test process, which is destructive and
// exactly what the issue says not to do. So it pins the sentinel's
// record/get/reset contract directly: a fresh process starts with no
// recorded failure, recording one makes it observable, and resetting clears
// it back to the starting state (needed so tests don't leak boot-failure
// state into each other via the shared package-level sentinel).
func TestBootFailureSentinel(t *testing.T) {
	t.Cleanup(resetBootFailure)

	t.Run("starts nil", func(t *testing.T) {
		resetBootFailure()
		if err := bootFailure(); err != nil {
			t.Fatalf("expected no boot failure recorded yet, got: %v", err)
		}
	})

	t.Run("recording an error makes it observable", func(t *testing.T) {
		resetBootFailure()
		want := errors.New("lodging registry file present but no season is resolvable")

		recordBootFailure(want)

		got := bootFailure()
		if got == nil {
			t.Fatal("expected bootFailure() to return the recorded error, got nil")
		}
		if !errors.Is(got, want) {
			t.Errorf("expected bootFailure() to return the exact recorded error, got: %v", got)
		}
	})

	t.Run("reset clears a previously recorded failure", func(t *testing.T) {
		resetBootFailure()
		recordBootFailure(errors.New("initializing sync service: boom"))

		resetBootFailure()

		if err := bootFailure(); err != nil {
			t.Fatalf("expected bootFailure() to be nil after reset, got: %v", err)
		}
	})

	t.Run("a later record overwrites an earlier one", func(t *testing.T) {
		resetBootFailure()
		first := errors.New("first hook failure")
		second := errors.New("second hook failure")

		recordBootFailure(first)
		recordBootFailure(second)

		got := bootFailure()
		if !errors.Is(got, second) {
			t.Errorf("expected the most recent recorded error, got: %v", got)
		}
		if errors.Is(got, first) {
			t.Errorf("did not expect the first error to still be reachable, got: %v", got)
		}
	})
}
