// Package main is the entry point for the PocketBase extension with sync capabilities
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
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

// bootFailureSentinel records an error from a boot-stopping OnServe hook so
// main() can observe it after app.Start() returns. It exists because
// pocketbase.PocketBase.Execute() (pocketbase.go:179-212) runs cobra's
// RootCmd.Execute() in a goroutine and discards its return value: the
// serve command's OnServe-hook error does stop apis.Serve and gets printed
// by cobra, but Execute() itself returns whatever OnTerminate().Trigger(...)
// produces, which is nil on the normal shutdown path regardless of whether
// serve actually failed. So app.Start() -- a thin wrapper over Execute() --
// comes back nil too, and main()'s existing `if err := app.Start(); err !=
// nil { os.Exit(1) }` block never fires for this class of failure. See
// issue #2140.
//
// A hook that decides the boot must not continue calls Set alongside
// returning its error (the hook's return value is unchanged -- OnServe
// still needs it to stop apis.Serve and to have cobra print it). main()
// then checks Get once app.Start() returns.
//
// atomic.Pointer over a mutex-guarded var: Set/Get are single-word CAS/load
// ops, so there's no lock to forget to take, and a zero-value
// bootFailureSentinel is immediately safe to use -- no constructor needed
// for the package-level instance below.
type bootFailureSentinel struct {
	err atomic.Pointer[error]
}

// Set records err as the reason the boot must not continue. A later Set
// overwrites an earlier one -- main() only needs to know that at least one
// boot-stopping hook failed and why, not the full history.
func (s *bootFailureSentinel) Set(err error) {
	s.err.Store(&err)
}

// Get returns the most recently recorded boot failure, or nil if no
// boot-stopping hook has failed.
func (s *bootFailureSentinel) Get() error {
	p := s.err.Load()
	if p == nil {
		return nil
	}
	return *p
}

// Reset clears any recorded boot failure. Exists for tests: the sentinel
// below is a package-level singleton, so a test that records into it must
// clear it afterward to avoid leaking state into the next test.
func (s *bootFailureSentinel) Reset() {
	s.err.Store(nil)
}

var bootSentinel bootFailureSentinel

// recordBootFailure marks a boot-stopping OnServe hook failure for main()
// to observe after app.Start() returns nil despite the hook's error. See
// bootFailureSentinel above.
func recordBootFailure(err error) {
	bootSentinel.Set(err)
}

// bootFailure returns the last error recorded by recordBootFailure, or nil
// if no boot-stopping hook has failed.
func bootFailure() error {
	return bootSentinel.Get()
}

