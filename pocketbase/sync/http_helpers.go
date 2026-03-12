package sync

import (
	"net/http"
	"os"
	"time"
)

// getAPIURL returns the FastAPI container URL from environment.
// In Docker: API_URL=http://api:8000. In dev: falls back to localhost.
func getAPIURL() string {
	if url := os.Getenv("API_URL"); url != "" {
		return url
	}
	return "http://127.0.0.1:8000"
}

// geoNormalizeClient is a shared HTTP client for geo-normalize API calls.
// Reused across calls for connection pooling.
var geoNormalizeClient = &http.Client{Timeout: 2 * time.Minute}
