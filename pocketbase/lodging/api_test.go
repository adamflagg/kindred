package lodging

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/sync"
)

// yearsFor builds the minimal RequestEvent yearsFromQuery reads: a request
// carrying the two query parameters.
func yearsFor(t *testing.T, query string) (from, to int, err error) {
	t.Helper()
	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest("GET", "/?"+query, http.NoBody)
	return yearsFromQuery(re)
}

// TestYearsFromQueryRejectsYearsOutsideTheFieldRange pins that the endpoint
// validates the RANGE, not merely that the value parses.
//
// `year` carries min:2010 / max:2100 from 1500000141. Without a range check
// here, a typed `to=0` parses fine, reaches app.Save, and fails the field
// validation — which the POST handler reports as a 500. That is a client error
// wearing a server error's clothes, and it tells the caller nothing.
//
// The upper bound matters for a different reason: a fat-fingered `to=2099`
// is inside no sane season but inside the field range, so it would succeed and
// create exactly the phantom season registry.go's own doc comment warns about.
func TestYearsFromQueryRejectsYearsOutsideTheFieldRange(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, query, wantIn string }{
		{"zero to", "from=2026&to=0", "to"},
		{"below the field minimum", "from=2026&to=1999", "to"},
		{"above the field maximum", "from=2026&to=2999", "to"},
		{"negative from", "from=-1&to=2027", "from"},
		{"unparseable", "from=abc&to=2027", "from"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := yearsFor(t, tc.query); err == nil {
				t.Fatalf("yearsFromQuery(%q) succeeded; want a client error", tc.query)
			} else if !strings.Contains(err.Error(), tc.wantIn) {
				t.Errorf("error = %q, want it to name %q", err, tc.wantIn)
			}
		})
	}
}

func TestYearsFromQueryAcceptsARealSeasonPair(t *testing.T) {
	t.Parallel()
	from, to, err := yearsFor(t, "from=2026&to=2027")
	if err != nil {
		t.Fatalf("yearsFromQuery: %v", err)
	}
	if from != 2026 || to != 2027 {
		t.Errorf("from,to = %d,%d; want 2026,2027", from, to)
	}
}

// The Family Camp roster export endpoint's two testable halves: what it accepts
// off the query string, and how a builder refusal becomes a status code.
// kindred#2433.

// A synthetic weekend id: these tests parse a query string and never reach the
// database, so naming a real weekend would imply a specificity they do not have.
const testWeekendCMID = 1000001

func rosterParamsFor(t *testing.T, query string) (year, sessionCMID int, err error) {
	t.Helper()
	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest("POST", "/?"+query, http.NoBody)
	return rosterExportParams(re)
}

func TestRosterExportParamsAcceptsAWeekend(t *testing.T) {
	t.Parallel()
	year, session, err := rosterParamsFor(t, "year=2026&session=1000001")
	if err != nil {
		t.Fatalf("rosterExportParams: %v", err)
	}
	if year != 2026 || session != testWeekendCMID {
		t.Errorf("year,session = %d,%d; want 2026,%d", year, session, testWeekendCMID)
	}
}

// TestRosterExportParamsRejectsBadInput keeps a client error a 400. Without the
// range check a typed year reaches the builder, finds no session, and surfaces
// as a 404 naming a session id the caller never got wrong.
func TestRosterExportParamsRejectsBadInput(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, query, wantIn string }{
		{"missing year", "session=1000001", "year"},
		{"unparseable year", "year=abc&session=1000001", "year"},
		{"year below the field minimum", "year=1999&session=1000001", "year"},
		{"year above the field maximum", "year=2999&session=1000001", "year"},
		{"missing session", "year=2026", "session"},
		{"unparseable session", "year=2026&session=abc", "session"},
		{"zero session", "year=2026&session=0", "session"},
		{"negative session", "year=2026&session=-3", "session"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := rosterParamsFor(t, tc.query); err == nil {
				t.Fatalf("rosterExportParams(%q) succeeded; want a client error", tc.query)
			} else if !strings.Contains(err.Error(), tc.wantIn) {
				t.Errorf("error = %q, want it to name %q", err, tc.wantIn)
			}
		})
	}
}

// TestRosterExportStatusForRefusals pins the mapping. A refusal is not a server
// fault: a weekend with no enrolled campers is a thing staff can ask for and
// must be told about, not a 500 that reads as "the export is broken".
func TestRosterExportStatusForRefusals(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{"unknown session", sync.ErrRosterSessionNotFound, http.StatusNotFound},
		{"not a family weekend", sync.ErrRosterSessionNotFamily, http.StatusBadRequest},
		{"no enrolled campers", sync.ErrRosterNoEnrolledCampers, http.StatusBadRequest},
		// A misconfigured server, not a bad request.
		{"roster folder unset", sync.ErrRosterFolderNotConfigured, http.StatusInternalServerError},
		{"anything else", errors.New("drive exploded"), http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := rosterExportStatus(tc.err); got != tc.want {
				t.Errorf("rosterExportStatus(%v) = %d, want %d", tc.err, got, tc.want)
			}
		})
	}
}

// TestRosterExportStatusUnwrapsWrappedRefusals guards the mapping against the
// builder's fmt.Errorf("%w: ...") wrapping, which is what actually reaches here.
func TestRosterExportStatusUnwrapsWrappedRefusals(t *testing.T) {
	t.Parallel()
	wrapped := fmt.Errorf("building roster: %w", sync.ErrRosterNoEnrolledCampers)
	if got := rosterExportStatus(wrapped); got != http.StatusBadRequest {
		t.Errorf("rosterExportStatus(wrapped) = %d, want %d", got, http.StatusBadRequest)
	}
}
