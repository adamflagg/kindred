package audit

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// TestManagementAllowlist pins the Settings collections (spec §4.2 step 5). It
// fails if a collection is added or removed without updating this list, which
// is the point: the allowlist changes by PR, never quietly.
func TestManagementAllowlist(t *testing.T) {
	t.Parallel()
	want := []string{
		"config",
		"lodging_areas",
		"lodging_ingest_issues",
		"lodging_session_status",
		"lodging_unit_aliases",
		"lodging_units",
	}
	if got := ManagementAllowlist(); !slices.Equal(got, want) {
		t.Fatalf("ManagementAllowlist() = %v, want %v", got, want)
	}
}

// TestRedactedKeys pins the one denylist (spec §5 "never stored").
func TestRedactedKeys(t *testing.T) {
	t.Parallel()
	want := []string{"clientsecret", "oldpassword", "password", "passwordconfirm", "passwordhash", "secret", "tokenkey"}
	if !slices.Equal(redactedKeys, want) {
		t.Fatalf("redactedKeys = %v, want %v", redactedKeys, want)
	}
	if got := derivedFields["users"]; !slices.Equal(got, []string{"cached_permissions", "last_seen"}) {
		t.Fatalf(`derivedFields["users"] = %v, want [cached_permissions last_seen]`, got)
	}
}

func TestClassify(t *testing.T) {
	t.Parallel()
	user := Actor{Kind: ActorUser, Email: "alex.rivera@example.com"}
	root := Actor{Kind: ActorSuperuser, Email: "owner@example.com"}
	cases := []struct {
		collection string
		actor      Actor
		want       string
		logged     bool
	}{
		{"admin_audit_log", root, "", false},
		{"users", user, TypeAccess, true},
		{"users", root, TypeAccess, true},
		{"_superusers", root, TypeAccess, true},
		{"roles", user, TypeRoles, true},
		{"permission_descriptions", user, TypeRoles, true},
		{"user_roles", root, TypeAccess, true},
		{"user_roles", user, TypeAccess, true},
		{"config", user, TypeSettings, true},
		{"config", root, TypePBAdmin, true},
		{"lodging_units", user, TypeSettings, true},
		{"bunk_requests", user, "", false},
		{"bunk_requests", root, TypePBAdmin, true},
		{"aid_decisions", user, "", false},
	}
	for _, c := range cases {
		got, logged := classify(c.collection, c.actor)
		if got != c.want || logged != c.logged {
			t.Errorf("classify(%q, %s) = (%q, %v), want (%q, %v)", c.collection, c.actor.Kind, got, logged, c.want, c.logged)
		}
	}
}

func TestChangesKeepsOnlyWhatMatters(t *testing.T) {
	t.Parallel()
	// A create keeps after's non-empty values only.
	created := map[string]any{"name": "Cabin 14", "beds": 8.0, "has_ac": false, "notes": ""}
	b, a, fields := changes("lodging_units", nil, created)
	if b != nil || len(a) != 2 || a["name"] != "Cabin 14" || !slices.Equal(fields, []string{"beds", "name"}) {
		t.Errorf("create: before=%v after=%v fields=%v", b, a, fields)
	}
	// An update keeps only changed fields, both sides.
	b, a, fields = changes("lodging_units",
		map[string]any{"name": "Cabin 14", "beds": 8.0}, map[string]any{"name": "Cabin 14", "beds": 10.0})
	if len(b) != 1 || b["beds"] != 8.0 || a["beds"] != 10.0 || !slices.Equal(fields, []string{"beds"}) {
		t.Errorf("update: before=%v after=%v fields=%v", b, a, fields)
	}
	// A delete keeps the full before.
	b, a, fields = changes("roles", map[string]any{"name": "Registrar", "slug": "registrar"}, nil)
	if a != nil || len(b) != 2 || !slices.Equal(fields, []string{"name", "slug"}) {
		t.Errorf("delete: before=%v after=%v fields=%v", b, a, fields)
	}
	// users.cached_permissions is derived noise, never stored.
	_, _, fields = changes("users",
		map[string]any{"cached_permissions": []any{}}, map[string]any{"cached_permissions": []any{"x"}})
	if len(fields) != 0 {
		t.Errorf("cached_permissions produced fields %v", fields)
	}
}

