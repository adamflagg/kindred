package rbac

import (
	"slices"
	"strings"
)

// ViewAsHeader carries a real admin's preview persona: comma-separated
// permission codenames, or "none" for a persona holding no permissions.
//
// A persona downgrades; it never grants. It is honored only when the
// DB-loaded auth record is a users record with is_admin = true, and it always
// yields is_admin = false -- so no persona can reach anything the caller could
// not already reach, which is why there is no permission allow-list here.
// The FastAPI half is bunking/rbac/view_as.py; both are pinned by
// testdata/view_as_vectors.json.
const ViewAsHeader = "X-Kindred-View-As"

const viewAsNone = "none"

// authKind is what kind of caller a request carries, as the vectors name it.
type authKind string

const (
	authKindNone      authKind = "none"
	authKindSuperuser authKind = "superuser"
	authKindUser      authKind = "user"
)

// viewAsDecision is the effective access for one request.
type viewAsDecision struct {
	Applied     bool     `json:"applied"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
}

// parseViewAs returns the persona's permissions (split, trimmed, blanks and the
// "none" sentinel dropped, deduplicated, sorted) and whether a persona was sent
// at all. A blank header is no persona.
func parseViewAs(header string) ([]string, bool) {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return nil, false
	}
	perms := []string{}
	for _, p := range strings.Split(trimmed, ",") {
		p = strings.TrimSpace(p)
		if p == "" || p == viewAsNone || slices.Contains(perms, p) {
			continue
		}
		perms = append(perms, p)
	}
	slices.Sort(perms)
	return perms, true
}

// decideViewAs is the whole policy, pure so both servers can share vectors.
func decideViewAs(kind authKind, realIsAdmin bool, realPerms []string, header string) viewAsDecision {
	unchanged := viewAsDecision{IsAdmin: realIsAdmin, Permissions: realPerms}
	if kind != authKindUser || !realIsAdmin {
		return unchanged
	}
	perms, present := parseViewAs(header)
	if !present {
		return unchanged
	}
	return viewAsDecision{Applied: true, IsAdmin: false, Permissions: perms}
}
