// Package version reports the version this PocketBase image was built at.
//
// CD rebuilds only the images whose files changed and retags the rest, so the
// frontend's own baked version says nothing about this server's. The image
// bakes KINDRED_VERSION at build time and this endpoint hands it back; the
// frontend shows the newest of its components and puts each one in feedback.
package version

import (
	"net/http"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// EnvVar names the variable the image's final stage bakes the version into.
const EnvVar = "KINDRED_VERSION"

// devVersion is what a build without a baked version reports, matching the
// frontend's own fallback.
const devVersion = "dev"

// RegisterRoutes mounts GET /api/custom/version. Any signed-in user may read
// it; an anonymous request gets 401.
func RegisterRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/custom/version", handleVersion).Bind(apis.RequireAuth())
}

func handleVersion(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, map[string]string{"pocketbase": Current()})
}

// Current is the baked version, or "dev" when the image carries none.
func Current() string {
	if v := strings.TrimSpace(os.Getenv(EnvVar)); v != "" {
		return v
	}
	return devVersion
}
