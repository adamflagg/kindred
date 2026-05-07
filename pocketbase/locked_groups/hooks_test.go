package lockedgroups

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

// ── Collection setup helpers ───────────────────────────────────────────────

// setupCollections creates the minimal three-collection schema:
//
//	saved_scenarios ← locked_groups.scenario (cascade)
//	locked_groups   ← locked_group_members.group (cascade)
//
// Only fields used by the hook are added; the full production schema has
// more but they are irrelevant here.
func setupCollections(t *testing.T, app core.App) {
	t.Helper()

	// saved_scenarios
	scenarios := core.NewBaseCollection("saved_scenarios")
	scenarios.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(scenarios); err != nil {
		t.Fatalf("save saved_scenarios: %v", err)
	}

	// locked_groups — scenario relation + year
	groups := core.NewBaseCollection("locked_groups")
	groups.Fields.Add(&core.RelationField{
		Name:          "scenario",
		CollectionId:  scenarios.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	groups.Fields.Add(&core.TextField{Name: "name"})
	groups.Fields.Add(&core.NumberField{Name: "year", Required: true})
	if err := app.Save(groups); err != nil {
		t.Fatalf("save locked_groups: %v", err)
	}

	// locked_group_members — group + attendee (represented as plain text IDs
	// to keep the test app self-contained without an attendees collection).
	// Note: no year field on locked_group_members — year lives on locked_groups.
	// The constraint is (group.scenario, attendee) unique, not (group.scenario, attendee, year).
	members := core.NewBaseCollection("locked_group_members")
	members.Fields.Add(&core.RelationField{
		Name:          "group",
		CollectionId:  groups.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	// Using a plain text field for attendee so we don't need the full attendees
	// collection in these unit tests; the hook reads attendee as a string ID.
	members.Fields.Add(&core.TextField{Name: "attendee", Required: true})
	if err := app.Save(members); err != nil {
		t.Fatalf("save locked_group_members: %v", err)
	}
}

// ── Record factory helpers ─────────────────────────────────────────────────

func makeScenario(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("saved_scenarios")
	if err != nil {
		t.Fatalf("find saved_scenarios: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("name", name)
	if err := app.Save(r); err != nil {
		t.Fatalf("save scenario: %v", err)
	}
	return r
}

func makeGroup(t *testing.T, app core.App, scenarioID, name string, year int) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("locked_groups")
	if err != nil {
		t.Fatalf("find locked_groups: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("scenario", scenarioID)
	r.Set("name", name)
	r.Set("year", year)
	if err := app.Save(r); err != nil {
		t.Fatalf("save group: %v", err)
	}
	return r
}

// makeMember creates a locked_group_members row directly (bypassing hooks).
func makeMember(t *testing.T, app core.App, groupID, attendeeID string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("locked_group_members")
	if err != nil {
		t.Fatalf("find locked_group_members: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("group", groupID)
	r.Set("attendee", attendeeID)
	if err := app.Save(r); err != nil {
		t.Fatalf("save member: %v", err)
	}
	return r
}

// tryMakeMember attempts to save a member record and returns any error.
// Unlike makeMember it does NOT fatal on error — used for "expect failure" cases.
func tryMakeMember(app core.App, groupID, attendeeID string) error {
	col, err := app.FindCollectionByNameOrId("locked_group_members")
	if err != nil {
		return err
	}
	r := core.NewRecord(col)
	r.Set("group", groupID)
	r.Set("attendee", attendeeID)
	return app.Save(r)
}

// wireTestHooks registers hooks on a core.App (tests.TestApp implements core.App).
func wireTestHooks(app core.App) {
	wireHooks(app)
}

// ── Tests ──────────────────────────────────────────────────────────────────

// TestMember_FirstGroupSucceeds: adding a camper to their first group in a
// scenario must succeed.
func TestMember_FirstGroupSucceeds(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	wireTestHooks(app)

	scenario := makeScenario(t, app, "Scenario A")
	group := makeGroup(t, app, scenario.Id, "Emma's Group", 2025)

	if err := tryMakeMember(app, group.Id, "attendee-emma"); err != nil {
		t.Fatalf("expected first membership to succeed; got error: %v", err)
	}
}

// TestMember_SecondGroupInSameScenarioFails: adding a camper to a SECOND group
// within the same scenario must fail with a 409 error that names the existing
// group.
func TestMember_SecondGroupInSameScenarioFails(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	wireTestHooks(app)

	scenario := makeScenario(t, app, "Scenario A")
	groupA := makeGroup(t, app, scenario.Id, "Liam's Group", 2025)
	groupB := makeGroup(t, app, scenario.Id, "Olivia's Group", 2025)

	// Add Liam to groupA first — should succeed.
	makeMember(t, app, groupA.Id, "attendee-liam")

	// Attempt to add Liam to groupB — should fail.
	err = tryMakeMember(app, groupB.Id, "attendee-liam")
	if err == nil {
		t.Fatal("expected error adding camper to second group in same scenario; got nil")
	}

	// The error must be a 409 ApiError that mentions "friend group".
	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) {
		t.Errorf("expected *router.ApiError; got %T: %v", err, err)
		return
	}
	if apiErr.Status != http.StatusConflict {
		t.Errorf("expected HTTP 409, got %d", apiErr.Status)
	}
	if !strings.Contains(apiErr.Message, "friend group") {
		t.Errorf("expected error message to mention 'friend group'; got: %s", apiErr.Message)
	}
}

// TestMember_DifferentScenarioSucceeds: the same camper may belong to a group
// in a DIFFERENT scenario — the constraint is scenario-scoped, not global.
func TestMember_DifferentScenarioSucceeds(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	wireTestHooks(app)

	scenarioA := makeScenario(t, app, "Scenario A")
	scenarioB := makeScenario(t, app, "Scenario B")

	groupA := makeGroup(t, app, scenarioA.Id, "Riley's Group", 2025)
	groupB := makeGroup(t, app, scenarioB.Id, "Riley's Group Copy", 2025)

	// Add Riley to group in scenario A — should succeed.
	makeMember(t, app, groupA.Id, "attendee-riley")

	// Add Riley to group in scenario B — should also succeed (different scenario).
	if err := tryMakeMember(app, groupB.Id, "attendee-riley"); err != nil {
		t.Fatalf("expected cross-scenario membership to succeed; got: %v", err)
	}
}

// TestMember_UpdateAttendeeToConflictFails: updating a member row's attendee
// to one already in a sibling group in the same scenario must fail.
//
// Setup: Samuel is in groupA. Emma is in groupB. Updating Emma's row to have
// Samuel as the attendee would give Samuel two memberships in the same scenario.
func TestMember_UpdateAttendeeToConflictFails(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)
	wireTestHooks(app)

	scenario := makeScenario(t, app, "Scenario A")
	groupA := makeGroup(t, app, scenario.Id, "Samuel's Group", 2025)
	groupB := makeGroup(t, app, scenario.Id, "Emma's Group", 2025)

	// Add Samuel to groupA and Emma to groupB.
	makeMember(t, app, groupA.Id, "attendee-samuel")
	emmaRow := makeMember(t, app, groupB.Id, "attendee-emma")

	// Attempt to change Emma's row to have Samuel as the attendee — would give
	// Samuel two memberships in the same scenario. Should fail.
	r, err := app.FindRecordById("locked_group_members", emmaRow.Id)
	if err != nil {
		t.Fatalf("find member record: %v", err)
	}
	r.Set("attendee", "attendee-samuel")
	err = app.Save(r)
	if err == nil {
		t.Fatal("expected error when updating attendee to one already in a sibling group; got nil")
	}
}
