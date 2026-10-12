// Package oidclogouttest is a fake OpenID provider for the back-channel logout
// tests: an httptest server serving a discovery document and a JWKS, and a
// minter for logout tokens signed with its keys. Both oidclogout's own tests and
// rbac's booted test use it, which is why it is not a _test.go file.
package oidclogouttest

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ClientID is the fictional client id every test configures on the users
// collection's oidc provider.
const ClientID = "kindred-test-client"

// LogoutEvent is the member of the events claim that marks a logout token.
const LogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

// Key is one signing key the fake provider can publish and sign with.
type Key struct {
	KID    string
	Alg    jwt.SigningMethod
	Signer crypto.Signer
}

// NewRSAKey returns an RS256 key with the given kid.
func NewRSAKey(t testing.TB, kid string) Key {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return Key{KID: kid, Alg: jwt.SigningMethodRS256, Signer: k}
}

// NewECKey returns an ES256 key with the given kid.
func NewECKey(t testing.TB, kid string) Key {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}
	return Key{KID: kid, Alg: jwt.SigningMethodES256, Signer: k}
}

// NewEd25519Key returns an EdDSA key with the given kid.
func NewEd25519Key(t testing.TB, kid string) Key {
	t.Helper()
	_, k, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate Ed25519 key: %v", err)
	}
	return Key{KID: kid, Alg: jwt.SigningMethodEdDSA, Signer: k}
}

// Provider is a fake OpenID provider. Issuer is its server URL.
type Provider struct {
	Server *httptest.Server
	Issuer string

	mu              sync.Mutex
	published       []Key
	discoveryIssuer string
	jwksHits        atomic.Int32
}

// New starts a fake provider publishing one RS256 key with kid "key-1".
func New(t testing.TB) *Provider {
	t.Helper()
	return NewWithKeys(t, NewRSAKey(t, "key-1"))
}

// NewWithKeys starts a fake provider publishing the given keys. The first one
// is what Mint signs with.
func NewWithKeys(t testing.TB, keys ...Key) *Provider {
	t.Helper()
	p := &Provider{published: keys}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		p.mu.Lock()
		issuer := p.Issuer
		if p.discoveryIssuer != "" {
			issuer = p.discoveryIssuer
		}
		p.mu.Unlock()
		writeJSON(w, map[string]any{
			"issuer":                               issuer,
			"jwks_uri":                             p.Issuer + "/.well-known/jwks.json",
			"backchannel_logout_supported":         true,
			"backchannel_logout_session_supported": false,
		})
	})
	mux.HandleFunc("GET /.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		p.jwksHits.Add(1)
		p.mu.Lock()
		keys := make([]map[string]string, 0, len(p.published))
		for _, k := range p.published {
			keys = append(keys, publicJWK(t, k))
		}
		p.mu.Unlock()
		writeJSON(w, map[string]any{"keys": keys})
	})
	p.Server = httptest.NewServer(mux)
	p.Issuer = p.Server.URL
	t.Cleanup(p.Server.Close)
	return p
}

// Publish adds a key to the JWKS, as a key rotation would.
func (p *Provider) Publish(k Key) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.published = append(p.published, k)
}

// SetDiscoveryIssuer makes the discovery document name another issuer, as a
// misconfigured or impostor provider would.
func (p *Provider) SetDiscoveryIssuer(issuer string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.discoveryIssuer = issuer
}

// SigningKey is the key Mint signs with.
func (p *Provider) SigningKey() Key {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.published[0]
}

// JWKSFetches is how many times the JWKS has been fetched.
func (p *Provider) JWKSFetches() int { return int(p.jwksHits.Load()) }

// Claims returns a valid logout token's claims for sub, issued at now.
func (p *Provider) Claims(sub string, now time.Time) jwt.MapClaims {
	return jwt.MapClaims{
		"iss":    p.Issuer,
		"aud":    []string{ClientID},
		"sub":    sub,
		"iat":    now.Unix(),
		"exp":    now.Add(2 * time.Minute).Unix(),
		"jti":    rand.Text(),
		"events": map[string]any{LogoutEvent: map[string]any{}},
	}
}

// Mint signs claims with the provider's first key, typed logout+jwt.
func (p *Provider) Mint(t testing.TB, claims jwt.MapClaims) string {
	t.Helper()
	p.mu.Lock()
	k := p.published[0]
	p.mu.Unlock()
	return Sign(t, k, claims)
}

// Sign signs claims with k, typed logout+jwt and carrying k's kid.
func Sign(t testing.TB, k Key, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(k.Alg, claims)
	tok.Header["typ"] = "logout+jwt"
	tok.Header["kid"] = k.KID
	s, err := tok.SignedString(k.Signer)
	if err != nil {
		t.Fatalf("sign logout token: %v", err)
	}
	return s
}

func publicJWK(t testing.TB, k Key) map[string]string {
	t.Helper()
	enc := base64.RawURLEncoding.EncodeToString
	jwk := map[string]string{"kid": k.KID, "alg": k.Alg.Alg(), "use": "sig"}
	switch pub := k.Signer.Public().(type) {
	case *rsa.PublicKey:
		jwk["kty"] = "RSA"
		jwk["n"] = enc(pub.N.Bytes())
		jwk["e"] = enc(big.NewInt(int64(pub.E)).Bytes())
	case *ecdsa.PublicKey:
		raw, err := pub.Bytes() // uncompressed point: 0x04 || X || Y
		if err != nil {
			t.Fatalf("encode EC key: %v", err)
		}
		size := (len(raw) - 1) / 2
		jwk["kty"] = "EC"
		jwk["crv"] = pub.Curve.Params().Name
		jwk["x"] = enc(raw[1 : 1+size])
		jwk["y"] = enc(raw[1+size:])
	case ed25519.PublicKey:
		jwk["kty"] = "OKP"
		jwk["crv"] = "Ed25519"
		jwk["x"] = enc(pub)
	default:
		t.Fatalf("unsupported key type %T", pub)
	}
	return jwk
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
