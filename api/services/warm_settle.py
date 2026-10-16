"""The settle a sync-triggered background warm waits out before it reads (kindred#3199).

A sync RUN finishes several jobs a few seconds apart, and each finished job clears the caches its writes touch
(invalidate_server_caches). A job that writes persons, attendees or sessions clears the Camperships season and the
weekend lodging cache, and asks for a background warm of each. Warming at once meant every clear but the run's last
threw away the warm the previous one had started (the caches' generation guards), so the warm ran over and over for
the run's whole length: on the #3199 bench (prod snapshot, two pinned cores) one clear's warms cost ~17 CPU-s and
124 PocketBase reads, and a simulated hourly run of six such clears in ~50 s cost ~57 CPU-s and ~410 reads.

A sync-triggered warm therefore settles: it starts once no further sync clear has asked for one for
SYNC_WARM_SETTLE_SECONDS, and runs once. The CLEAR is never delayed, so any read after it rebuilds from PocketBase
exactly as before (single-flight, and it is the build the warm then finds cached); only the prefill moves. A warm
asked for without a settle -- a Camperships staff write, whose warm records grant placements first, or a Jotform
admin change -- starts at once and cuts short any settle in progress.

Loop-agnostic on purpose: it keeps a time.monotonic() deadline and polls it, rather than holding an asyncio
primitive bound to one event loop (each pytest test runs its own)."""

from __future__ import annotations

import asyncio
import time
from typing import Final

# The gap between two clears inside one sync run is a job's own run time plus the orchestrator's 2-s job spacing
# (pocketbase/sync/orchestrator.go, jobSpacing). Of the jobs an hourly enrollment run would carry, persons is the
# longest: 13-22 s in production's daily runs (sync_runs, Oct 1-14 2026). 30 s covers it with room, and is short
# enough that a run's last clear is warmed well inside a minute. A longer job (the daily custom-values pass, minutes)
# simply gets a warm in its gap, as it does today.
SYNC_WARM_SETTLE_SECONDS: Final = 30.0

# How often a settling warm rechecks its deadline: the most an immediate ask waits for a settle to notice it.
_POLL_SECONDS: Final = 0.01


class SettleDeadline:
    """When a settling warm may start. One per warm scheduler; touched only from its event loop."""

    def __init__(self) -> None:
        self._deadline = 0.0
        self.settling = False

    def ask(self, settle: float) -> None:
        """A warm was asked for: with a settle, push the start back to `settle` seconds from now (never earlier
        than an earlier ask's); without one, start now, cutting short any settle in progress."""
        now = time.monotonic()
        self._deadline = max(self._deadline, now + settle) if settle > 0 else now

    async def wait(self) -> None:
        """Return once the deadline has passed. `settling` is True meanwhile: an ask that lands then only moves the
        deadline, and needs no rerun, because the warm has not read anything yet."""
        self.settling = True
        try:
            while (left := self._deadline - time.monotonic()) > 0:
                await asyncio.sleep(min(left, _POLL_SECONDS))
        finally:
            self.settling = False
