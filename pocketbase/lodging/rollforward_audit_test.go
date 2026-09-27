package lodging

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// TestLodgingAPICallsTheAuditedRollForward is a source pin (controller ruling
// 1): the POST /api/custom/lodging/roll-forward handler must call
// applyRollForwardAudited, and the raw ApplyRollForward(re.App, ...) call it
// replaces must be gone -- otherwise the tests below, which call
// applyRollForwardAudited directly, would stay green even if the real handler
// still bypassed the audit log.
func TestLodgingAPICallsTheAuditedRollForward(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}
	body := string(src)
	if !strings.Contains(body, "applyRollForwardAudited(re, from, to)") {
		t.Errorf("the roll-forward handler must call applyRollForwardAudited(re, from, to)")
	}
	if strings.Contains(body, "ApplyRollForward(re.App") {
		t.Errorf("api.go must no longer call ApplyRollForward(re.App, ...) directly; " +
			"the handler must go through applyRollForwardAudited")
	}
}

// rollForwardRequest is the handler's request event, signed in as a superuser
// (the route's permission gate is sync.RequirePermission's, tested there).
func rollForwardRequest(t *testing.T, app core.App) *core.RequestEvent {
	t.Helper()
	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	su := core.NewRecord(superusers)
	su.SetEmail("owner@example.com")
	su.SetPassword("correct-horse-battery-staple")
	if err := app.Save(su); err != nil {
		t.Fatalf("save superuser: %v", err)
	}
	e := &core.RequestEvent{App: app}
	e.Auth = su
	e.Request = httptest.NewRequest(http.MethodPost, "/api/custom/lodging/roll-forward?from=2026&to=2027", http.NoBody)
	return e
}

func unitsIn(t *testing.T, app core.App, year int) int {
	t.Helper()
	rows, err := app.FindRecordsByFilter("lodging_units", "year = {:y}", "", 0, 0, map[string]any{"y": year})
	if err != nil {
		t.Fatalf("list units: %v", err)
	}
	return len(rows)
}

func TestRollForwardWritesOneSettingsRowWithItsCounts(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	audittest.Setup(t, app)
	seedYear(t, app, 2026)

	plan, err := applyRollForwardAudited(rollForwardRequest(t, app), 2026, 2027)
	if err != nil {
		t.Fatalf("applyRollForwardAudited: %v", err)
	}
	if plan.UnitsToCreate != 3 || unitsIn(t, app, 2027) != 3 {
		t.Fatalf("plan = %+v, 2027 units = %d; want 3", plan, unitsIn(t, app, 2027))
	}
	rows := audittest.Rows(t, app)
	if len(rows) != 1 || rows[0].GetString("type") != audit.TypeSettings ||
		rows[0].GetString("action") != audit.ActionRollForward {
		t.Fatalf("rows = %d, want one settings/roll_forward row", len(rows))
	}
	detail := audittest.JSON(t, rows[0], "detail")
	if detail["from_year"] != 2026.0 || detail["to_year"] != 2027.0 ||
		detail["units_created"] != 3.0 || detail["areas_created"] != 2.0 {
		t.Errorf("detail = %v", detail)
	}
}

// Fail closed: with no audit collection the row cannot be written, and the
// roll-forward's own writes roll back with it.
func TestRollForwardIsUndoneWhenItsAuditRowFails(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	audit.Register(app, audit.Config{ServiceEmail: audittest.ServiceEmail}) // registered, but no collection
	seedYear(t, app, 2026)

	if _, err := applyRollForwardAudited(rollForwardRequest(t, app), 2026, 2027); err == nil {
		t.Fatal("the roll-forward succeeded without its audit row")
	}
	if n := unitsIn(t, app, 2027); n != 0 {
		t.Fatalf("2027 has %d units after a failed audit write, want 0", n)
	}
}
