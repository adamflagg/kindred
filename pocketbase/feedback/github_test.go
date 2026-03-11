package feedback

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildIssueTitle(t *testing.T) {
	tests := []struct {
		name        string
		description string
		want        string
	}{
		{
			name:        "short description stays as-is",
			description: "The save button is broken",
			want:        "The save button is broken",
		},
		{
			name:        "long description truncated at word boundary",
			description: "When I click on the assignments page and try to drag a camper to a different cabin the page freezes",
			want:        "When I click on the assignments page and try to drag a camper to a different",
		},
		{
			name:        "exactly 80 chars not truncated",
			description: "This is exactly eighty characters and should not be truncated at all right now!",
			want:        "This is exactly eighty characters and should not be truncated at all right now!",
		},
		{
			name:        "single long word truncated at 80",
			description: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_extra",
			want:        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildIssueTitle(tt.description)
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
		UserEmail:   "jane@camp.org",
		PageURL:     "/summer/sessions",
		Browser:     "Mozilla/5.0",
		Viewport:    "1920x1080",
		AppVersion:  "v0.8.0",
		Timestamp:   "2026-03-11T10:30:00Z",
	}

	body := buildIssueBody(&params)

	// Check key content is present
	if !containsAll(body,
		"The save button does not work",
		"bug",
		"Jane Smith",
		"jane@camp.org",
		"/summer/sessions",
		"v0.8.0",
	) {
		t.Errorf("issue body missing expected content:\n%s", body)
	}
}

func TestBuildIssueBodyWithScreenshot(t *testing.T) {
	params := IssueParams{
		Description:   "Button is broken",
		Category:      "bug",
		UserName:      "Jane Smith",
		UserEmail:     "jane@camp.org",
		PageURL:       "/summer/sessions",
		Browser:       "Mozilla/5.0",
		Viewport:      "1920x1080",
		AppVersion:    "v0.8.0",
		Timestamp:     "2026-03-11T10:30:00Z",
		ScreenshotURL: "https://raw.githubusercontent.com/org/repo/main/attachments/screenshot.png",
	}

	body := buildIssueBody(&params)

	if !containsAll(body, "![Screenshot]", "screenshot.png") {
		t.Errorf("issue body missing screenshot markdown:\n%s", body)
	}
}

func TestCreateIssue(t *testing.T) {
	var receivedBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		UserEmail:   "jane@camp.org",
		PageURL:     "/sessions",
		Browser:     "Mozilla/5.0",
		Viewport:    "1920x1080",
		AppVersion:  "v0.8.0",
		Timestamp:   "2026-03-11T10:30:00Z",
	})
	if err != nil {
		t.Fatalf("CreateIssue() error = %v", err)
	}

	// Verify the request body
	title, _ := receivedBody["title"].(string)
	if title != "Test issue" {
		t.Errorf("title = %q, want %q", title, "Test issue")
	}

	labels, _ := receivedBody["labels"].([]interface{})
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
		UserEmail:   "jane@camp.org",
	})
	if err == nil {
		t.Fatal("expected error for non-201 response")
	}
}

func TestUploadScreenshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT, got %s", r.Method)
		}

		var body map[string]interface{}
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
		resp := `{"content": {"download_url": ` +
			`"https://raw.githubusercontent.com/org/repo/main/attachments/test.png"}}`
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
	if url != "https://raw.githubusercontent.com/org/repo/main/attachments/test.png" {
		t.Errorf("url = %q, want raw URL", url)
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

// containsAll checks that s contains all substrings.
func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
