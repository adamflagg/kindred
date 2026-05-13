package feedback

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildIssueTitle(t *testing.T) {
	tests := []struct {
		name        string
		category    string
		description string
		want        string
	}{
		{
			name:        "bug with short description",
			category:    "bug",
			description: "The save button is broken",
			want:        "[Bug] The save button is broken",
		},
		{
			name:        "feature-request uses display name",
			category:    "feature-request",
			description: "Add dark mode",
			want:        "[Feature Request] Add dark mode",
		},
		{
			name:        "text-change uses display name",
			category:    "text-change",
			description: "Typo on login page",
			want:        "[Text Change] Typo on login page",
		},
		{
			name:        "question uses display name",
			category:    "question",
			description: "How do I export data",
			want:        "[Question] How do I export data",
		},
		{
			name:        "long description truncated at word boundary",
			category:    "bug",
			description: "When I click on the assignments page and try to drag a camper to a different cabin the page freezes",
			want:        "[Bug] When I click on the assignments page and try to drag a camper to a",
		},
		{
			name:        "single long word hard truncated",
			category:    "bug",
			description: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_extra",
			want:        "[Bug] aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildIssueTitle(tt.category, tt.description)
			if got != tt.want {
				t.Errorf("buildIssueTitle() = %q, want %q", got, tt.want)
			}
			if len(got) > 80 {
				t.Errorf("title length %d exceeds 80", len(got))
			}
		})
	}
}

func TestBuildIssueBody(t *testing.T) {
	params := IssueParams{
		Description: "The save button does not work",
		Category:    "bug",
		UserName:    "Jane Smith",
		UserEmail:   "jane@example.com",
		PageURL:     "/summer/sessions",
		Browser:     "Mozilla/5.0",
		Viewport:    "1920x1080",
		AppVersion:  "v0.8.0",
		Timestamp:   "2026-03-11T10:30:00Z",
	}

	body := buildIssueBody(&params)

	// Section headers should have colons
	if !containsAll(body,
		"**Description:**",
		"The save button does not work",
		"**Reported by:**",
		"Jane Smith (jane@example.com)",
		"**Page:**",
		"`/summer/sessions`",
		"**Environment:**",
	) {
		t.Errorf("issue body missing expected section headers with colons:\n%s", body)
	}

	// Environment details should be a bulleted list
	if !containsAll(body,
		"- Browser: Mozilla/5.0",
		"- Viewport: 1920x1080",
		"- App Version: v0.8.0",
	) {
		t.Errorf("issue body missing bulleted environment details:\n%s", body)
	}

	// Should NOT contain a table separator or submitted date
	if strings.Contains(body, "---") {
		t.Errorf("body should not contain separator:\n%s", body)
	}
	if strings.Contains(body, "Submitted") {
		t.Errorf("body should not contain submitted date:\n%s", body)
	}
}

func TestBuildIssueBodyWithScreenshot(t *testing.T) {
	params := IssueParams{
		Description:   "Button is broken",
		Category:      "bug",
		UserName:      "Jane Smith",
		UserEmail:     "jane@example.com",
		PageURL:       "/summer/sessions",
		Browser:       "Mozilla/5.0",
		Viewport:      "1920x1080",
		AppVersion:    "v0.8.0",
		Timestamp:     "2026-03-11T10:30:00Z",
		ScreenshotURL: "https://raw.githubusercontent.com/org/repo/main/attachments/screenshot.png",
	}

	body := buildIssueBody(&params)

	if !containsAll(body, "**Screenshot:**", "![Screenshot]", "screenshot.png") {
		t.Errorf("issue body missing screenshot section:\n%s", body)
	}
}

func TestCreateIssue(t *testing.T) {
	var receivedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Path; got != "/repos/org/feedback/issues" {
			t.Errorf("expected issues endpoint, got %s", got)
		}
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing or wrong auth header")
		}
		if r.Header.Get("Accept") != "application/vnd.github+json" {
			t.Errorf("missing Accept header")
		}

		bodyBytes, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(bodyBytes, &receivedBody)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"number": 42}`))
	}))
	defer server.Close()

	client := &GitHubClient{
		Token:   "test-token",
		Repo:    "org/feedback",
		BaseURL: server.URL,
	}

	err := client.CreateIssue(&IssueParams{
		Description: "Test issue",
		Category:    "bug",
		UserName:    "Jane Smith",
		UserEmail:   "jane@example.com",
		PageURL:     "/sessions",
		Browser:     "Mozilla/5.0",
		Viewport:    "1920x1080",
		AppVersion:  "v0.8.0",
		Timestamp:   "2026-03-11T10:30:00Z",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	// Verify the request body — title should have category prefix
	title, _ := receivedBody["title"].(string)
	if title != "[Bug] Test issue" {
		t.Errorf("title = %q, want %q", title, "[Bug] Test issue")
	}

	labels, _ := receivedBody["labels"].([]any)
	if len(labels) != 1 || labels[0] != "bug" {
		t.Errorf("labels = %v, want [bug]", labels)
	}
}

func TestCreateIssueAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message": "Validation Failed"}`))
	}))
	defer server.Close()

	client := &GitHubClient{
		Token:   "test-token",
		Repo:    "org/feedback",
		BaseURL: server.URL,
	}

	err := client.CreateIssue(&IssueParams{
		Description: "Test",
		Category:    "bug",
		UserName:    "Jane",
		UserEmail:   "jane@example.com",
	})
	if err == nil {
		t.Fatal("expected error for non-201 response")
	}
}

func TestUploadScreenshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want := "/repos/org/feedback/contents/attachments/2026-03-11T10-30-00Z-screenshot.png"
		if got := r.URL.Path; got != want {
			t.Errorf("URL path = %q, want %q", got, want)
		}
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT, got %s", r.Method)
		}

		var body map[string]any
		bodyBytes, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(bodyBytes, &body)

		if _, ok := body["content"]; !ok {
			t.Error("missing content field (base64 encoded)")
		}
		if _, ok := body["message"]; !ok {
			t.Error("missing commit message")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		// Real GitHub response for a PRIVATE repo: download_url carries an
		// ephemeral ?token=... that expires in ~30 min. html_url is the
		// stable blob URL — the code must derive the embeddable raw URL
		// from html_url, never from download_url.
		ephemeralDL := "https://raw.githubusercontent.com/org/feedback/main/" +
			"attachments/2026-03-11T10-30-00Z-screenshot.png?token=EPHEMERAL_TOKEN_XYZ"
		stableHTML := "https://github.com/org/feedback/blob/main/" +
			"attachments/2026-03-11T10-30-00Z-screenshot.png"
		resp := fmt.Sprintf(
			`{"content": {"download_url": %q, "html_url": %q}}`,
			ephemeralDL, stableHTML,
		)
		_, _ = w.Write([]byte(resp))
	}))
	defer server.Close()

	client := &GitHubClient{
		Token:   "test-token",
		Repo:    "org/feedback",
		BaseURL: server.URL,
	}

	url, err := client.UploadScreenshot([]byte("fake-image-data"), "screenshot.png", "2026-03-11T10:30:00Z")
	if err != nil {
		t.Fatalf("UploadScreenshot() error = %v", err)
	}

	wantURL := "https://github.com/org/feedback/raw/main/attachments/2026-03-11T10-30-00Z-screenshot.png"
	if url != wantURL {
		t.Errorf("url = %q, want %q (stable github.com/raw URL, not ephemeral download_url)", url, wantURL)
	}
	if strings.Contains(url, "?token=") {
		t.Errorf("url must not contain ephemeral ?token= query: %q", url)
	}
	if strings.Contains(url, "/blob/") {
		t.Errorf("url must use /raw/ not /blob/: %q", url)
	}
}

func TestValidateCategory(t *testing.T) {
	valid := []string{"bug", "text-change", "feature-request", "question"}
	for _, c := range valid {
		if err := validateCategory(c); err != nil {
			t.Errorf("validateCategory(%q) unexpected error: %v", c, err)
		}
	}

	invalid := []string{"", "invalid", "Bug", "TEXT-CHANGE", "feature_request"}
	for _, c := range invalid {
		if err := validateCategory(c); err == nil {
			t.Errorf("validateCategory(%q) expected error", c)
		}
	}
}

func TestUploadScreenshotWithSanitizedFilename(t *testing.T) {
	var receivedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		resp := `{"content": {"html_url": "https://github.com/org/feedback/` +
			`blob/main/attachments/2026-03-11T10-30-00Z-evil.png"}}`
		_, _ = w.Write([]byte(resp))
	}))
	defer server.Close()

	client := &GitHubClient{
		Token:   "test-token",
		Repo:    "org/feedback",
		BaseURL: server.URL,
	}

	// Simulate handler flow: sanitize before passing to UploadScreenshot
	rawFilename := "../../evil.png"
	safeFilename := sanitizeFilename(rawFilename)

	_, err := client.UploadScreenshot([]byte("fake-data"), safeFilename, "2026-03-11T10:30:00Z")
	if err != nil {
		t.Fatalf("UploadScreenshot() error = %v", err)
	}

	// Path should NOT contain directory traversal
	if strings.Contains(receivedPath, "..") {
		t.Errorf("URL path contains directory traversal: %s", receivedPath)
	}
	// Should use sanitized filename
	if !strings.HasSuffix(receivedPath, "evil.png") {
		t.Errorf("URL path should end with sanitized filename, got %s", receivedPath)
	}
}

// containsAll checks that s contains all substrings.
func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
