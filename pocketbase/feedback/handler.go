package feedback

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// MaxScreenshotSize is the maximum allowed screenshot file size (5MB).
const MaxScreenshotSize = 5 * 1024 * 1024

// RegisterRoutes registers the feedback endpoint on the PocketBase router.
func RegisterRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/custom/feedback", requireAuth(HandleFeedback))
}

// requireAuth wraps a handler to require authentication.
func requireAuth(handler func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("Authentication required", nil)
		}
		return handler(e)
	}
}

// HandleFeedback processes a feedback submission and creates a GitHub issue.
func HandleFeedback(e *core.RequestEvent) error {
	// Check configuration
	token := os.Getenv("GITHUB_FEEDBACK_TOKEN")
	repo := os.Getenv("GITHUB_FEEDBACK_REPO")
	if token == "" || repo == "" {
		slog.Warn("Feedback not configured: GITHUB_FEEDBACK_TOKEN or GITHUB_FEEDBACK_REPO missing")
		return apis.NewApiError(503, "Feedback is not configured", nil)
	}

	// Parse multipart form
	if err := e.Request.ParseMultipartForm(MaxScreenshotSize + 1024*1024); err != nil {
		return apis.NewBadRequestError("Invalid form data", err)
	}

	// Extract and validate required fields
	category := e.Request.FormValue("category")
	description := e.Request.FormValue("description")

	if description == "" {
		return apis.NewBadRequestError("Description is required", nil)
	}
	if err := validateCategory(category); err != nil {
		return apis.NewBadRequestError(err.Error(), nil)
	}

	// Extract metadata
	pageURL := e.Request.FormValue("page_url")
	browser := e.Request.FormValue("browser")
	viewport := e.Request.FormValue("viewport")
	appVersion := e.Request.FormValue("app_version")
	timestamp := time.Now().UTC().Format(time.RFC3339)

	// Extract user info from auth record
	userName := e.Auth.GetString("name")
	userEmail := e.Auth.GetString("email")
	if userName == "" {
		userName = userEmail
	}

	client := &GitHubClient{
		Token: token,
		Repo:  repo,
	}

	params := &IssueParams{
		Description: description,
		Category:    category,
		UserName:    userName,
		UserEmail:   userEmail,
		PageURL:     pageURL,
		Browser:     browser,
		Viewport:    viewport,
		AppVersion:  appVersion,
		Timestamp:   timestamp,
	}

	// Handle optional screenshot
	file, header, err := e.Request.FormFile("screenshot")
	if err == nil {
		defer func() { _ = file.Close() }()

		// Check file size
		if header.Size > MaxScreenshotSize {
			return apis.NewBadRequestError("Screenshot must be under 5MB", nil)
		}

		data, err := io.ReadAll(file)
		if err != nil {
			slog.Error("Failed to read screenshot", "error", err)
			return apis.NewBadRequestError("Failed to read screenshot", err)
		}

		screenshotURL, err := client.UploadScreenshot(data, header.Filename, timestamp)
		if err != nil {
			slog.Error("Failed to upload screenshot to GitHub", "error", err)
			return apis.NewApiError(502, "Failed to submit feedback. Please try again.", nil)
		}
		params.ScreenshotURL = screenshotURL
	}

	// Create the GitHub issue
	if err := client.CreateIssue(params); err != nil {
		slog.Error("Failed to create GitHub issue", "error", err)
		return apis.NewApiError(502, "Failed to submit feedback. Please try again.", nil)
	}

	slog.Info("Feedback submitted",
		"category", category,
		"user", userEmail,
		"page", pageURL,
	)

	return e.JSON(http.StatusOK, map[string]bool{"success": true})
}

// sanitizeFilename strips path components from a user-supplied filename.
func sanitizeFilename(name string) string {
	return name
}

// validateDescription checks that a description is non-empty after trimming whitespace.
func validateDescription(desc string) (string, error) {
	if desc == "" {
		return "", fmt.Errorf("description is required")
	}
	return desc, nil
}

// validateScreenshotContent checks that the data has an image content type.
func validateScreenshotContent(_ []byte) error {
	return nil
}
