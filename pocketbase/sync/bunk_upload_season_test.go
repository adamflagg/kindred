package sync

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// Audit Fix B: the bunk-request CSV upload files, imports and processes the season it was
// uploaded under. Harness: api_viewed_season_test.go.

// ── Fix B: the bunk-request CSV upload ──────────────────────────────────────────────────────

func TestDetermineUploadYearRejectsAnInvalidYear(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	for _, param := range []string{"abc", "1999", "2024"} {
		if y, err := determineUploadYear(param); err == nil {
			t.Errorf("determineUploadYear(%q) = %d, want an error, not the primary", param, y)
		}
	}
	if y, err := determineUploadYear(""); err != nil || y != 2027 {
		t.Errorf(`determineUploadYear("") = %d, %v; want the primary 2027`, y, err)
	}
}

func TestDetermineUploadYearKeepsThePriorSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	for _, want := range []int{2026, 2027} {
		if y, err := determineUploadYear(strconv.Itoa(want)); err != nil || y != want {
			t.Errorf("determineUploadYear(%d) = %d, %v", want, y, err)
		}
	}
}

// TestBunkRequestsUploadForThePriorSeasonSyncsThatSeason: staff viewing 2026 upload 2026's
// requests. The file is stored as 2026's, and the chained bunk_requests and process_requests
// runs import and process 2026, not the primary.
func TestBunkRequestsUploadForThePriorSeasonSyncsThatSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)
	capture := &processorCapture{}
	capture.serve(t)

	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	o, rec := newRecordingOrchestrator(t, nil, client, "bunk_requests", "process_requests")
	scheduler := &Scheduler{app: app, orchestrator: o}

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "requests.csv")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("PersonID,Last Name,First Name\n1000001,Doe,Pat\n"))
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	re := &core.RequestEvent{}
	re.Request = httptest.NewRequest(http.MethodPost,
		"/?run_sync=true&run_process_requests=true&year=2026", &body)
	re.Request.Header.Set("Content-Type", form.FormDataContentType())
	resp := httptest.NewRecorder()
	re.Response = resp
	if err := handleBunkRequestsUpload(re, scheduler); err != nil {
		t.Fatal(err)
	}
	if resp.Code != http.StatusOK {
		t.Fatalf("upload got %d: %s", resp.Code, resp.Body.String())
	}

	waitForRuns(t, rec, 1)
	if !rec.Ran("bunk_requests", 2026) || rec.count("bunk_requests", 2027) != 0 {
		t.Errorf("the upload must import 2026's file, got %v", rec.Runs())
	}
	if got := capture.waitFor(t, 1); !slices.Equal(got, []int{2026}) {
		t.Errorf("process_requests asked FastAPI for %v, want [2026]", got)
	}
	if got := waitForFinished(t, o, "process_requests"); got.Year != 2026 {
		t.Errorf("the process_requests run must be filed under 2026, got %d", got.Year)
	}

	t.Run("a year outside the synced pair is refused", func(t *testing.T) {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("file", "requests.csv")
		_, _ = part.Write([]byte("PersonID,Last Name,First Name\n"))
		_ = form.Close()
		re := &core.RequestEvent{}
		re.Request = httptest.NewRequest(http.MethodPost, "/?year=abc", &body)
		re.Request.Header.Set("Content-Type", form.FormDataContentType())
		resp := httptest.NewRecorder()
		re.Response = resp
		if err := handleBunkRequestsUpload(re, scheduler); err != nil {
			t.Fatal(err)
		}
		if resp.Code != http.StatusBadRequest {
			t.Errorf("year=abc got %d, want 400", resp.Code)
		}
	})
}
