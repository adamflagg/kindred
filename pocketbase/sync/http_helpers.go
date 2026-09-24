package sync

import (
	"net/http"
	"time"

	"github.com/camp/kindred/pocketbase/fastapi"
)

// getAPIURL returns the FastAPI container URL from environment.
// In Docker: API_URL=http://api:8000. In dev: falls back to localhost.
// One resolver for every Go caller -- see package fastapi.
func getAPIURL() string {
	return fastapi.BaseURL()
}

// geoNormalizeClient is a shared HTTP client for geo-normalize API calls.
// Reused across calls for connection pooling.
var geoNormalizeClient = &http.Client{Timeout: 2 * time.Minute}
