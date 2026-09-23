package lodging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// guardAliasOverlap's tests.
//
// The resolver matches a cabin string on lower(trim(s)) and treats two rows
// whose year windows both contain the requested year as Ambiguous, resolving
// NEITHER. The database's unique index is only (alias_string, valid_from_year)
// on the raw text, so without this guard "Cabin A" and "cabin a " both save
// cleanly and every family written with that name drops into the queue with
// nothing saying why.

func saveAliasWindow(app core.App, aliasString string, from, to int) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if err != nil {
		return nil, fmt.Errorf("find lodging_unit_aliases: %w", err)
	}
	r := core.NewRecord(col)
	r.Set("alias_string", aliasString)
	r.Set("valid_from_year", from)
	r.Set("valid_to_year", to)
	if err := app.Save(r); err != nil {
		return r, fmt.Errorf("save alias %q: %w", aliasString, err)
	}
	return r, nil
}

func mustSaveAliasWindow(t *testing.T, app core.App, aliasString string, from, to int) *core.Record {
	t.Helper()
	r, err := saveAliasWindow(app, aliasString, from, to)
	if err != nil {
		t.Fatalf("save alias %q [%d,%d]: %v", aliasString, from, to, err)
	}
	return r
}

func TestAliasOverlapGuard(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		existing  string
		exFrom    int
		exTo      int
		candidate string
		from      int
		to        int
		wantBlock bool
	}{
		{"exact duplicate, both all years", "Cabin A", 0, 0, "Cabin A", 0, 0, true},
		{"differs only in case", "Cabin A", 0, 0, "CABIN a", 0, 0, true},
		{"differs only in outer spaces", "Cabin A", 0, 0, "  Cabin A ", 0, 0, true},
		{"inner spacing is significant", "Cabin  A", 0, 0, "Cabin A", 0, 0, false},
		{"different name", "Cabin A", 0, 0, "Cabin B", 0, 0, false},
		{"rename: windows touch but do not overlap", "Cabin A", 0, 2024, "cabin a", 2025, 0, false},
		{"rename: windows share one year", "Cabin A", 0, 2024, "Cabin A", 2024, 0, true},
		{"open start overlaps a bounded window", "Cabin A", 2020, 2022, "Cabin A", 0, 2021, true},
		{"later window starts after the earlier ends", "Cabin A", 2020, 2022, "Cabin A", 2023, 2025, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app := newHooksTestApp(t)
			mustSaveAliasWindow(t, app, tc.existing, tc.exFrom, tc.exTo)

			_, err := saveAliasWindow(app, tc.candidate, tc.from, tc.to)
			if tc.wantBlock && err == nil {
				t.Fatalf("expected %q [%d,%d] to be refused next to %q [%d,%d]",
					tc.candidate, tc.from, tc.to, tc.existing, tc.exFrom, tc.exTo)
			}
			if !tc.wantBlock && err != nil {
				t.Fatalf("expected %q [%d,%d] to save, got: %v", tc.candidate, tc.from, tc.to, err)
			}
		})
	}
}

// The error is the only thing the queue and the PocketBase admin UI can show,
// so it has to name the row that clashes -- "overlaps an existing alias" alone
// leaves staff hunting through 187 rows for it.
func TestAliasOverlapGuardNamesTheClash(t *testing.T) {
	t.Parallel()
	app := newHooksTestApp(t)
	mustSaveAliasWindow(t, app, "Cabin A", 0, 2024)

	_, err := saveAliasWindow(app, "cabin a", 2020, 0)
	if err == nil {
		t.Fatal("expected the overlapping alias to be refused")
	}
	msg := err.Error()
	for _, want := range []string{"Cabin A", "up to 2024"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q should mention %q", msg, want)
		}
	}
}

// Editing a row must not be refused for overlapping ITSELF, or no alias could
// ever be saved twice.
func TestAliasOverlapGuardIgnoresTheRowBeingEdited(t *testing.T) {
	t.Parallel()
	app := newHooksTestApp(t)
	r := mustSaveAliasWindow(t, app, "Cabin A", 0, 0)

	r.Set("alias_string", "cabin a")
	r.Set("valid_to_year", 2030)
	if err := app.Save(r); err != nil {
		t.Fatalf("editing an alias in place should save, got: %v", err)
	}
}

// Widening a window on update is exactly how "Extend that alias" works, and
// has to be caught when it runs into the next alias.
func TestAliasOverlapGuardCatchesAnUpdateThatWidensIntoTheNextAlias(t *testing.T) {
	t.Parallel()
	app := newHooksTestApp(t)
	old := mustSaveAliasWindow(t, app, "Cabin A", 0, 2024)
	mustSaveAliasWindow(t, app, "Cabin A", 2026, 0)

	old.Set("valid_to_year", 0)
	if err := app.Save(old); err == nil {
		t.Fatal("expected widening into the 2026-onwards alias to be refused")
	}

	old.Set("valid_to_year", 2025)
	if err := app.Save(old); err != nil {
		t.Fatalf("widening up to the next alias's first year should save, got: %v", err)
	}
}

// The registry file is loaded through validateAliases before anything is
// seeded. Checking the resolver's rule there too means a bad file fails at
// load, naming both rows, rather than partway through a seed on the hook.
func TestValidateAliasesRefusesAnAmbiguousPair(t *testing.T) {
	t.Parallel()
	units := map[string]bool{"cabin-a": true}
	y2024, y2025 := 2024, 2025

	ambiguous := []registryAlias{
		{AliasString: "Cabin A", MemberUnits: []string{"cabin-a"}},
		{AliasString: "cabin a ", MemberUnits: []string{"cabin-a"}, ValidFromYear: &y2025},
	}
	if err := validateAliases(ambiguous, units); err == nil {
		t.Fatal("expected a case-only duplicate with overlapping windows to be refused")
	}

	rename := []registryAlias{
		{AliasString: "Cabin A", MemberUnits: []string{"cabin-a"}, ValidToYear: &y2024},
		{AliasString: "cabin a", MemberUnits: []string{"cabin-a"}, ValidFromYear: &y2025},
	}
	if err := validateAliases(rename, units); err != nil {
		t.Fatalf("a rename recorded as separate windows should validate, got: %v", err)
	}
}

// The real registry is what seeds production. It holds no ambiguous pair
// today; this pins that, so the guard can never be the thing that fails a
// seed on a file nobody changed.
func TestPrivateRegistryAliasesPassTheOverlapRule(t *testing.T) {
	t.Parallel()
	path := filepath.Join("..", "..", "config", "lodging_registry.json")
	data, err := os.ReadFile(path) //nolint:gosec // G304: fixed path to local config
	if err != nil {
		if os.IsNotExist(err) {
			t.Skip("private lodging registry absent; run scripts/setup/setup-local-config.sh")
		}
		t.Fatalf("reading %s: %v", path, err)
	}
	var doc registryDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	if err := validateRegistry(&doc); err != nil {
		t.Fatalf("private registry fails validation: %v", err)
	}
}
