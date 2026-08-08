// Package main is the entry point for the PocketBase extension with sync capabilities
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/hook"

	// Import our packages
	bunkrequests "github.com/camp/kindred/pocketbase/bunk_requests"
	"github.com/camp/kindred/pocketbase/feedback"
	"github.com/camp/kindred/pocketbase/lodging"
	"github.com/camp/kindred/pocketbase/logging"
	"github.com/camp/kindred/pocketbase/rbac"
	"github.com/camp/kindred/pocketbase/sync"
)

func init() {
	// Override the OIDC provider factories to include the "groups" scope.
	// PocketBase's OAuth2ProviderConfig has no scopes field, so the only way
	// to request additional scopes is to replace the provider factory.
	for _, name := range []string{auth.NameOIDC, auth.NameOIDC + "2", auth.NameOIDC + "3"} {
		auth.Providers[name] = func() auth.Provider {
			p := auth.NewOIDCProvider()
			p.SetScopes([]string{"openid", "email", "profile", "groups"})
			return p
		}
	}
}

func main() {
	// Initialize unified logging format
	// Format: 2026-01-06T14:05:52Z [pocketbase] LEVEL message
	logging.Init("pocketbase")

	app := pocketbase.New()

	// ---------------------------------------------------------------
	// Optional plugin flags:
	// ---------------------------------------------------------------

	var hooksDir string
	app.RootCmd.PersistentFlags().StringVar(
		&hooksDir,
		"hooksDir",
		"",
		"the directory with the JS app hooks",
	)

	var hooksWatch bool
	app.RootCmd.PersistentFlags().BoolVar(
		&hooksWatch,
		"hooksWatch",
		true,
		"auto restart the app on pb_hooks file change",
	)

	var hooksPool int
	app.RootCmd.PersistentFlags().IntVar(
		&hooksPool,
		"hooksPool",
		15,
		"the total prewarm goja.Runtime instances for the JS app hooks execution",
	)

	var migrationsDir string
	app.RootCmd.PersistentFlags().StringVar(
		&migrationsDir,
		"migrationsDir",
		"",
		"the directory with the user defined migrations",
	)

	var automigrate bool
	app.RootCmd.PersistentFlags().BoolVar(
		&automigrate,
		"automigrate",
		true,
		"enable/disable auto migrations",
	)

	var publicDir string
	app.RootCmd.PersistentFlags().StringVar(
		&publicDir,
		"publicDir",
		defaultPublicDir(),
		"the directory to serve static files",
	)

	var indexFallback bool
	app.RootCmd.PersistentFlags().BoolVar(
		&indexFallback,
		"indexFallback",
		true,
		"fallback the request to index.html on missing static path",
	)

	// ---------------------------------------------------------------
	// Register plugins:
	// ---------------------------------------------------------------

	// load jsvm (hooks and migrations)
	jsvm.MustRegister(app, jsvm.Config{
		HooksDir:      hooksDir,
		HooksWatch:    hooksWatch,
		HooksPoolSize: hooksPool,
		MigrationsDir: migrationsDir,
	})

	// register the `migrate` command
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		TemplateLang: migratecmd.TemplateLangJS, // Use JS migrations
		Automigrate:  automigrate,
		Dir:          migrationsDir,
	})

	// History-sync hook: keep prod's _migrations table in sync with the
	// on-disk migration file list on every server boot. PB's built-in
	// `migrate history-sync` (RemoveMissingAppliedMigrations) deletes rows
	// for files no longer present. Idempotent — no-op on clean DBs. Used by
	// the consolidate-migrations skill to self-heal prod's migration history
	// after consolidation merges drop intermediate migration files.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		if err := runHistorySync(e.App); err != nil {
			slog.Warn("history-sync hook failed", "err", err)
		}
		return e.Next()
	})

	// Lodging registry loader. The unit registry is camp-identifying private
	// data carried in kindred-local, not source, so it cannot be seeded by a
	// migration: `_migrations` keys on filename and applies once, so a
	// migration that read an absent private file in CI would be recorded as
	// applied and never re-run when the file later appeared — a silently empty
	// registry. Running on every boot means a file that shows up later still
	// takes effect. Absent file is a logged no-op, the same graceful
	// degradation branding has. See docs/reference/lodging-registry.md.
	//
	// Warn-and-boot only for the clone-with-no-private-config case: no
	// registry file means nothing to load, and refusing to boot over that
	// would break every clone and CI run that lacks kindred-local. Once the
	// registry file IS present, an unresolvable season stops being "nothing
	// to load" and becomes "someone configured this deployment to have
	// lodging and it silently has none" — that case fails the boot instead
	// of leaving it behind a single warn-level log line nobody is watching.
	// See issue #2054 (Half 2); lodgingRegistryBootDecision below carries the
	// tests for this split.
	//
	// Skip rather than guess. Seeding ~118 units into a guessed season is
	// strictly worse than seeding none: the first roll-forward would carry
	// the phantom season forward as though it were real.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		year, err := sync.ParseSeasonYear()
		if err != nil {
			if bootErr := lodgingRegistryBootDecision(err, lodging.RegistryFilePresent()); bootErr != nil {
				return bootErr
			}
			return e.Next()
		}
		if err := lodging.SeedRegistry(e.App, year); err != nil {
			slog.Warn("lodging registry load failed", "err", err)
		}
		return e.Next()
	})

	// Config initialization now handled by migrations

	// ---------------------------------------------------------------
	// Register custom routes and services:
	// ---------------------------------------------------------------

	// Register sync service
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			// Initialize sync service
			slog.Info("Initializing Kindred sync service")
			if err := sync.InitializeSyncService(app, e); err != nil {
				return fmt.Errorf("initializing sync service: %w", err)
			}

			return e.Next()
		},
	})

	// Register feedback endpoint
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		feedback.RegisterRoutes(e)
		return e.Next()
	})

	// Register RBAC hooks for permission cache recomputation
	rbac.RegisterHooks(app)

	// Register bunk_requests reciprocity hook (keeps is_reciprocal accurate
	// after any write — closes #1059, supports #1069 status flips).
	bunkrequests.RegisterHooks(app)

	// Register weekend-lodging integrity guards. The DB cannot enforce these:
	// lodging_assignments.unit/.merge are optional relations, so deleting
	// their target silently orphans the placement instead of blocking.
	//
	// Wrapped in OnServe, unlike rbac's and bunk_requests' calls just above:
	// wireHooks' year guard calls app.FindCollectionByNameOrId before binding,
	// to skip lodging_slot_merges gracefully while that table belongs only to
	// a parallel branch. That lookup needs an open database, and this line
	// otherwise runs from main() before app.Start() bootstraps one -- the same
	// reason the registry seed and RegisterRoutes below are deferred the same
	// way. wireHooks itself is untouched, so TestGuardUnitYearSkipsAnAbsentCollection
	// and every other test that calls it directly on an already-bootstrapped
	// TestApp still see the same synchronous behavior.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		lodging.RegisterHooks(app)
		return e.Next()
	})

	// Register the lodging roll-forward endpoints (copies one season's
	// registry onto the next).
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		lodging.RegisterRoutes(e)
		return e.Next()
	})

	// Start scheduler after the app is fully initialized
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		// Start the sync scheduler in a goroutine to avoid blocking
		go func() {
			// Wait a bit to ensure everything is initialized
			time.Sleep(2 * time.Second)

			slog.Info("Starting sync scheduler")
			if err := sync.StartSyncScheduler(app); err != nil {
				slog.Error("Failed to start sync scheduler", "error", err)
			}
		}()

		return e.Next()
	})

	// Register static file serving (with lowest priority)
	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), indexFallback))
			}
			return e.Next()
		},
		Priority: 999,
	})

	if err := app.Start(); err != nil {
		slog.Error("Failed to start application", "error", err)
		os.Exit(1)
	}
}

