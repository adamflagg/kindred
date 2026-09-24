package rbac

import (
	"context"
	"log/slog"

	"github.com/camp/kindred/pocketbase/fastapi"
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
// cache invalidation endpoint. Errors are logged but do not propagate; the
// cache will expire via TTL regardless.
func notifyMetricsCacheInvalidation(apiBaseURL string) {
	go func() {
		// No sync named: FastAPI clears every cache, as this hook always had it do.
		if err := fastapi.InvalidateCaches(context.Background(), apiBaseURL, ""); err != nil {
			slog.Warn("Failed to notify FastAPI metrics cache invalidation", "url", apiBaseURL, "error", err)
			return
		}
		slog.Info("Metrics cache invalidated after registration config change")
	}()
}

// configHooksAPIBaseURL is where the hook finds FastAPI -- API_URL, shared
// with the sync layer. It used to build 127.0.0.1:$API_PORT, which in
// production is PocketBase's OWN container (FastAPI is the `api` service), so
// the call never arrived and a registration-config edit left metrics stale
// until the cache's 2-hour TTL.
func configHooksAPIBaseURL() string {
	return fastapi.BaseURL()
}

// registerConfigHooks registers hooks that invalidate the FastAPI metrics cache
// when registration config records are created or updated.
func registerConfigHooks(app *pocketbase.PocketBase) {
	apiBaseURL := configHooksAPIBaseURL()

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
