package audit_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// lazyBody builds a request body when the handler first reads it: after
// BeforeTestFunc, so a body can be derived from the scenario's own app.
type lazyBody struct {
	build func() []byte
	r     io.Reader
}

func (l *lazyBody) Read(p []byte) (int, error) {
	if l.r == nil {
		l.r = bytes.NewReader(l.build())
	}
	return l.r.Read(p) //nolint:wrapcheck // test reader
}

// TestTheCollectionCannotBeChangedThroughTheAPI: only a migration may change the
// log's schema (spec §5), and an import is an API path that could (a changed
// definition, or deleteMissing).
func TestTheCollectionCannotBeChangedThroughTheAPI(t *testing.T) {
	headers := map[string]string{}
	var app *tests.TestApp
	factory := func(t testing.TB) *tests.TestApp {
		app = appWithOneEntry(t, headers)
		return app
	}
	importPublic := &lazyBody{build: func() []byte {
		col, _ := app.FindCollectionByNameOrId(audit.CollectionName)
		public := ""
		col.ListRule = &public // a public list rule: exactly what must never land
		raw, _ := json.Marshal(map[string]any{"collections": []any{col}, "deleteMissing": false})
		return raw
	}}
	scenarios := []tests.ApiScenario{
		{
			Name: "changing the schema through the API is refused", Method: http.MethodPatch,
			URL: "/api/collections/admin_audit_log", Body: strings.NewReader(`{"listRule":""}`),
		},
		{Name: "deleting the collection is refused", Method: http.MethodDelete, URL: "/api/collections/admin_audit_log"},
		{
			Name: "an import that would change the log is refused", Method: http.MethodPut,
			URL: "/api/collections/import", Body: importPublic,
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers, s.AfterTestFunc = factory, headers, entrySurvives
		s.ExpectedStatus = 400
		s.ExpectedContent = []string{"append-only"}
		s.Test(t)
	}
}

// TestSchemaAndSettingsChangesArePBAdmin: collection and app settings requests
// are superuser-only, so they are always PB Admin (spec §4.2).
func TestSchemaAndSettingsChangesArePBAdmin(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		app := newApp(t)
		authAs(t, headers, createSuperuser(t, app, ownerEmail))
		return app
	}
	scenarios := []tests.ApiScenario{
		{
			Name: "creating a collection", Method: http.MethodPost, URL: "/api/collections",
			Body:           strings.NewReader(`{"name":"probe_schema","type":"base","fields":[{"name":"label","type":"text"}]}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"name":"probe_schema"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypePBAdmin)
				expect(t, row, map[string]string{
					"action": "schema_change", "collection": "probe_schema", "actor_email": ownerEmail,
				})
				detail := audittest.JSON(t, row, "detail")
				if detail["operation"] != "create" || !strings.Contains(audittest.Dump(t, row), `label`) {
					t.Errorf("detail = %v", detail)
				}
			},
		},
		{
			Name: "changing a collection's rule", Method: http.MethodPatch, URL: "/api/collections/lodging_units",
			Body:           strings.NewReader(`{"listRule":"@request.auth.id != ''"}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"name":"lodging_units"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypePBAdmin)
				expect(t, row, map[string]string{"fields": "listRule", "target_label": "lodging_units"})
			},
		},
		{
			// PocketBase blanks SMTP and S3 secrets when it serializes settings
			// (core/settings_model.go MarshalJSON); the denylist backs it up.
			Name: "changing app settings never records the SMTP password", Method: http.MethodPatch, URL: "/api/settings",
			Body:           strings.NewReader(`{"meta":{"appName":"Kindred Test"},"smtp":{"password":"hunter2-smtp"}}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"appName":"Kindred Test"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypePBAdmin)
				expect(t, row, map[string]string{"action": "settings_change", "fields": "meta.appName"})
				if strings.Contains(audittest.Dump(t, row), "hunter2-smtp") {
					t.Fatal("the SMTP password reached the audit row")
				}
				if after := audittest.JSON(t, row, "after"); after["meta.appName"] != "Kindred Test" {
					t.Errorf("after = %v", after)
				}
			},
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers = factory, headers
		s.Test(t)
	}
}
