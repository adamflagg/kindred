package feedback

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/version"
	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "simple filename unchanged",
			input: "screenshot.png",
			want:  "screenshot.png",
		},
		{
			name:  "strips parent directory traversal",
			input: "../../evil.png",
			want:  "evil.png",
		},
		{
			name:  "strips deep traversal",
			input: "../../../.github/workflows/pwn.yml",
			want:  "pwn.yml",
		},
		{
			name:  "strips leading path components",
			input: "path/to/file.png",
			want:  "file.png",
		},
		{
			name:  "handles filename with spaces",
			input: "Screen Shot 2026-03-11.png",
			want:  "Screen Shot 2026-03-11.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeFilename(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeFilename(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidateDescriptionRejectsWhitespace(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		wantVal string
	}{
		{"empty string rejected", "", true, ""},
		{"whitespace-only rejected", "   ", true, ""},
		{"tabs-only rejected", "\t\t", true, ""},
		{"newlines-only rejected", "\n\n", true, ""},
		{"valid description passes", "The button is broken", false, "The button is broken"},
		{"trims surrounding whitespace", "  hello  ", false, "hello"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validateDescription(tt.input)
			if tt.wantErr && err == nil {
				t.Errorf("validateDescription(%q) expected error", tt.input)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateDescription(%q) unexpected error: %v", tt.input, err)
			}
			if !tt.wantErr && got != tt.wantVal {
				t.Errorf("validateDescription(%q) = %q, want %q", tt.input, got, tt.wantVal)
			}
		})
	}
}

func TestValidateScreenshotContent(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		wantErr bool
	}{
		{
			name:    "valid PNG accepted",
			data:    []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			wantErr: false,
		},
		{
			name:    "valid JPEG accepted",
			data:    []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01},
			wantErr: false,
		},
		{
			name:    "valid GIF accepted",
			data:    []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00},
			wantErr: false,
		},
		{
			name: "valid WebP accepted",
			// http.DetectContentType needs at least the RIFF....WEBPVP8 header
			data:    []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x00\x00"),
			wantErr: false,
		},
		{
			name:    "text file rejected",
			data:    []byte("This is not an image file"),
			wantErr: true,
		},
		{
			name:    "HTML file rejected",
			data:    []byte("<html><body>hello</body></html>"),
			wantErr: true,
		},
		{
			name:    "JSON file rejected",
			data:    []byte(`{"key": "value"}`),
			wantErr: true,
		},
		{
			name:    "empty data rejected",
			data:    []byte{},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateScreenshotContent(tt.data)
			if tt.wantErr && err == nil {
				t.Errorf("validateScreenshotContent(%q) expected error", tt.name)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateScreenshotContent(%q) unexpected error: %v", tt.name, err)
			}
		})
	}
}

// feedbackForm builds the multipart body FeedbackModal posts. extra carries
// the optional fields, so an old client is simply one that omits them.
func feedbackForm(t testing.TB, extra map[string]string) (body *bytes.Buffer, contentType string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fields := map[string]string{
		"category":    "bug",
		"description": "The save button does not work",
		"page_url":    "/summer/sessions",
		"browser":     "Mozilla/5.0",
		"viewport":    "1920x1080",
	}
	maps.Copy(fields, extra)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}
	return &buf, w.FormDataContentType()
}

// TestHandleFeedbackVersions drives the real route: the issue it files names
// the frontend and api versions the client knew, and PocketBase's own version
// from the server itself. A client-sent pocketbase_version is ignored (a tab
// left open across a deploy would report a stale one), and an old client that
// sends only app_version still files an issue.
func TestHandleFeedbackVersions(t *testing.T) {
	cases := []struct {
		name    string
		extra   map[string]string
		wantVer string
		absent  []string
	}{
		{
			name: "current client: pocketbase comes from the server, not the form",
			extra: map[string]string{
				"app_version":        "v6.4.0-240-gaaaaaaa",
				"api_version":        "v6.4.0-248-gc35904c",
				"pocketbase_version": "v6.4.0-245-gbbbbbbb",
			},
			wantVer: "- App Version: frontend v6.4.0-240-gaaaaaaa · api v6.4.0-248-gc35904c · pocketbase v6.4.0-250-gserverpb",
			absent:  []string{"gbbbbbbb"},
		},
		{
			name:    "old client sends only app_version",
			extra:   map[string]string{"app_version": "v6.4.0-240-gaaaaaaa"},
			wantVer: "- App Version: frontend v6.4.0-240-gaaaaaaa · pocketbase v6.4.0-250-gserverpb\n",
			absent:  []string{"api "},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var issueBody string
			t.Setenv(version.EnvVar, "v6.4.0-250-gserverpb")
			gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]any
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &payload)
				issueBody, _ = payload["body"].(string)
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"number": 7}`))
			}))
			defer gh.Close()
			t.Setenv("GITHUB_FEEDBACK_TOKEN", "test-token")
			t.Setenv("GITHUB_FEEDBACK_REPO", "org/feedback")
			prev := githubBaseURL
			githubBaseURL = gh.URL
			defer func() { githubBaseURL = prev }()

			body, contentType := feedbackForm(t, tc.extra)
			headers := map[string]string{"Content-Type": contentType}
			(&pbtests.ApiScenario{
				Name: tc.name, Method: http.MethodPost, URL: "/api/custom/feedback", Body: body, Headers: headers,
				TestAppFactory: func(t testing.TB) *pbtests.TestApp {
					app, err := pbtests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
					if err != nil {
						t.Fatalf("new test app: %v", err)
					}
					return app
				},
				BeforeTestFunc: func(t testing.TB, app *pbtests.TestApp, e *core.ServeEvent) {
					RegisterRoutes(e)
					users, err := app.FindCollectionByNameOrId("users")
					if err != nil {
						t.Fatalf("find users: %v", err)
					}
					u := core.NewRecord(users)
					u.SetEmail("emma.johnson@example.com")
					u.SetPassword("correct-horse-battery-staple")
					if err = app.Save(u); err != nil {
						t.Fatalf("save user: %v", err)
					}
					token, err := u.NewAuthToken()
					if err != nil {
						t.Fatalf("auth token: %v", err)
					}
					headers["Authorization"] = token
				},
				ExpectedStatus:  http.StatusOK,
				ExpectedContent: []string{`"success":true`},
			}).Test(t)

			if !strings.Contains(issueBody, tc.wantVer) {
				t.Errorf("issue body missing %q:\n%s", tc.wantVer, issueBody)
			}
			_, envLine, found := strings.Cut(issueBody, "- App Version:")
			if !found {
				t.Fatalf("issue body has no App Version line:\n%s", issueBody)
			}
			for _, a := range tc.absent {
				if strings.Contains(envLine, a) {
					t.Errorf("App Version line should not mention %q:\n%s", a, envLine)
				}
			}
		})
	}
}