// runHistorySync removes _migrations rows whose files no longer exist on disk
// (registered in core.SystemMigrations or core.AppMigrations). Mirrors PB's
// own BaseApp.RunAllMigrations list construction so we don't accidentally
// delete rows for PB's built-in system migrations (e.g. 1640988000_init.go),
// which would cause the next boot to re-apply them and fail with
// "_params exec error: table _params already exists". After a successful
// sync, flushes the WAL so the change persists across docker stop/start.
func runHistorySync(app core.App) error {
	list := core.MigrationsList{}
	list.Copy(core.SystemMigrations)
	list.Copy(core.AppMigrations)
	if err := core.NewMigrationsRunner(app, list).Run("history-sync"); err != nil {
		return fmt.Errorf("history-sync: %w", err)
	}
	if _, err := app.DB().NewQuery("PRAGMA wal_checkpoint(TRUNCATE)").Execute(); err != nil {
		return fmt.Errorf("history-sync WAL checkpoint failed: %w", err)
	}
	return nil
}

// lodgingRegistryBootDecision turns a sync.ParseSeasonYear failure into
// either a warning (boot continues) or a boot error, depending on whether the
// private lodging registry file exists on disk.
//
//   - registryPresent == false: a clone (or CI run) with no kindred-local
//     config. Nothing to load — warn and let the boot continue, the same
//     graceful degradation this loader has always given a fresh clone.
//   - registryPresent == true: the registry file IS there, but the season it
//     needs to seed against can't be resolved. That combination means an
//     operator configured this deployment to have lodging data, and it would
//     otherwise come up with an empty registry — every cabin string failing
//     to resolve — signaled by nothing but a warn-level log line. Failing
//     the boot makes that visible immediately instead of months later.
//
// Split out from the OnServe hook so the decision is unit-testable without
// booting a PocketBase app or touching the filesystem. See issue #2054.
func lodgingRegistryBootDecision(seasonErr error, registryPresent bool) error {
	if !registryPresent {
		slog.Warn("lodging registry load skipped: season unavailable", "err", seasonErr)
		return nil
	}
	return fmt.Errorf(
		"lodging registry file present but no season is resolvable "+
			"(set CAMPMINDER_SEASON_ID): %w", seasonErr,
	)
}

// the default pb_public dir location is relative to the executable
func defaultPublicDir() string {
	if strings.HasPrefix(os.Args[0], os.TempDir()) {
		// most likely ran with go run
		return "./pb_public"
	}

	return filepath.Join(filepath.Dir(os.Args[0]), "pb_public")
}
