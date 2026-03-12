package feedback

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// MaxScreenshotSize is the maximum allowed screenshot file size (5MB).
const MaxScreenshotSize = 5 * 1024 * 1024

// maxRequestBody is the hard cap on total request body size.
const maxRequestBody = MaxScreenshotSize + 1024*1024

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

	// Enforce a hard cap on total request body size
	e.Request.Body = http.MaxBytesReader(nil, e.Request.Body, maxRequestBody)

	// Parse multipart form
	if err := e.Request.ParseMultipartForm(maxRequestBody); err != nil {
		return apis.NewBadRequestError("Invalid form data", err)
	}

	// Extract and validate required fields
	category := e.Request.FormValue("category")
	description, descErr := validateDescription(e.Request.FormValue("description"))
	if descErr != nil {
		return apis.NewBadRequestError(descErr.Error(), nil)
	}
	if catErr := validateCategory(category); catErr != nil {
		return apis.NewBadRequestError(catErr.Error(), nil)
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
	file, header, fileErr := e.Request.FormFile("screenshot")
	if fileErr == nil {
		defer func() { _ = file.Close() }()

		// Check declared file size
		if header.Size > MaxScreenshotSize {
			return apis.NewBadRequestError("Screenshot must be under 5MB", nil)
		}

		// Read with a hard limit to prevent memory exhaustion
		data, readErr := io.ReadAll(io.LimitReader(file, MaxScreenshotSize+1))
		if readErr != nil {
			slog.Error("Failed to read screenshot", "error", readErr)
			return apis.NewBadRequestError("Failed to read screenshot", readErr)
		}
		if int64(len(data)) > MaxScreenshotSize {
			return apis.NewBadRequestError("Screenshot must be under 5MB", nil)
		}

		// Validate that the file is actually an image
		if contentErr := validateScreenshotContent(data); contentErr != nil {
			return apis.NewBadRequestError(contentErr.Error(), nil)
		}

		filename := sanitizeFilename(header.Filename)
		screenshotURL, uploadErr := client.UploadScreenshot(data, filename, timestamp)
		if uploadErr != nil {
			slog.Error("Failed to upload screenshot to GitHub", "error", uploadErr)
			return apis.NewApiError(502, "Failed to submit feedback. Please try again.", nil)
		}
		params.ScreenshotURL = screenshotURL
	} else if !errors.Is(fileErr, http.ErrMissingFile) {
		return apis.NewBadRequestError("Invalid screenshot upload", fileErr)
	}

	// Create the GitHub issue
	if createErr := client.CreateIssue(params); createErr != nil {
		slog.Error("Failed to create GitHub issue", "error", createErr)
		return apis.NewApiError(502, "Failed to submit feedback. Please try again.", nil)
	}

	slog.Info("Feedback submitted",
		"category", category,
		"page", pageURL,
	)

	return e.JSON(http.StatusOK, map[string]bool{"success": true})
}

// sanitizeFilename strips path components from a user-supplied filename.
func sanitizeFilename(name string) string {
	return filepath.Base(name)
}

// validateDescription checks that a description is non-empty after trimming whitespace.
func validateDescription(desc string) (string, error) {
	trimmed := strings.TrimSpace(desc)
	if trimmed == "" {
		return "", fmt.Errorf("description is required")
	}
	return trimmed, nil
}

// validateScreenshotContent checks that the uploaded data has an image content type.
func validateScreenshotContent(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("screenshot file is empty")
	}
	contentType := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		return fmt.Errorf("uploaded file is not an image (detected: %s)", contentType)
	}
	return nil
}
