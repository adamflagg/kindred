// Command backfill_reciprocity walks all bunk_requests pairs and recomputes
// is_reciprocal for each, fixing any historical drift introduced before the
// reciprocity hook was deployed. Idempotent — safe to re-run.
package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/pocketbase/pocketbase"

	bunkrequests "github.com/camp/kindred/pocketbase/bunk_requests"
	"github.com/camp/kindred/pocketbase/logging"
)

func main() {
	os.Exit(run())
}

func run() int {
	logging.Init("backfill_reciprocity")

	dbDir := flag.String("data", "pb_data", "PocketBase data directory")
	flag.Parse()

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: *dbDir,
	})
	if err := app.Bootstrap(); err != nil {
		slog.Error("bootstrap", "error", err)
		return 1
	}
	defer func() {
		if err := app.ResetBootstrapState(); err != nil {
			slog.Warn("ResetBootstrapState", "error", err)
		}
	}()

	count, err := bunkrequests.BackfillAll(app)
	if err != nil {
		slog.Error("backfill failed", "error", err, "pairs_attempted", count)
		return 1
	}
	slog.Info("backfill complete", "pairs_processed", count)
	return 0
}
