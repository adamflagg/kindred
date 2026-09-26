package rbac

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The batch limits migration 1500000195 sets (campership sub-project 4a,
// kindred#2865). Spelled out rather than shared: bunking/pocketbase_batch.py
// pins MAX_BATCH_REQUESTS and BATCH_TIMEOUT_SECONDS against the same file, so
// a change must move all three together.
const (
	wantBatchMaxRequests = 2000
	wantBatchTimeout     = 30
	wantBatchMaxBodySize = 32 << 20
)

// newBootedTestApp clones the database CI's Migration smoke test built by
// applying the REAL pb_migrations (KINDRED_PROD_SCHEMA_DB) into a test app, so
// settings and schema are exactly what the migrations produced. Skips
// everywhere else, like loadBootedRoles.
func newBootedTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	dbPath := os.Getenv("KINDRED_PROD_SCHEMA_DB")
	if dbPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_DB not set -- runs in CI's Migrations & Schema Agreement job")
	}
	if !filepath.IsAbs(dbPath) {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%q must be absolute: this binary runs in pocketbase/rbac", dbPath)
	}
	// Clone only data.db (and its WAL, should the boot have left one): the
	// rest of the booted data dir is irrelevant here, and NewTestApp copies
	// whatever directory it is given.
	dir := t.TempDir()
	for _, suffix := range []string{"", "-wal"} {
		src, err := os.ReadFile(dbPath + suffix)
		if err != nil {
			if suffix != "" && os.IsNotExist(err) {
				continue
			}
			t.Fatalf("read %s: %v", dbPath+suffix, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "data.db"+suffix), src, 0o600); err != nil {
			t.Fatalf("copy booted database: %v", err)
		}
	}
	app, err := tests.NewTestApp(dir)
	if err != nil {
		t.Fatalf("boot test app from %s: %v", dbPath, err)
	}
	return app
}

// TestBootedBatchSettings: batch is OFF in a fresh PocketBase, and the
// financial-aid write helper cannot commit a write with its aid_change_log row
// unless migration 1500000195 turned it on with these limits.
func TestBootedBatchSettings(t *testing.T) {
	app := newBootedTestApp(t)
	defer app.Cleanup()

	got := app.Settings().Batch
	if !got.Enabled {
		t.Fatal("settings.batch.enabled is false -- /api/batch answers 403 and every aid write fails")
	}
	if got.MaxRequests != wantBatchMaxRequests {
		t.Errorf("settings.batch.maxRequests = %d, want %d", got.MaxRequests, wantBatchMaxRequests)
	}
	if got.Timeout != wantBatchTimeout {
		t.Errorf("settings.batch.timeout = %d, want %d", got.Timeout, wantBatchTimeout)
	}
	if got.MaxBodySize != wantBatchMaxBodySize {
		t.Errorf("settings.batch.maxBodySize = %d, want %d", got.MaxBodySize, wantBatchMaxBodySize)
	}
}

// changeLogBatchItem is one aid_change_log create as a batch sub-request.
func changeLogBatchItem(id, entity string) string {
	return fmt.Sprintf(`{"method":"POST","url":"/api/collections/aid_change_log/records","body":{`+
		`"id":%q,"entity":%q,"entity_id":"1000001","year":2027,"action":"create","after":{"stage":"offered"},`+
		`"actor":"finance-lead@example.com","operation_id":"opbatchtest0001"}}`, id, entity)
}

func countChangeLogRows(t testing.TB, app core.App, ids ...string) int {
	t.Helper()
	n := 0
	for _, id := range ids {
		if _, err := app.FindRecordById("aid_change_log", id); err == nil {
			n++
		}
	}
	return n
}

// TestBootedBatchIsOneTransaction drives the real /api/batch route against
// the booted schema: a valid write followed by an invalid one leaves NOTHING
// behind (the helper relies on this to keep a write and its log row together),
// a client-supplied id is kept (the helper generates ids so a create's log row
// can name it), and a batch over maxRequests is refused whole.
func TestBootedBatchIsOneTransaction(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		app := newBootedTestApp(t)
		superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
		if err != nil {
			t.Fatalf("find superusers: %v", err)
		}
		su := core.NewRecord(superusers)
		su.SetEmail("ci-batch@example.com")
		su.SetPassword("correct-horse-battery-staple")
		mustSave(t, app, su)
		authAs(t, headers, su)
		return app
	}
	const first, second = "aidlogbatch0001", "aidlogbatch0002"

	overLimit := make([]string, wantBatchMaxRequests+1)
	for i := range overLimit {
		overLimit[i] = changeLogBatchItem(fmt.Sprintf("aidlogover%05d", i), "aid_decisions")
	}

	scenarios := []tests.ApiScenario{
		{
			Name:   "two valid creates commit together and keep their supplied ids",
			Method: http.MethodPost, URL: "/api/batch",
			Body: strings.NewReader(`{"requests":[` + changeLogBatchItem(first, "aid_decisions") + "," +
				changeLogBatchItem(second, "aid_decisions") + `]}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"id":"` + first + `"`, `"id":"` + second + `"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := countChangeLogRows(t, app, first, second); n != 2 {
					t.Fatalf("committed %d of 2 rows", n)
				}
			},
		},
		{
			Name:   "an invalid second sub-request rolls back the first",
			Method: http.MethodPost, URL: "/api/batch",
			// A blank entity fails aid_change_log's required rule.
			Body: strings.NewReader(`{"requests":[` + changeLogBatchItem(first, "aid_decisions") + "," +
				changeLogBatchItem(second, "") + `]}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"requests":{"1":`, `"entity":{"code":"validation_required"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := countChangeLogRows(t, app, first, second); n != 0 {
					t.Fatalf("%d rows survived a failed batch -- it is not one transaction", n)
				}
			},
		},
		{
			Name:   "a batch over maxRequests is refused whole",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           strings.NewReader(`{"requests":[` + strings.Join(overLimit, ",") + `]}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"requests":`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := countChangeLogRows(t, app, "aidlogover00000"); n != 0 {
					t.Fatal("an over-limit batch wrote a row")
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}
