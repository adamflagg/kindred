// Package oidclogout receives OpenID Connect Back-Channel Logout 1.0 requests
// (https://openid.net/specs/openid-connect-backchannel-1_0.html) from the
// identity provider staff sign in with, and signs the named user out of every
// Kindred session.
//
// Why it exists: PocketBase asks the provider about a user only at a full
// sign-in. The SPA refreshes its PocketBase token on every load, so a user
// disabled at the provider would otherwise keep access indefinitely. When the
// provider disables a user it POSTs a signed logout_token here; a valid one
// rotates that user's tokenKey, which invalidates every auth token PocketBase
// has issued them and drops their realtime auth. The record itself is kept:
// deleting it would break the history that links to it.
//
// Configuration comes from what sign-in already uses: the issuer from
// OIDC_ISSUER (the variable kindred-init discovers the provider from) and the
// client id from the users collection's "oidc" provider. Without either, the
// endpoint answers 404, as if it did not exist.
package oidclogout

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/auth"
)

// Path is where the provider's back-channel logout URL must point.
const Path = "/api/custom/auth/backchannel-logout"

const (
	// maxBody caps the request body. A logout token is a few hundred bytes to
	// a couple of KiB; nothing legitimate comes close.
	maxBody = 64 << 10

	// defaultRefetchEvery is the least time between two key fetches, so an
	// unauthenticated caller sending unknown kids cannot make us hammer the
	// provider.
	defaultRefetchEvery = time.Minute

	usersCollection = "users"
	formMediaType   = "application/x-www-form-urlencoded"
)

// Config configures the endpoint.
type Config struct {
	// Issuer is the provider's issuer URL. Empty disables the endpoint.
	Issuer string
	// HTTPClient fetches the discovery document and the JWKS. Nil uses a
	// client with a 10-second timeout.
	HTTPClient *http.Client
	// Now is the clock. Nil uses time.Now.
	Now func() time.Time
	// RefetchEvery is the least time between key fetches. Zero uses one minute.
	RefetchEvery time.Duration
}

// ConfigFromEnv reads the issuer from OIDC_ISSUER.
func ConfigFromEnv() Config {
	return Config{Issuer: os.Getenv("OIDC_ISSUER")}
}

// Register binds the endpoint when the app serves.
func Register(app core.App, cfg Config) {
	h := newHandler(cfg)
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Every method is routed here so a GET answers 405 instead of falling
		// through to the SPA's index.html.
		for _, m := range []string{
			http.MethodPost, http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete,
		} {
			se.Router.Route(m, Path, h.serve)
		}
		return se.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	})
}

type handler struct {
	issuer string
	now    func() time.Time
	keys   *keySet
	replay *replayCache
}

func newHandler(cfg Config) *handler {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	every := cfg.RefetchEvery
	if every <= 0 {
		every = defaultRefetchEvery
	}
	return &handler{
		issuer: cfg.Issuer,
		now:    now,
		keys:   &keySet{issuer: cfg.Issuer, client: client, every: every},
		replay: newReplayCache(),
	}
}

func (h *handler) serve(e *core.RequestEvent) error {
	e.Response.Header().Set("Cache-Control", "no-store")
	if e.Request.Method != http.MethodPost {
		e.Response.Header().Set("Allow", http.MethodPost)
		return e.NoContent(http.StatusMethodNotAllowed) //nolint:wrapcheck // response write
	}

	users, clientID, ok := h.configured(e.App)
	if !ok {
		return e.NoContent(http.StatusNotFound) //nolint:wrapcheck // response write
	}

	raw, err := readLogoutToken(e.Request, e.Response)
	if err != nil {
		return refuse(e, err)
	}
	now := h.now()
	claims, err := validate(e.Request.Context(), h.keys, raw, h.issuer, clientID, now)
	if err != nil {
		return refuse(e, err)
	}
	if !h.replay.remember(h.issuer+"\x00"+claims.jti, claims.iat.Add(maxAge+clockSkew), now) {
		return refuse(e, errReplayed)
	}

	userID, err := endSessions(e.App, users, claims.sub)
	if err != nil {
		// A storage failure is ours, not the token's: a 5xx tells the
		// provider to retry, where a 400 would make it give up.
		slog.Error("Back-channel logout could not rotate the user's token key", "error", err)
		body := map[string]string{"error": "server_error"}
		return e.JSON(http.StatusInternalServerError, body) //nolint:wrapcheck // response write
	}
	if userID == "" {
		slog.Info("Back-channel logout for a subject with no Kindred user: nothing to sign out")
	} else {
		slog.Info("Back-channel logout signed the user out of every session", "user_id", userID)
	}
	return e.NoContent(http.StatusOK) //nolint:wrapcheck // response write
}

