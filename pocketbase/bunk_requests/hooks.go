package bunkrequests

import (
	"github.com/pocketbase/pocketbase"
)

// RegisterHooks wires reciprocity-recompute hooks onto the bunk_requests
// collection. Errors are logged via slog and never block the underlying write.
func RegisterHooks(app *pocketbase.PocketBase) {
	// TODO: wire up Create/Update/Delete success hooks in Task 4
	_ = app
}
