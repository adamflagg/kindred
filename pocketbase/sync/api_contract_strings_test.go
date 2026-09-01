package sync

import (
	"os"
	"strings"
	"testing"
)

// The three strings below are CONTRACTS, not incidental repetition, which is why
// they are stated once and pinned here rather than left inline.
//
// Two of them are user-visible API error bodies that were copied 11 and 3 times.
// The 11-way copy had already drifted: handleUnifiedSync (api.go) answered a
// missing ?year with a shorter sentence that omitted the Use ?year=YYYY hint, so
// the same failure on the same parameter read two different ways depending on
// which endpoint you hit. kindred#2666 left that divergence alone on purpose --
// changing it changes an API response, which is an owner's call, not a
// refactor's -- and it is the reason the other eleven became one constant: a
// twelfth copy cannot drift if there is nothing to copy. The call was made in
// kindred#2665 and the twelfth now uses the constant too.
//
// The third is the required-column list for the bunk-requests CSV upload, which
// was written out twice -- once by the upload handler that accepts the file and
// once by the sync that parses it. Those two must agree or a file is accepted at
// upload and fails later inside the sync run.
//
// These tests pin the exact bytes. A constant makes the string easy to change in
// one place, which is the point; it also makes it easy to change ACCIDENTALLY,
// which is what these assertions are for.

func TestAPIErrorMessagesKeepTheirExactWording(t *testing.T) {
	t.Parallel()

	if got, want := errMissingYearParam, "Missing required year parameter. Use ?year=YYYY"; got != want {
		t.Errorf("errMissingYearParam = %q, want %q -- this is a user-visible API "+
			"error body; changing it changes the contract", got, want)
	}

	if got, want := errInvalidSessionParam,
		"Invalid session parameter. Must be 'all' or a numeric session cm_id."; got != want {
		t.Errorf("errInvalidSessionParam = %q, want %q -- this is a user-visible API "+
			"error body; changing it changes the contract", got, want)
	}
}

// TestNoHandlerWritesTheShortYearLiteral is the other half of the test below, and it
// deliberately is NOT another entry in that one's table. That table asserts a literal
// appears EXACTLY ONCE (its declaration); the short form must appear ZERO times, so an
// entry there would pass before this change and fail after it -- TDD inverted, with a
// failure message advising the opposite of what is wanted.
//
// The count is of the QUOTED form. That matters: the bare phrase is a prefix of the long
// constant, so an unquoted count can never reach zero. It also used to appear inside a
// prose comment in api.go explaining why the divergence was being left alone -- that
// comment is gone with the divergence, but a future one that quotes the string would make
// this test red for a reason that is not a real regression. Say it unquoted if you must.
func TestNoHandlerWritesTheShortYearLiteral(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}

	const short = `"Missing required year parameter"`
	if n := strings.Count(string(source), short); n != 0 {
		t.Errorf("api.go writes the short year literal %d times, want 0. Every handler "+
			"answers a missing ?year with errMissingYearParam, which carries the "+
			"\"Use ?year=YYYY\" hint. kindred#2665.", n)
	}
}

// TestAPIErrorMessagesAreStatedOnce fails if a handler goes back to writing the
// literal inline. Counting occurrences in the source is the only way to catch a
// re-introduced copy: a copy compiles, passes every behavioral test, and is
// invisible until it drifts.
func TestAPIErrorMessagesAreStatedOnce(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}
	text := string(source)

	for _, tc := range []struct {
		name    string
		literal string
	}{
		{"errMissingYearParam", `"Missing required year parameter. Use ?year=YYYY"`},
		{"errInvalidSessionParam", `"Invalid session parameter. Must be 'all' or a numeric session cm_id."`},
	} {
		if n := strings.Count(text, tc.literal); n != 1 {
			t.Errorf("api.go contains the %s literal %d times, want exactly 1 (its "+
				"declaration). Use the constant instead of writing the string inline.",
				tc.name, n)
		}
	}
}

// TestBunkRequestRequiredColumnsAreSharedByUploadAndParse pins the upload
// contract and fails if either side hand-writes the list again.
func TestBunkRequestRequiredColumnsAreSharedByUploadAndParse(t *testing.T) {
	t.Parallel()

	want := []string{"PersonID", "Last Name", "First Name"}
	if len(bunkRequestRequiredColumns) != len(want) {
		t.Fatalf("bunkRequestRequiredColumns = %q, want %q", bunkRequestRequiredColumns, want)
	}
	for i, col := range want {
		if bunkRequestRequiredColumns[i] != col {
			t.Errorf("bunkRequestRequiredColumns[%d] = %q, want %q -- these are the "+
				"header names in the uploaded CampMinder CSV, not display labels",
				i, bunkRequestRequiredColumns[i], col)
		}
	}

	// The handler that accepts the upload and the sync that parses it must read
	// the same list. Either writing its own is the drift this fuses away.
	literal := `[]string{"PersonID", "Last Name", "First Name"}`
	for _, name := range []string{"api.go", "bunk_requests.go"} {
		source, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		want := 0
		if name == "bunk_requests.go" {
			want = 1 // the declaration lives here
		}
		if n := strings.Count(string(source), literal); n != want {
			t.Errorf("%s writes the required-column list literally %d times, want %d -- "+
				"use bunkRequestRequiredColumns so upload validation and parsing cannot "+
				"disagree about which columns the CSV must have", name, n, want)
		}
	}
}
