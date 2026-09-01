package rbac

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// categoryRegistration is the business category for registration-related configs.
const categoryRegistration = "registration"

// isRegistrationConfig returns true if the given category is "registration".
func isRegistrationConfig(category string) bool {
	return category == categoryRegistration
}

// notifyMetricsCacheInvalidation sends a fire-and-forget POST to the FastAPI
// metrics cache invalidation endpoint. Errors are logged but do not propagate;
// the cache will expire via TTL regardless.
func notifyMetricsCacheInvalidation(apiBaseURL string) {
	go func() {
		url := fmt.Sprintf("%s/api/metrics/cache/invalidate", apiBaseURL)
		client := &http.Client{Timeout: 5 * time.Second}

		resp, err := client.Post(url, "application/json", nil) //nolint:noctx,gosec // fire-and-forget internal call;
		// G704 (SSRF): url is built from a hardcoded 127.0.0.1 loopback host plus API_PORT,
		// an operator-set env var with an "8000" default. Nothing request-derived reaches it.
		if err != nil {
			slog.Warn("Failed to notify FastAPI metrics cache invalidation", "url", url, "error", err)
			return
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode == http.StatusOK {
			slog.Info("Metrics cache invalidated after registration config change")
		} else {
			slog.Warn("Metrics cache invalidation returned non-200", "status", resp.StatusCode)
		}
	}()
}

// registerConfigHooks registers hooks that invalidate the FastAPI metrics cache
// when registration config records are created or updated.
func registerConfigHooks(app *pocketbase.PocketBase) {
	apiPort := os.Getenv("API_PORT")
	if apiPort == "" {
		apiPort = "8000"
	}
	apiBaseURL := fmt.Sprintf("http://127.0.0.1:%s", apiPort)

	onConfigChange := func(e *core.RecordEvent) error {
		category := e.Record.GetString("category")
		if isRegistrationConfig(category) {
			slog.Info("Registration config changed, invalidating metrics cache",
				"config_key", e.Record.GetString("config_key"))
			notifyMetricsCacheInvalidation(apiBaseURL)
		}
		return e.Next()
	}

	app.OnRecordAfterCreateSuccess("config").BindFunc(onConfigChange)
	app.OnRecordAfterUpdateSuccess("config").BindFunc(onConfigChange)
}
