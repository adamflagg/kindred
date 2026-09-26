package rbac

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// viewAsVector is one row of testdata/view_as_vectors.json. The same file is
// loaded by tests/unit/rbac/test_view_as.py, so the Go and Python gates cannot
// drift apart without one suite failing.
type viewAsVector struct {
	Name            string         `json:"name"`
	Auth            authKind       `json:"auth"`
	RealIsAdmin     bool           `json:"real_is_admin"`
	RealPermissions []string       `json:"real_permissions"`
	Header          *string        `json:"header"`
	Want            viewAsDecision `json:"want"`
}

func loadViewAsVectors(t *testing.T) []viewAsVector {
	t.Helper()
	raw, err := os.ReadFile("testdata/view_as_vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var vectors []viewAsVector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("view_as_vectors.json is empty -- the parity check is checking nothing")
	}
	return vectors
}

func TestViewAsVectors(t *testing.T) {
	for _, v := range loadViewAsVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			header := ""
			if v.Header != nil {
				header = *v.Header
			}
			got := decideViewAs(v.Auth, v.RealIsAdmin, v.RealPermissions, header)
			if got.Applied != v.Want.Applied || got.IsAdmin != v.Want.IsAdmin ||
				!slices.Equal(got.Permissions, v.Want.Permissions) {
				t.Errorf("decideViewAs = %+v, want %+v", got, v.Want)
			}
		})
	}
}
