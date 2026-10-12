package oidclogout

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// keysMaxAge is how long fetched keys are trusted before the next token
	// triggers a refetch, so a key the provider withdraws stops verifying.
	keysMaxAge = time.Hour
	// maxDocument caps the discovery document and the JWKS.
	maxDocument = 1 << 20
	// minRSABits refuses RSA keys too short to trust.
	minRSABits = 2048
)

var (
	errUnknownKey  = errors.New("no provider key matches the token's kid")
	errKeyAlg      = errors.New("the key's alg does not match the token's")
	errKeyMismatch = errors.New("the key's type does not suit the token's alg")
)

// publicKey is one verification key from the provider's JWKS.
type publicKey struct {
	alg string // the JWK's alg, "" when it did not say
	key any    // *rsa.PublicKey, *ecdsa.PublicKey or ed25519.PublicKey
}

// keySet caches the provider's signing keys. Fetches run one at a time, spaced
// at least `every` apart, whatever the trigger: the first token, an unknown
// kid, or keys older than keysMaxAge.
type keySet struct {
	issuer string
	client *http.Client
	every  time.Duration

	mu        sync.Mutex
	keys      map[string]publicKey
	fetchedAt time.Time // last successful fetch
	triedAt   time.Time // last attempt, successful or not
}

// key returns the key with kid for a token signed with alg. An empty kid
// matches only when the provider publishes exactly one key.
func (s *keySet) key(ctx context.Context, kid, alg string, now time.Time) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	k, ok := s.find(kid)
	stale := now.Sub(s.fetchedAt) > keysMaxAge
	if (!ok || stale) && (s.triedAt.IsZero() || now.Sub(s.triedAt) >= s.every) {
		s.triedAt = now
		// Detached from the caller's cancellation: this attempt closes the
		// fetch window for everyone, so a caller who hangs up mid-fetch must
		// not be able to abort it and leave the keys unfetched for a minute.
		// The HTTP client's timeout still bounds it.
		if err := s.refresh(context.WithoutCancel(ctx), now); err != nil {
			// Keep serving the keys already held: an unreachable provider is
			// no reason to stop trusting keys it published.
			slog.Warn("Back-channel logout could not fetch the provider's keys", "error", err)
		}
		k, ok = s.find(kid)
	}
	if !ok {
		return nil, errUnknownKey
	}
	if k.alg != "" && k.alg != alg {
		return nil, errKeyAlg
	}
	if !suits(k.key, alg) {
		return nil, errKeyMismatch
	}
	return k.key, nil
}

func (s *keySet) find(kid string) (publicKey, bool) {
	if kid == "" {
		if len(s.keys) == 1 {
			for _, k := range s.keys {
				return k, true
			}
		}
		return publicKey{}, false
	}
	k, ok := s.keys[kid]
	return k, ok
}

// suits reports whether key is the right type for alg.
func suits(key any, alg string) bool {
	switch key.(type) {
	case *rsa.PublicKey:
		return strings.HasPrefix(alg, "RS") || strings.HasPrefix(alg, "PS")
	case *ecdsa.PublicKey:
		return strings.HasPrefix(alg, "ES")
	case ed25519.PublicKey:
		return alg == "EdDSA"
	}
	return false
}

// refresh fetches the discovery document, checks it names our issuer, and
// replaces the cached keys with its JWKS.
func (s *keySet) refresh(ctx context.Context, now time.Time) error {
	var discovery struct {
		Issuer  string `json:"issuer"`
		JWKSURI string `json:"jwks_uri"`
	}
	discoveryURL := strings.TrimSuffix(s.issuer, "/") + "/.well-known/openid-configuration"
	if err := s.getJSON(ctx, discoveryURL, &discovery); err != nil {
		return fmt.Errorf("discovery: %w", err)
	}
	if !sameIssuer(discovery.Issuer, s.issuer) {
		return fmt.Errorf("discovery names issuer %q, want %q", discovery.Issuer, s.issuer)
	}
	if discovery.JWKSURI == "" {
		return errors.New("discovery has no jwks_uri")
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := s.getJSON(ctx, discovery.JWKSURI, &set); err != nil {
		return fmt.Errorf("jwks: %w", err)
	}
	keys := make(map[string]publicKey, len(set.Keys))
	for i := range set.Keys {
		j := &set.Keys[i]
		k, err := j.publicKey()
		if err != nil {
			slog.Warn("Back-channel logout skipped a provider key", "kid", j.Kid, "error", err)
			continue
		}
		keys[j.Kid] = k
	}
	s.keys, s.fetchedAt = keys, now
	return nil
}

func (s *keySet) getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	res, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("get: %w", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxDocument)).Decode(v); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}

// jwk is the subset of RFC 7517/7518/8037 fields the supported keys use.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	N   string `json:"n"`
	E   string `json:"e"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

func (j *jwk) publicKey() (publicKey, error) {
	if j.Use != "" && j.Use != "sig" {
		return publicKey{}, fmt.Errorf("use %q is not sig", j.Use)
	}
	var (
		key any
		err error
	)
	switch j.Kty {
	case "RSA":
		key, err = j.rsa()
	case "EC":
		key, err = j.ec()
	case "OKP":
		key, err = j.ed25519()
	default:
		err = fmt.Errorf("unsupported kty %q", j.Kty)
	}
	if err != nil {
		return publicKey{}, err
	}
	return publicKey{alg: j.Alg, key: key}, nil
}

func (j *jwk) rsa() (*rsa.PublicKey, error) {
	n, err := b64(j.N)
	if err != nil {
		return nil, fmt.Errorf("n: %w", err)
	}
	e, err := b64(j.E)
	if err != nil {
		return nil, fmt.Errorf("e: %w", err)
	}
	pub := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	if pub.N.BitLen() < minRSABits || pub.E < 3 {
		return nil, fmt.Errorf("RSA key too weak (%d bits, e=%d)", pub.N.BitLen(), pub.E)
	}
	return pub, nil
}

func (j *jwk) ec() (*ecdsa.PublicKey, error) {
	var curve elliptic.Curve
	switch j.Crv {
	case "P-256":
		curve = elliptic.P256()
	case "P-384":
		curve = elliptic.P384()
	case "P-521":
		curve = elliptic.P521()
	default:
		return nil, fmt.Errorf("unsupported crv %q", j.Crv)
	}
	x, err := b64(j.X)
	if err != nil {
		return nil, fmt.Errorf("x: %w", err)
	}
	y, err := b64(j.Y)
	if err != nil {
		return nil, fmt.Errorf("y: %w", err)
	}
	size := (curve.Params().BitSize + 7) / 8
	if len(x) != size || len(y) != size {
		return nil, errors.New("coordinates have the wrong length")
	}
	// ParseUncompressedPublicKey rejects a point that is not on the curve.
	pub, err := ecdsa.ParseUncompressedPublicKey(curve, append(append([]byte{4}, x...), y...))
	if err != nil {
		return nil, fmt.Errorf("parse EC key: %w", err)
	}
	return pub, nil
}

func (j *jwk) ed25519() (ed25519.PublicKey, error) {
	if j.Crv != "Ed25519" {
		return nil, fmt.Errorf("unsupported crv %q", j.Crv)
	}
	x, err := b64(j.X)
	if err != nil {
		return nil, fmt.Errorf("x: %w", err)
	}
	if len(x) != ed25519.PublicKeySize {
		return nil, errors.New("Ed25519 key has the wrong length")
	}
	return ed25519.PublicKey(x), nil
}

func b64(s string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		return nil, fmt.Errorf("base64url: %w", err)
	}
	return b, nil
}
