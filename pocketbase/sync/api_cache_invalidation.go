package sync

import (
	"context"
	"log/slog"
	"time"

	"github.com/camp/kindred/pocketbase/fastapi"
)

// defaultRunCompletedNotifyTimeout is how long a finished run waits on runCompletedNotifier
// before it publishes anyway. It sits one second past fastapi.InvalidateTimeout on purpose:
// the HTTP client's own timeout normally ends a wedged call first, with its precise error,
// and this bound is only the backstop for a notifier that ignores it. Either way a down API
// costs a sync at most this long per job, never a hang.
const defaultRunCompletedNotifyTimeout = fastapi.InvalidateTimeout + time.Second

// notifyAPIRunCompleted tells FastAPI that syncType finished, so it clears the server caches
// that job's writes could have made stale (kindred#2803): the metrics response cache, the
// weekend lodging year cache and the social graph cache, each when the job writes a table it
// reads (api/constants/sync_job_writes.py decides which).
//
// Before kindred#2803, only a browser tab that watched a sync finish made that call, so the
// hourly and nightly scheduled syncs -- which nobody watches -- left all three stale until
// their TTLs. The browser still makes it too; a second clear is harmless.
//
// SYNCHRONOUS ON PURPOSE. It used to fire and forget, and the orchestrator published the run
// first -- so a browser that refetches the moment end_time appears could beat the invalidate,
// be served the pre-sync cache, and keep it for its whole staleTime. The orchestrator now
// waits for this call (bounded by notifyRunCompleted) and only then publishes. It is bounded
// twice over: the HTTP client gives up after fastapi.InvalidateTimeout, and a failure costs
// one warning, never the run -- every cache still expires on its own TTL.
func notifyAPIRunCompleted(syncType string) {
	if err := InvalidateAPICaches(syncType); err != nil {
		slog.Warn("Could not ask FastAPI to clear its caches after a sync",
			"syncType", syncType, "url", fastapi.BaseURL(), "error", err)
		return
	}
	slog.Debug("FastAPI caches invalidated after sync", "syncType", syncType)
}

// InvalidateAPICaches asks FastAPI to clear the server caches that writes by syncType could
// have made stale, waits for the answer, and returns any failure for the caller to log. It
// is bounded: the context ends the call at defaultRunCompletedNotifyTimeout even if the HTTP
// client's own InvalidateTimeout does not.
//
// Exported for writers that change a synced table OUTSIDE a sync run -- the lodging hook that
// replays a placement when staff resolve a queue row -- and therefore never reach the
// orchestrator's notifyRunCompleted. They pass the job id that owns the table.
func InvalidateAPICaches(syncType string) error {
	ctx, cancel := context.WithTimeout(context.Background(), defaultRunCompletedNotifyTimeout)
	defer cancel()
	return fastapi.InvalidateCaches(ctx, fastapi.BaseURL(), syncType)
}

// notifyRunCompleted calls runCompletedNotifier and waits for it to return, or for the
// notify timeout, whichever is first. A notifier still running at the timeout is left to
// finish on its own goroutine; the run publishes regardless and the warning says why.
func (o *Orchestrator) notifyRunCompleted(syncType string) {
	if o.runCompletedNotifier == nil {
		return
	}
	timeout := o.runCompletedNotifyTimeout
	if timeout <= 0 {
		timeout = defaultRunCompletedNotifyTimeout
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		o.runCompletedNotifier(syncType)
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		slog.Warn("FastAPI did not confirm its cache clear in time; publishing the run anyway",
			"syncType", syncType, "timeout", timeout)
	}
}
