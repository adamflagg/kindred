package aidguard

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

const (
	rulesID = "rules0000000001"
	logID   = "aidlog000000001"
)

// newGuardApp builds an app from an EMPTY data dir with a minimal aid_rules
// (the guarded fields only) and aid_change_log, batch on, one superuser, and
// the real RegisterHooks. It seeds one aid_rules record, which the create hook
// starts at revision 0. headers receives the superuser's token.
func newGuardApp(t testing.TB, headers map[string]string) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	RegisterHooks(app)

	rules := core.NewBaseCollection("aid_rules")
	rules.Fields.Add(&core.NumberField{Name: "version", OnlyInt: true})
	rules.Fields.Add(&core.JSONField{Name: "section_status", MaxSize: 100000})
	rules.Fields.Add(&core.NumberField{Name: FieldRevision, OnlyInt: true})
	mustSave(t, app, rules) // all five rules nil: superuser only, as in production

	changeLog := core.NewBaseCollection("aid_change_log")
	changeLog.Fields.Add(&core.TextField{Name: "entity", Required: true})
	mustSave(t, app, changeLog)

	app.Settings().Batch.Enabled = true
	app.Settings().Batch.MaxRequests = 50
	app.Settings().Batch.Timeout = 10
	mustSave(t, app, app.Settings())

	record := core.NewRecord(rules)
	record.Id = rulesID
	record.Set("version", 1)
	record.Set("section_status", map[string]string{"income": "approved"})
	record.Set(FieldRevision, 41) // the create hook starts every record at 0
	mustSave(t, app, record)

	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	su := core.NewRecord(superusers)
	su.SetEmail("ci-guard@example.com")
	su.SetPassword("correct-horse-battery-staple")
	mustSave(t, app, su)
	token, err := su.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}
	headers["Authorization"] = token
	return app
}

func mustSave(t testing.TB, app core.App, m core.Model) {
	t.Helper()
	if err := app.Save(m); err != nil {
		t.Fatalf("save %T: %v", m, err)
	}
}

// lock is the sub-request a Posted tick sends to lock income, guarded by ifMatch ("" = no header).
func lock(ifMatch string) string {
	headers := ""
	if ifMatch != "" {
		headers = `,"headers":{"If-Match":` + ifMatch + `}`
	}
	return `{"method":"PATCH","url":"/api/collections/aid_rules/records/` + rulesID + `",` +
		`"body":{"section_status":{"income":"locked"}}` + headers + `}`
}

func logRow() string {
	return `{"method":"POST","url":"/api/collections/aid_change_log/records",` +
		`"body":{"id":"` + logID + `","entity":"aid_rules"}}`
}

func batch(items ...string) *strings.Reader {
	return strings.NewReader(`{"requests":[` + strings.Join(items, ",") + `]}`)
}

func stored(t testing.TB, app core.App) (revision int, sectionStatus string) {
	t.Helper()
	record, err := app.FindRecordById("aid_rules", rulesID)
	if err != nil {
		t.Fatalf("find aid_rules: %v", err)
	}
	return record.GetInt(FieldRevision), record.GetString("section_status")
}

func logged(app core.App) bool {
	_, err := app.FindRecordById("aid_change_log", logID)
	return err == nil
}

