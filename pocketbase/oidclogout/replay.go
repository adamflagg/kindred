package oidclogout

import (
	"sync"
	"time"
)

// maxRemembered bounds the replay cache. Only tokens that passed signature and
// claim checks are remembered, so only the provider can fill it, and a jti is
// forgotten once its token is too old to pass the age check anyway. Ten
// thousand logouts inside one maxAge window is far past anything real; if it
// is ever reached, new tokens are refused rather than the cache forgetting
// ones that could still be replayed.
const maxRemembered = 10000

// replayCache remembers the jti of every accepted token until it expires.
// In memory is enough: a restart forgets them, but a token replayed after a
// restart can only sign the same user out again, and only in the five minutes
// it is young enough to pass the age check.
type replayCache struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

func newReplayCache() *replayCache {
	return &replayCache{seen: map[string]time.Time{}}
}

// remember records key until `until` and reports whether it was new. It
// returns false for a key already held, and when the cache is full.
func (c *replayCache) remember(key string, until, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if exp, ok := c.seen[key]; ok && now.Before(exp) {
		return false
	}
	if len(c.seen) >= maxRemembered {
		for k, exp := range c.seen {
			if !now.Before(exp) {
				delete(c.seen, k)
			}
		}
		if len(c.seen) >= maxRemembered {
			return false
		}
	}
	c.seen[key] = until
	return true
}
