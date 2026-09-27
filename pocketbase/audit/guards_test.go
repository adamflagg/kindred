package audit_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

const existingRow = "auditrow0000001"

// appWithOneEntry is newApp signed in as the owner's superuser, with one entry
// already in the log (saved in Go, the only way an entry is ever written).
func appWithOneEntry(t testing.TB, headers map[string]string) *tests.TestApp {
	t.Helper()
	clear(headers)
	app := newApp(t)
	authAs(t, headers, createSuperuser(t, app, ownerEmail))
	col, err := app.FindCollectionByNameOrId(audit.CollectionName)
	if err != nil {
		t.Fatalf("find audit log: %v", err)
	}
	row := core.NewRecord(col)
	row.Id = existingRow
	row.Set("type", audit.TypeAccess)
	row.Set("action", audit.ActionCreate)
	row.Set("actor_kind", audit.ActorUser)
	mustSave(t, app, row)
	return app
}

// entrySurvives: the existing entry and the collection are exactly as they were.
func entrySurvives(t testing.TB, app *tests.TestApp, _ *http.Response) {
	t.Helper()
	row, err := app.FindRecordById(audit.CollectionName, existingRow)
	if err != nil || row.GetString("action") != audit.ActionCreate {
		t.Fatalf("the existing entry was changed or removed (err %v)", err)
	}
	col, err := app.FindCollectionByNameOrId(audit.CollectionName)
	if err != nil || col.ListRule != nil {
		t.Fatalf("the collection was changed or removed (err %v)", err)
	}
}

// TestEntriesCannotBeChangedThroughTheAPI: nobody, a superuser included, creates,
// edits, deletes or truncates an entry through the API (spec §5).
func TestEntriesCannotBeChangedThroughTheAPI(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp { return appWithOneEntry(t, headers) }
	scenarios := []tests.ApiScenario{
		{
			Name: "creating an entry through the API is refused", Method: http.MethodPost,
			URL:  "/api/collections/admin_audit_log/records",
			Body: strings.NewReader(`{"type":"access","action":"create","actor_kind":"user"}`),
		},
		{
			Name: "editing an entry through the API is refused", Method: http.MethodPatch,
			URL:  "/api/collections/admin_audit_log/records/" + existingRow,
			Body: strings.NewReader(`{"action":"tampered"}`),
		},
		{
			Name: "deleting an entry through the API is refused", Method: http.MethodDelete,
			URL: "/api/collections/admin_audit_log/records/" + existingRow,
		},
		{
			Name: "truncating the log is refused", Method: http.MethodDelete,
			URL: "/api/collections/admin_audit_log/truncate", ExpectedStatus: 400,
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers, s.AfterTestFunc = factory, headers, entrySurvives
		if s.ExpectedStatus == 0 {
			s.ExpectedStatus = 403
		}
		s.ExpectedContent = []string{`"status":`}
		s.Test(t)
	}
}

func TestGoWritesCannotChangeTheLog(t *testing.T) {
	app := newApp(t)
	defer app.Cleanup()
	col, err := app.FindCollectionByNameOrId(audit.CollectionName)
	if err != nil {
		t.Fatalf("find audit log: %v", err)
	}
	row := core.NewRecord(col)
	row.Set("type", audit.TypeAccess)
	row.Set("action", audit.ActionCreate)
	row.Set("actor_kind", audit.ActorUser)
	mustSave(t, app, row)

	row.Set("action", "tampered")
	if err := app.Save(row); err == nil {
		t.Fatal("app.Save changed an audit entry")
	}
	if err := app.Delete(row); err == nil {
		t.Fatal("app.Delete removed an audit entry")
	}
	if err := app.TruncateCollection(col); err == nil {
		t.Fatal("TruncateCollection emptied the audit log")
	}
	if n := len(audittest.Rows(t, app)); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}