func TestChangesRedactsSecretsAtAnyDepth(t *testing.T) {
	t.Parallel()
	before := map[string]any{"password": "$2a$10$oldhash", "tokenKey": "oldkey", "name": "Sam"}
	after := map[string]any{"password": "$2a$10$newhash", "tokenKey": "newkey", "name": "Sam"}
	b, a, fields := changes("users", before, after)
	if !slices.Equal(fields, []string{"password", "tokenKey"}) {
		t.Fatalf("fields = %v, want the password and tokenKey change to be visible", fields)
	}
	for _, side := range []map[string]any{b, a} {
		raw, _ := json.Marshal(side)
		for _, secret := range []string{"oldhash", "newhash", "oldkey", "newkey"} {
			if strings.Contains(string(raw), secret) {
				t.Fatalf("%q leaked into %s", secret, raw)
			}
		}
		if side["password"] != RedactedValue || side["tokenKey"] != RedactedValue {
			t.Fatalf("side = %v, want both values %q", side, RedactedValue)
		}
	}
	// Nested and dotted: a collection's OAuth2 provider secret, a settings path.
	provider := map[string]any{"name": "oidc", "clientSecret": "s3cr3t"}
	nested := redact(map[string]any{"oauth2": map[string]any{"providers": []any{provider}}})
	raw, _ := json.Marshal(nested)
	if strings.Contains(string(raw), "s3cr3t") {
		t.Fatalf("a nested clientSecret leaked: %s", raw)
	}
	dotted := redact(map[string]any{"smtp.password": "hunter2", "s3.secret": "abc", "meta.appName": "Kindred"})
	if dotted["smtp.password"] != RedactedValue || dotted["s3.secret"] != RedactedValue ||
		dotted["meta.appName"] != "Kindred" {
		t.Fatalf("dotted redaction = %v", dotted)
	}
}

func TestCapSideMarksWhatItCuts(t *testing.T) {
	t.Parallel()
	huge := strings.Repeat("x", maxValueBytes+10)
	capped := capSide(map[string]any{"notes": huge, "name": "Cabin 14"})
	if capped["name"] != "Cabin 14" || !strings.HasPrefix(capped["notes"].(string), "[truncated: ") {
		t.Fatalf("one oversized value must become a marker, got %v", capped["notes"])
	}
	many := map[string]any{}
	for i := range 40 {
		many[strings.Repeat("f", 3)+string(rune('a'+i%26))+strings.Repeat("g", i)] = strings.Repeat("v", 3000)
	}
	capped = capSide(many)
	raw, _ := json.Marshal(capped)
	if len(raw) > maxSideBytes+4096 {
		t.Fatalf("capped side is %d bytes, over the cap plus the marker", len(raw))
	}
	if _, ok := capped[TruncatedKey]; !ok {
		t.Fatal("a side over the cap must name its dropped fields under _truncated")
	}
}

// newAuthRecord is an in-memory users or superuser record; nothing is saved.
func newAuthRecord(superuser bool, email, name string) *core.Record {
	var c *core.Collection
	if superuser {
		c = core.NewAuthCollection(core.CollectionNameSuperusers)
	} else {
		c = core.NewAuthCollection("users")
		c.Fields.Add(&core.TextField{Name: "name"})
	}
	r := core.NewRecord(c)
	r.Id = "rec" + strings.Repeat("0", 12)
	r.SetEmail(email)
	if name != "" {
		r.Set("name", name)
	}
	return r
}

func TestResolveActor(t *testing.T) {
	t.Parallel()
	cfg := Config{ServiceEmail: "kindred-service@kindred.invalid"}
	admin := newAuthRecord(false, "alex.rivera@example.com", "Alex Rivera")
	service := newAuthRecord(true, "Kindred-Service@kindred.invalid", "")
	owner := newAuthRecord(true, "owner@example.com", "")
	standIn := newAuthRecord(false, "va0123456789abc@"+ViewAsEmailDomain, "View as: No role")

	event := func(auth, realAdmin *core.Record) *core.RequestEvent {
		e := &core.RequestEvent{}
		e.Auth = auth
		if realAdmin != nil {
			e.Set(RealAuthKey, realAdmin)
		}
		return e
	}

	if _, ok := resolveActor(event(nil, nil), cfg); ok {
		t.Error("a guest request must not be logged")
	}
	if _, ok := resolveActor(event(service, nil), cfg); ok {
		t.Error("Kindred's service account (email matched case-insensitively) must not be logged")
	}
	if a, ok := resolveActor(event(service, nil), Config{}); !ok || a.Kind != ActorSuperuser {
		t.Error("with no service email configured, the service superuser is logged like anyone")
	}
	if a, ok := resolveActor(event(owner, nil), cfg); !ok || a.Kind != ActorSuperuser || a.Email != "owner@example.com" {
		t.Errorf("a named superuser = %+v, %v", a, ok)
	}
	a, ok := resolveActor(event(standIn, admin), cfg)
	if !ok || a.Email != "alex.rivera@example.com" || a.Name != "Alex Rivera" {
		t.Errorf("under view-as the real admin must win, got %+v", a)
	}
	if a, ok := resolveActor(event(standIn, nil), cfg); !ok || a.Name != UnidentifiedPreviewer || a.Email != "" {
		t.Errorf("a stand-in without realAuth = %+v, want %q", a, UnidentifiedPreviewer)
	}
}
