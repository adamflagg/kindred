package lodging

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
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
// `year` carries min:2010 / max:2100 from 1500000140. Without a range check
// here, a typed `to=0` parses fine, reaches app.Save, and fails the field
// validation — which the POST handler reports as a 500. That is a client error
// wearing a server error's clothes, and it tells the caller nothing.
//
// The upper bound matters for a different reason: a fat-fingered `to=2099`
// is inside no sane season but inside the field range, so it would succeed and
// create exactly the phantom season registry.go's own doc comment warns about.
func TestYearsFromQueryRejectsYearsOutsideTheFieldRange(t *testing.T) {
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
	from, to, err := yearsFor(t, "from=2026&to=2027")
	if err != nil {
		t.Fatalf("yearsFromQuery: %v", err)
	}
	if from != 2026 || to != 2027 {
		t.Errorf("from,to = %d,%d; want 2026,2027", from, to)
	}
}
