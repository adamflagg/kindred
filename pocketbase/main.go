// Package main is the entry point for the PocketBase extension with sync capabilities
package main

import (
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
	"github.com/pocketbase/pocketbase/tools/hook"

	// Import our packages
	"github.com/camp/kindred/pocketbase/logging"
	"github.com/camp/kindred/pocketbase/sync"
)

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
				return err
			}

			return e.Next()
		},
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

// the default pb_public dir location is relative to the executable
func defaultPublicDir() string {
	if strings.HasPrefix(os.Args[0], os.TempDir()) {
		// most likely ran with go run
		return "./pb_public"
	}

	return filepath.Join(filepath.Dir(os.Args[0]), "pb_public")
}
