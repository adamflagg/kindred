package rbac

import (
	"slices"
	"testing"
)

// TestBootedTrustedProxyTrustsCaddysRealIP: migration 1500000207 makes
// RequestEvent.RealIP() read the X-Real-IP header Caddy sets on every
// PocketBase route, so the audit log records the client, not Caddy. Runs only
// in CI's "Booted auth rules agreement" step (newBootedTestApp skips elsewhere).
func TestBootedTrustedProxyTrustsCaddysRealIP(t *testing.T) {
	app := newBootedTestApp(t)
	defer app.Cleanup()
	got := app.Settings().TrustedProxy
	if !slices.Equal(got.Headers, []string{"X-Real-IP"}) || got.UseLeftmostIP {
		t.Fatalf("settings.trustedProxy = %+v, want headers [X-Real-IP] and useLeftmostIP false", got)
	}
}
