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

// the default pb_public dir location is relative to the executable
func defaultPublicDir() string {
	if strings.HasPrefix(os.Args[0], os.TempDir()) {
		// most likely ran with go run
		return "./pb_public"
	}

	return filepath.Join(filepath.Dir(os.Args[0]), "pb_public")
}
