/**
 * A closed season (CLOSED-SEASONS-DONE, owner ruling CSD-7 = a): older than the prior season N-1 of the configured
 * season N, so 2025 and older while 2027 is the season, and 2026 too once 2028 is. The prior season stays open for
 * programs still running after the Oct 15 rollover.
 *
 * The server owns the rule (api/services/aid_season_state.py `is_season_done`, the same as the sync's
 * `isClosedSeasonFor` in pocketbase/sync/year.go) and every Camperships read carries its answer as `season_done`;
 * Camperships gates its clicks on that, never on this. This copy draws one thing: the season picker's lock mark
 * (CSD-3), which has no read of its own to ask. `configured` 0 or undefined (not known yet) marks nothing.
 */
export function isClosedSeason(year: number, configured: number | undefined): boolean {
  if (!configured) return false
  return year < configured - 1
}
