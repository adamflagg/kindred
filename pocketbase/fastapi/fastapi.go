// Package fastapi is how PocketBase's Go code reaches the FastAPI service.
//
// In production the two run in separate containers on the `kindred-internal`
// network, and FastAPI is at API_URL (http://api:8000, set in both
// docker-compose files). In a worktree, scripts/worktree/new.sh writes API_URL
// with that worktree's own port. With neither, it is the dev default
// 127.0.0.1:8000, which is where scripts/start_dev.sh starts uvicorn.
package fastapi

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

// devBaseURL is FastAPI's address when API_URL is unset: scripts/start_dev.sh.
const devBaseURL = "http://127.0.0.1:8000"

// cacheInvalidatePath is FastAPI's server-cache invalidate endpoint
// (api/routers/metrics.py). The auth middleware skips it: clearing a cache is
// safe and idempotent, and its PocketBase callers carry no user.
const cacheInvalidatePath = "/api/metrics/cache/invalidate"

// invalidateTimeout bounds one invalidate call. The endpoint only clears
// in-memory caches and schedules a background warm, so it answers in
// milliseconds; anything slower is an API that is down or wedged.
const invalidateTimeout = 5 * time.Second

// BaseURL returns FastAPI's base URL: API_URL when set, the dev default otherwise.
func BaseURL() string {
	if u := os.Getenv("API_URL"); u != "" {
		return u
	}
	return devBaseURL
}

// InvalidateCaches asks FastAPI to clear its server caches after `syncType`
// finished, so it clears only what that job could have changed (metrics
// always; the lodging year cache and the social graph cache when the job
// writes a table they read -- api/constants/sync_job_writes.py). An empty
// syncType sends no parameter, which FastAPI treats as "clear everything".
//
// Returns an error for the caller to log. Callers treat it as best-effort:
// every cache still expires on its own TTL.
func InvalidateCaches(ctx context.Context, baseURL, syncType string) error {
	return invalidateCaches(ctx, &http.Client{Timeout: invalidateTimeout}, baseURL, syncType)
}

func invalidateCaches(ctx context.Context, client *http.Client, baseURL, syncType string) error {
	endpoint := baseURL + cacheInvalidatePath
	if syncType != "" {
		endpoint += "?" + url.Values{"sync_type": {syncType}}.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, http.NoBody)
	if err != nil {
		return fmt.Errorf("building cache-invalidate request: %w", err)
	}
	// G704 (SSRF): baseURL is API_URL, an operator-set env var, or the fixed
	// dev default; syncType is a registered job id and is query-encoded.
	// Nothing request-derived reaches the URL.
	resp, err := client.Do(req) //nolint:gosec // see G704 note above
	if err != nil {
		return fmt.Errorf("calling %s: %w", cacheInvalidatePath, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %d", cacheInvalidatePath, resp.StatusCode)
	}
	return nil
}
