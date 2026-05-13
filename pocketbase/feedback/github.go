// Package feedback implements user feedback intake via GitHub Issues API.
package feedback

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// GitHubClient handles communication with the GitHub API.
type GitHubClient struct {
	Token   string
	Repo    string // "owner/repo" format
	BaseURL string // Override for testing; empty = "https://api.github.com"
}

// IssueParams holds the data needed to create a GitHub issue.
type IssueParams struct {
	Description   string
	Category      string
	UserName      string
	UserEmail     string
	PageURL       string
	Browser       string
	Viewport      string
	AppVersion    string
	Timestamp     string
	ScreenshotURL string // Set after uploading screenshot
}

var validCategories = map[string]bool{
	"bug":             true,
	"text-change":     true,
	"feature-request": true,
	"question":        true,
}

func validateCategory(category string) error {
	if !validCategories[category] {
		return fmt.Errorf(
			"invalid category %q: must be one of bug, text-change, feature-request, question",
			category,
		)
	}
	return nil
}

func (c *GitHubClient) apiURL(path string) string {
	base := c.BaseURL
	if base == "" {
		base = "https://api.github.com"
	}
	return base + path
}

// httpClient is used for all GitHub API requests with an explicit timeout.
var httpClient = &http.Client{Timeout: 30 * time.Second}

func (c *GitHubClient) doRequest(method, url string, body any) (*http.Response, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshaling request body: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	return resp, nil
}

// CreateIssue creates a GitHub issue in the configured repo.
func (c *GitHubClient) CreateIssue(params *IssueParams) error {
	url := c.apiURL(fmt.Sprintf("/repos/%s/issues", c.Repo))

	body := map[string]any{
		"title":  buildIssueTitle(params.Category, params.Description),
		"body":   buildIssueBody(params),
		"labels": []string{params.Category},
	}

	resp, err := c.doRequest(http.MethodPost, url, body)
	if err != nil {
		return fmt.Errorf("creating issue: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		slog.Error("GitHub API error creating issue",
			"status", resp.StatusCode,
			"response", string(respBody),
		)
		return fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	return nil
}

// UploadScreenshot uploads an image to the repo's attachments/ directory.
// Returns a stable URL for embedding in the issue body.
//
// For private repos, GitHub's contents API returns a download_url with an
// ephemeral ?token= query that expires within ~30 min — embedding that URL
// silently breaks every screenshot once the token dies. We instead derive a
// stable URL from html_url: https://github.com/{owner}/{repo}/raw/{branch}/{path}.
// When a logged-in collaborator's browser hits this URL, GitHub redirects to a
// freshly-minted raw.githubusercontent.com URL bound to their session, so the
// embedded image renders indefinitely.
func (c *GitHubClient) UploadScreenshot(data []byte, filename, timestamp string) (string, error) {
	// Sanitize timestamp for filename: replace colons
	safeTimestamp := strings.ReplaceAll(timestamp, ":", "-")
	path := fmt.Sprintf("attachments/%s-%s", safeTimestamp, filename)
	url := c.apiURL(fmt.Sprintf("/repos/%s/contents/%s", c.Repo, path))

	body := map[string]string{
		"message": fmt.Sprintf("Upload screenshot: %s", filename),
		"content": base64.StdEncoding.EncodeToString(data),
	}

	resp, err := c.doRequest(http.MethodPut, url, body)
	if err != nil {
		return "", fmt.Errorf("uploading screenshot: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		slog.Error("GitHub API error uploading screenshot",
			"status", resp.StatusCode,
			"response", string(respBody),
		)
		return "", fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var result struct {
		Content struct {
			HTMLURL string `json:"html_url"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if result.Content.HTMLURL == "" {
		return "", fmt.Errorf("GitHub response missing html_url")
	}

	// html_url is .../blob/{branch}/{path}; raw form is .../raw/{branch}/{path}.
	return strings.Replace(result.Content.HTMLURL, "/blob/", "/raw/", 1), nil
}

// categoryDisplayNames maps slug values to human-readable labels.
var categoryDisplayNames = map[string]string{
	"bug":             "Bug",
	"text-change":     "Text Change",
	"feature-request": "Feature Request",
	"question":        "Question",
}

func buildIssueTitle(category, description string) string {
	prefix := "[" + categoryDisplayNames[category] + "] "
	maxDesc := 80 - len(prefix)

	if len(description) <= maxDesc {
		return prefix + description
	}

	// Truncate at word boundary
	truncated := description[:maxDesc]
	lastSpace := strings.LastIndex(truncated, " ")
	if lastSpace > 0 {
		return prefix + truncated[:lastSpace]
	}
	return prefix + truncated
}

func buildIssueBody(params *IssueParams) string {
	var b strings.Builder

	b.WriteString("**Description:**\n")
	b.WriteString(params.Description)

	fmt.Fprintf(&b, "\n\n**Reported by:**\n%s (%s)", params.UserName, params.UserEmail)
	fmt.Fprintf(&b, "\n\n**Page:**\n`%s`", params.PageURL)
	fmt.Fprintf(&b, "\n\n**Environment:**\n")
	fmt.Fprintf(&b, "- Browser: %s\n", params.Browser)
	fmt.Fprintf(&b, "- Viewport: %s\n", params.Viewport)
	fmt.Fprintf(&b, "- App Version: %s", params.AppVersion)

	if params.ScreenshotURL != "" {
		fmt.Fprintf(&b, "\n\n**Screenshot:**\n![Screenshot](%s)", params.ScreenshotURL)
	}

	b.WriteString("\n")
	return b.String()
}
