package rbac

import (
	"regexp"
	"testing"
)

// authTraversal matches a rule that walks a relation off the auth record
// (@request.auth.<field>.<field>). PocketBase resolves those with a DB join,
// not from e.Auth, so viewAsMiddleware's clone would not reach them.
var authTraversal = regexp.MustCompile(`@request\.auth\.\w+\.\w+`)

func TestAuthTraversalPattern(t *testing.T) {
	for rule, want := range map[string]bool{
		`@request.auth.team.name = "x"`:          true,
		bunkingManageRule:                        false,
		`@request.auth.id != ""`:                 false,
		`@request.auth.collectionName = "users"`: false,
	} {
		if got := authTraversal.MatchString(rule); got != want {
			t.Errorf("authTraversal.MatchString(%q) = %v, want %v", rule, got, want)
		}
	}
}

// TestBootedSchemaNoAuthRelationTraversal fails if any rule in the schema booted
// from the real pb_migrations traverses a relation through @request.auth.
func TestBootedSchemaNoAuthRelationTraversal(t *testing.T) {
	for _, c := range loadBootedCollections(t) {
		for which, rule := range map[string]*string{
			"listRule": c.ListRule, "viewRule": c.ViewRule, "createRule": c.CreateRule,
			"updateRule": c.UpdateRule, "deleteRule": c.DeleteRule,
		} {
			if rule != nil && authTraversal.MatchString(*rule) {
				t.Errorf("%s.%s traverses a relation through @request.auth, which the view-as persona cannot reach: %s",
					c.Name, which, *rule)
			}
		}
	}
}
