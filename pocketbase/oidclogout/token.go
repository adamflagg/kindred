package oidclogout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// logoutEvent is the member of the events claim that marks a logout token.
const logoutEvent = "http://schemas.openid.net/event/backchannel-logout"

const (
	// clockSkew is the leeway between our clock and the provider's.
	clockSkew = time.Minute
	// maxAge is how old a token's iat may be. The provider mints a fresh token
	// for every delivery attempt, valid for two minutes, so five minutes covers
	// delivery delay with room for skew. It also bounds the replay cache: a
	// token older than this is refused anyway, so its jti need not be kept.
	maxAge = 5 * time.Minute
)

// signingAlgs are the asymmetric algorithms a provider may sign with. "none"
// and the HMAC family are absent, so the parser refuses them before any key is
// looked up.
var signingAlgs = []string{
	"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA",
}

var (
	errIssuer    = errors.New("iss is not the configured issuer")
	errNoIat     = errors.New("iat missing")
	errTooOld    = errors.New("iat older than the allowed age")
	errNoEvent   = errors.New("events claim lacks the back-channel logout event")
	errNonce     = errors.New("nonce present (logout tokens must not carry one)")
	errNoJTI     = errors.New("jti missing")
	errNoSubject = errors.New("neither sub nor sid present")
	errSidOnly   = errors.New("sid without sub: sessions are not tracked by sid")
	errReplayed  = errors.New("jti already used")
)

// logoutClaims are the validated claims the handler acts on.
type logoutClaims struct {
	sub string
	jti string
	iat time.Time
}

// validate verifies raw's signature against the provider's keys and its claims
// against section 2.6 of the spec, and returns the claims to act on.
func validate(ctx context.Context, keys *keySet, raw, issuer, clientID string, now time.Time) (logoutClaims, error) {
	claims := jwt.MapClaims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods(signingAlgs),
		jwt.WithAudience(clientID),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(clockSkew),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	_, err := parser.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return keys.key(ctx, kid, t.Method.Alg(), now)
	})
	if err != nil {
		return logoutClaims{}, fmt.Errorf("verify: %w", err)
	}
	return checkLogoutClaims(claims, issuer, now)
}

// checkLogoutClaims checks what the JWT parser does not: the issuer, the
// presence and age of iat, the events claim, no nonce, a jti and a subject.
func checkLogoutClaims(claims jwt.MapClaims, issuer string, now time.Time) (logoutClaims, error) {
	if iss, _ := claims["iss"].(string); !sameIssuer(iss, issuer) {
		return logoutClaims{}, errIssuer
	}
	iat, err := claims.GetIssuedAt()
	if err != nil || iat == nil {
		return logoutClaims{}, errNoIat
	}
	if now.Sub(iat.Time) > maxAge {
		return logoutClaims{}, errTooOld
	}
	events, _ := claims["events"].(map[string]any)
	if _, ok := events[logoutEvent].(map[string]any); !ok {
		return logoutClaims{}, errNoEvent
	}
	if _, ok := claims["nonce"]; ok {
		return logoutClaims{}, errNonce
	}
	jti, _ := claims["jti"].(string)
	if jti == "" {
		return logoutClaims{}, errNoJTI
	}
	sub, _ := claims["sub"].(string)
	sid, _ := claims["sid"].(string)
	switch {
	case sub == "" && sid == "":
		return logoutClaims{}, errNoSubject
	case sub == "":
		// Kindred's sessions are PocketBase tokens, which carry no provider
		// sid, so a sid-only token names nothing we can end. The provider
		// this is built for always sends sub and never sid.
		return logoutClaims{}, errSidOnly
	}
	return logoutClaims{sub: sub, jti: jti, iat: iat.Time}, nil
}

// sameIssuer compares issuer URLs, ignoring a trailing slash on either side so
// that OIDC_ISSUER written with one still matches.
func sameIssuer(a, b string) bool {
	return a != "" && strings.TrimSuffix(a, "/") == strings.TrimSuffix(b, "/")
}
