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
)

func main() {
	dbDir := flag.String("data", "pb_data", "PocketBase data directory")
	flag.Parse()

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: *dbDir,
	})
	if err := app.Bootstrap(); err != nil {
		slog.Error("bootstrap", "error", err)
		os.Exit(1)
	}
	defer app.ResetBootstrapState()

	count, err := bunkrequests.BackfillAll(app)
	if err != nil {
		slog.Error("backfill failed", "error", err)
		os.Exit(1)
	}
	slog.Info("backfill complete", "pairs_processed", count)
}
