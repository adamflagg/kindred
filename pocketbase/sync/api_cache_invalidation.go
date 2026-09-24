package sync

import (
	"context"
	"log/slog"

	"github.com/camp/kindred/pocketbase/fastapi"
)

// notifyAPIRunCompleted tells FastAPI that syncType finished, so it clears the server caches
// that job's writes could have made stale (kindred#2803): the metrics response cache always,
// the weekend lodging year cache and the social graph cache when the job writes a table they
// read (api/constants/sync_job_writes.py decides which).
//
// Before this, only a browser tab that watched a sync finish made that call, so the hourly and
// nightly scheduled syncs -- which nobody watches -- left all three stale until their TTLs.
// The browser still makes it too; a second clear is harmless.
//
// Fire-and-forget on its own goroutine: a down or wedged API costs one log line and never
// delays the next job in the queue, let alone fails this one. Every cache still expires on its
// own TTL, which is the bound this call improves on rather than replaces.
func notifyAPIRunCompleted(syncType string) {
	go func() {
		baseURL := fastapi.BaseURL()
		if err := fastapi.InvalidateCaches(context.Background(), baseURL, syncType); err != nil {
			slog.Warn("Could not ask FastAPI to clear its caches after a sync",
				"syncType", syncType, "url", baseURL, "error", err)
			return
		}
		slog.Debug("FastAPI caches invalidated after sync", "syncType", syncType)
	}()
}