// configured returns the users collection and the oidc client id, or false
// when the endpoint has nothing to validate against.
func (h *handler) configured(app core.App) (*core.Collection, string, bool) {
	if h.issuer == "" {
		slog.Warn("Back-channel logout called but OIDC_ISSUER is not set")
		return nil, "", false
	}
	users, err := app.FindCachedCollectionByNameOrId(usersCollection)
	if err != nil {
		slog.Warn("Back-channel logout called but the users collection is missing", "error", err)
		return nil, "", false
	}
	if users.OAuth2.Enabled {
		for i := range users.OAuth2.Providers {
			if p := &users.OAuth2.Providers[i]; p.Name == auth.NameOIDC && p.ClientId != "" {
				return users, p.ClientId, true
			}
		}
	}
	slog.Warn("Back-channel logout called but the users collection has no oidc provider")
	return nil, "", false
}

// refuse answers 400 with nothing about why; the reason goes to the log only.
func refuse(e *core.RequestEvent, reason error) error {
	slog.Warn("Back-channel logout refused", "reason", reason.Error())
	body := map[string]string{"error": "invalid_request"}
	return e.JSON(http.StatusBadRequest, body) //nolint:wrapcheck // response write
}

// readLogoutToken returns the single logout_token form parameter.
func readLogoutToken(r *http.Request, w http.ResponseWriter) (string, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != formMediaType {
		return "", fmt.Errorf("content type %q is not %s", r.Header.Get("Content-Type"), formMediaType)
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return "", fmt.Errorf("parse form: %w", err)
	}
	tokens := values["logout_token"]
	if len(tokens) != 1 || tokens[0] == "" {
		return "", fmt.Errorf("want exactly one logout_token, got %d", len(tokens))
	}
	return tokens[0], nil
}

// endSessions rotates the tokenKey of the user linked to sub through the oidc
// provider, and returns that user's id, or "" when no user is linked.
//
// The record is re-read inside the transaction, so the save writes back the
// current row rather than a stale copy of cached_permissions or is_admin. It is
// saved without validation because only tokenKey changed: an unrelated column
// that no longer validates must not leave a disabled user signed in. No Kindred
// hook binds model events on users (rbac's guards are request hooks, and so is
// the audit log), so the save recomputes nothing and stamps nothing.
func endSessions(app core.App, users *core.Collection, sub string) (string, error) {
	link, err := app.FindFirstExternalAuthByExpr(dbx.HashExp{
		"collectionRef": users.Id,
		"provider":      auth.NameOIDC,
		"providerId":    sub,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find external auth: %w", err)
	}
	userID := ""
	err = app.RunInTransaction(func(tx core.App) error {
		user, findErr := tx.FindRecordById(users.Id, link.RecordRef())
		if errors.Is(findErr, sql.ErrNoRows) {
			return nil
		}
		if findErr != nil {
			return fmt.Errorf("find user: %w", findErr)
		}
		user.RefreshTokenKey()
		if saveErr := tx.SaveNoValidate(user); saveErr != nil {
			return fmt.Errorf("save user: %w", saveErr)
		}
		userID = user.Id
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("rotate token key: %w", err)
	}
	return userID, nil
}