// resetBootFailure clears the sentinel. Exists for tests -- see
// bootFailureSentinel.Reset.
func resetBootFailure() {
	bootSentinel.Reset()
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
	// registry file IS present AND the database has no lodging rows yet, an
	// unresolvable season stops being "nothing to load" and becomes "someone
	// configured this deployment to have lodging and it silently has none"
	// — that case fails the boot instead of leaving it behind a single
	// warn-level log line nobody is watching.
	//
	// The hasRows check matters on its own: SeedRegistry is a bootstrap that
	// no-ops once any season already has rows (registry.go:175-185), so a
	// production deployment with an already-seeded registry has nothing at
	// risk when the season goes missing or malformed after the fact — the
	// existing data is untouched either way. Failing the boot on
	// file-presence alone, without checking hasRows, would turn a harmless
	// env var hiccup on an already-seeded deployment into a full outage for
	// a condition SeedRegistry itself would have silently ignored.
	// See issue #2054 (Half 2); lodgingRegistryBootDecision below carries the
	// tests for this split.
	//
	// The seed branch below applies the SAME rule to the same symptom from the
	// other direction: a season that resolves fine but a registry file that is
	// present and unloadable (malformed JSON, a duplicate code, an unknown
	// reference) also fails the boot rather than warning, since it lands in an
	// identically empty registry. lodgingRegistrySeedBootDecision carries that
	// decision and its tests. See issue #2141.
	//
	// Skip rather than guess. Seeding ~118 units into a guessed season is
	// strictly worse than seeding none: the first roll-forward would carry
	// the phantom season forward as though it were real.
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		year, err := sync.ParseSeasonYear()
		if err != nil {
			hasRows, rowsErr := lodging.RegistryHasRows(e.App)
			if rowsErr != nil {
				// Can't determine whether the registry already has rows —
				// fail open (warn, don't take the boot down) rather than
				// compound one failure with a second, less legible one.
				slog.Warn("lodging registry load skipped: season unavailable "+
					"(row-presence check also failed)", "err", err, "rows_check_err", rowsErr)
				return e.Next()
			}
			if bootErr := lodgingRegistryBootDecision(err, lodging.RegistryFilePresent(), hasRows); bootErr != nil {
				// Recorded so main() can os.Exit(1) after app.Start()
				// returns nil regardless -- see bootFailureSentinel (#2140).
				recordBootFailure(bootErr)
				return bootErr
			}
			return e.Next()
		}
		if bootErr := lodgingRegistrySeedBootDecision(lodging.SeedRegistry(e.App, year)); bootErr != nil {
			// Recorded so main() can os.Exit(1) after app.Start() returns
			// nil regardless -- see bootFailureSentinel (#2140).
			recordBootFailure(bootErr)
			return bootErr
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
				bootErr := fmt.Errorf("initializing sync service: %w", err)
				// Recorded so main() can os.Exit(1) after app.Start()
				// returns nil regardless -- see bootFailureSentinel (#2140).
				recordBootFailure(bootErr)
				return bootErr
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

	// app.Start() can return nil even though a boot-stopping OnServe hook
	// failed: pocketbase.PocketBase.Execute() runs cobra's RootCmd in a
	// goroutine and discards its return value, so the serve command's
	// error never reaches here. Check the sentinel those hooks record into
	// instead. See bootFailureSentinel above and issue #2140.
	if err := bootFailure(); err != nil {
		slog.Error("Boot aborted by a serve hook", "error", err)
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
// private lodging registry file exists on disk AND whether the database
// already has lodging rows from a prior successful seed.
//
//   - registryPresent == false: a clone (or CI run) with no kindred-local
//     config. Nothing to load — warn and let the boot continue, the same
//     graceful degradation this loader has always given a fresh clone.
//   - registryPresent == true, hasRows == true: the registry file is there,
//     but the database was already seeded by an earlier boot.
//     lodging.SeedRegistry is a bootstrap that no-ops once any season has
//     rows (registry.go:175-185), so this deployment's existing lodging data
//     is not at risk from an unresolvable season — warn and continue, the
//     same as the no-file case. Gating on file-presence alone here would
//     turn a harmless env var hiccup on an already-seeded production
//     deployment into a full boot failure.
//   - registryPresent == true, hasRows == false: the registry file IS there,
//     the database is genuinely empty, and the season it needs to seed
//     against can't be resolved. That combination means an operator
//     configured this deployment to have lodging data, and it would
//     otherwise come up with an empty registry — every cabin string failing
//     to resolve — signaled by nothing but a warn-level log line. Failing
//     the boot makes that visible immediately instead of months later.
//
// Split out from the OnServe hook so the decision is unit-testable without
// booting a PocketBase app or touching the filesystem. See issue #2054.
func lodgingRegistryBootDecision(seasonErr error, registryPresent, hasRows bool) error {
	if !registryPresent || hasRows {
		slog.Warn("lodging registry load skipped: season unavailable", "err", seasonErr)
		return nil
	}
	return fmt.Errorf(
		"lodging registry file present but no season is resolvable "+
			"(set CAMPMINDER_SEASON_ID): %w", seasonErr,
	)
}

// lodgingRegistrySeedBootDecision turns a lodging.SeedRegistry failure into
// either a warning (boot continues) or a boot error.
//
// This is the sibling of lodgingRegistryBootDecision above, and exists
// because the two branches of the same OnServe hook were inconsistent: the
// season-unresolvable case failed the boot while a registry file that is
// present and unloadable — malformed JSON, a duplicate code, an unknown
// area/parent/alias-member reference — only warned. Same hook, same symptom
// (an empty registry, every cabin string failing to resolve), on a likelier
// trigger, since a hand-edited registry file is more prone to a JSON typo
// than an env var is to going missing. See issue #2141.
//
//   - nil: the seed succeeded, or had nothing to do. Both the absent-file
//     cases already return nil (registry.go), so a clone or CI run without
//     kindred-local keeps booting exactly as before.
//   - lodging.ErrRegistryRowCheck: the loader could not determine whether the
//     registry already has rows, so it does not know whether anything is at
//     risk. Fail open — warn and boot — the same call the season branch above
//     makes for its own row-check failure, rather than compounding one
//     failure with a second, less legible one.
//   - anything else: the registry file is present and genuinely unloadable.
//     Fail the boot.
//
// The hasRows bound that lodgingRegistryBootDecision has to check explicitly
// comes free here: SeedRegistry returns nil early once ANY season has rows
// (registry.go:175-185), so a non-nil error out of it already implies a
// genuinely empty registry. An already-seeded deployment cannot reach the
// failing branch at all.
func lodgingRegistrySeedBootDecision(seedErr error) error {
	if seedErr == nil {
		return nil
	}
	if errors.Is(seedErr, lodging.ErrRegistryRowCheck) {
		slog.Warn("lodging registry load skipped: could not check for existing rows",
			"err", seedErr)
		return nil
	}
	return fmt.Errorf("loading lodging registry: %w", seedErr)
}

// the default pb_public dir location is relative to the executable
func defaultPublicDir() string {
	if strings.HasPrefix(os.Args[0], os.TempDir()) {
		// most likely ran with go run
		return "./pb_public"
	}

	return filepath.Join(filepath.Dir(os.Args[0]), "pb_public")
}