func TestTheGuardKeepsAidWritesFromOverwritingEachOther(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp { return newGuardApp(t, headers) }
	direct := map[string]string{"If-Match": `"0"`} // a plain PATCH, outside /api/batch

	scenarios := []tests.ApiScenario{
		{
			Name:   "a write that read the stored revision commits and moves it on",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           batch(lock(`"\"0\""`), logRow()),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"revision":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, status := stored(t, app); revision != 1 || !strings.Contains(status, "locked") {
					t.Fatalf("stored revision %d, section_status %s", revision, status)
				}
				if !logged(app) {
					t.Fatal("the log row beside the write did not commit")
				}
			},
		},
		{
			Name:   "a stale write fails with 412 and rolls back the whole batch",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           batch(logRow(), lock(`"\"7\""`)),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"requests":{"1":`, `"status":412`, `changed since it was read`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, status := stored(t, app); revision != 0 || strings.Contains(status, "locked") {
					t.Fatalf("a refused write changed the record: revision %d, %s", revision, status)
				}
				if logged(app) {
					t.Fatal("the log row committed beside a refused write: the batch is not one transaction")
				}
			},
		},
		{
			Name:   "the k-th save of one record in a batch expects the read revision plus k",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           batch(lock(`"\"0\""`), lock(`"\"1\""`), lock(`"\"2\""`)),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"revision":3`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, _ := stored(t, app); revision != 3 {
					t.Fatalf("revision %d after three saves, want 3", revision)
				}
			},
		},
		{
			Name:   "an empty update with If-Match is a guard: it checks and moves the revision on",
			Method: http.MethodPost, URL: "/api/batch",
			Body: batch(`{"method":"PATCH","url":"/api/collections/aid_rules/records/` + rulesID +
				`","body":{},"headers":{"If-Match":"\"0\""}}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"revision":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, status := stored(t, app); revision != 1 || strings.Contains(status, "locked") {
					t.Fatalf("a guard left revision %d, %s", revision, status)
				}
			},
		},
		{
			Name:   "a write without If-Match still moves the revision on",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           batch(lock("")),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"revision":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, _ := stored(t, app); revision != 1 {
					t.Fatalf("revision %d, want 1", revision)
				}
			},
		},
		{
			Name:   "a body that names a revision cannot set it",
			Method: http.MethodPost, URL: "/api/batch",
			Body: batch(`{"method":"PATCH","url":"/api/collections/aid_rules/records/` + rulesID +
				`","body":{"revision":40},"headers":{"If-Match":"\"0\""}}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  200,
			ExpectedContent: []string{`"revision":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if revision, _ := stored(t, app); revision != 1 {
					t.Fatalf("revision %d, want 1", revision)
				}
			},
		},
		{
			Name:   "a stale delete fails with 412 and leaves the record",
			Method: http.MethodPost, URL: "/api/batch",
			Body: batch(`{"method":"DELETE","url":"/api/collections/aid_rules/records/` + rulesID +
				`","headers":{"If-Match":"\"3\""}}`),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  400,
			ExpectedContent: []string{`"status":412`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				stored(t, app) // fails the test if the record is gone
			},
		},
		{
			Name:   "If-Match outside a batch is refused, not honored without a transaction",
			Method: http.MethodPatch, URL: "/api/collections/aid_rules/records/" + rulesID,
			Body:            strings.NewReader(`{"section_status":{"income":"locked"}}`),
			TestAppFactory:  func(t testing.TB) *tests.TestApp { return newGuardApp(t, direct) },
			Headers:         direct,
			ExpectedStatus:  400,
			ExpectedContent: []string{`only inside /api/batch`},
		},
		{
			Name:   "a malformed If-Match is refused",
			Method: http.MethodPost, URL: "/api/batch",
			Body:           batch(lock(`"0"`)),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus:  400,
			ExpectedContent: []string{`quoted revision`},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

func TestAGoSaveMovesTheRevisionOnToo(t *testing.T) {
	app := newGuardApp(t, map[string]string{})
	defer app.Cleanup()
	record, err := app.FindRecordById("aid_rules", rulesID)
	if err != nil {
		t.Fatal(err)
	}
	record.Set("section_status", map[string]string{"income": "draft"})
	mustSave(t, app, record)
	if revision, _ := stored(t, app); revision != 1 {
		t.Fatalf("revision %d after one Go save, want 1", revision)
	}
}

// Ruling 2026-10-01 (plan review): two writers that both read revision 0 race
// for real, on two goroutines. PocketBase runs each batch as one transaction on
// its single write connection, so exactly one commits and the other is refused.
func TestTwoConcurrentWritersFromOneReadOnlyOneCommits(t *testing.T) {
	headers := map[string]string{}
	app := newGuardApp(t, headers)
	defer app.Cleanup()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatalf("mux: %v", err)
	}

	statuses := make([]int, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range statuses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/batch", batch(lock(`"\"0\""`)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", headers["Authorization"])
			rec := httptest.NewRecorder()
			<-start
			mux.ServeHTTP(rec, req)
			statuses[i] = rec.Code
		}()
	}
	close(start)
	wg.Wait()

	slices.Sort(statuses)
	if !slices.Equal(statuses, []int{http.StatusOK, http.StatusBadRequest}) {
		t.Fatalf("statuses %v, want one 200 and one 400 (its sub-request refused with 412)", statuses)
	}
	if revision, _ := stored(t, app); revision != 1 {
		t.Fatalf("revision %d after one committed write, want 1", revision)
	}
}
