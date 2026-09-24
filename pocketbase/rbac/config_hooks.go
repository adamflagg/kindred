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
// It gates the RBAC config-write guard (hooks.go), so it stays registration-only
// even though the metrics-cache hook below now covers more categories.
func isRegistrationConfig(category string) bool {
	return category == categoryRegistration
}

// metricsCacheConfigCategories are the config categories a cached FastAPI
// metrics response reads: registration dates (velocity, forecast, day-1),
// budget goals (forecast) and session_availability grade ranges, capacity
// overrides and threshold (session availability). A write to any of them --
// including one made in the PocketBase admin UI, which no frontend
// invalidation can see -- must clear the 2-hour metrics_cache.
var metricsCacheConfigCategories = map[string]bool{
	"registration":         true,
	"budget":               true,
	"session_availability": true,
}

// configCategoryInvalidatesMetricsCache reports whether a config row in
// `category` feeds a cached metrics response. Case-sensitive, like the data.
func configCategoryInvalidatesMetricsCache(category string) bool {
	return metricsCacheConfigCategories[category]
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
		slog.Info("Metrics cache invalidated after config change")
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
// when a config row a metric reads is created, updated or deleted.
func registerConfigHooks(app *pocketbase.PocketBase) {
	apiBaseURL := configHooksAPIBaseURL()
	bindConfigHooks(app, func() { notifyMetricsCacheInvalidation(apiBaseURL) })
}

// bindConfigHooks binds the config create/update/delete hooks, calling notify
// for rows in a metrics-read category. Split from registerConfigHooks so a
// test can bind it to a test app with a counting notify.
func bindConfigHooks(app core.App, notify func()) {
	onConfigChange := func(e *core.RecordEvent) error {
		category := e.Record.GetString("category")
		if configCategoryInvalidatesMetricsCache(category) {
			slog.Info("Metrics-read config changed, invalidating metrics cache",
				"category", category, "config_key", e.Record.GetString("config_key"))
			notify()
		}
		return e.Next()
	}

	app.OnRecordAfterCreateSuccess("config").BindFunc(onConfigChange)
	app.OnRecordAfterUpdateSuccess("config").BindFunc(onConfigChange)
	app.OnRecordAfterDeleteSuccess("config").BindFunc(onConfigChange)
}
