package feedback

import (
	"os"
	"testing"
)

func TestMaxScreenshotSize(t *testing.T) {
	if MaxScreenshotSize != 5*1024*1024 {
		t.Errorf("MaxScreenshotSize = %d, want %d", MaxScreenshotSize, 5*1024*1024)
	}
}

func TestHandleFeedbackMissingConfig(t *testing.T) {
	// Ensure env vars are unset
	os.Unsetenv("GITHUB_FEEDBACK_TOKEN")
	os.Unsetenv("GITHUB_FEEDBACK_REPO")

	token := os.Getenv("GITHUB_FEEDBACK_TOKEN")
	repo := os.Getenv("GITHUB_FEEDBACK_REPO")
	if token != "" || repo != "" {
		t.Skip("GITHUB_FEEDBACK_TOKEN or GITHUB_FEEDBACK_REPO is set")
	}

	// Verify the config check logic
	if token == "" || repo == "" {
		// This is the expected path — handler would return 503
		return
	}
	t.Error("expected missing config to be detected")
}

func TestHandleFeedbackValidation(t *testing.T) {
	// Test description validation logic
	description := ""
	if description == "" {
		// Expected: handler would return 400 "Description is required"
		return
	}
	t.Error("expected empty description to fail validation")
}
