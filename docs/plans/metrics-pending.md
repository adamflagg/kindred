# Metrics Pending

Living document tracking known metrics gaps relative to the camp staff registration analysis spec. Updated as items are resolved.

## Gap Tracker

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 1 | Velocity gender: gross/net toggle | Fixed | Snapshot cancelled counts now extracted per gender |
| 2 | Velocity gender: delta view | Fixed | Gender split rendering added to delta chart |
| 3 | Referral source breakdown | Blocked | No referral data field exists in CampMinder schema — needs CampMinder support |
| 4 | Target vs actual capacity labels | Deferred | `participant_goal` (Budget Config) and `capacity_override` (Session Availability Config) serve different purposes. `capacity_override` is a session total (not per-cabin), split evenly by gender. Awaiting staff input on whether to unify or keep separate. |
| 5 | Forecast historical lookback | In Progress | Add date selector to view forecast enrollment as of a past snapshot date |
| 6 | Family camp metrics / session conversion | Not Planned | Family camp sessions excluded from metrics module. Cannot yet track family camp → 1-week → 2-week → 3-week conversion. |
| 7 | Google Sheets formula dashboard | Superseded | Interactive web dashboard built instead. Raw data export to Sheets exists via sync. |
| 8 | Velocity reconstruction warnings | Fixed | Banner removed to prevent page layout jumping |
| 9 | Registration at-this-date comparison (Becca item C) | Partial | Velocity overlays show prior year curves aligned by week. Forecast lookback (#5) will add point-in-time comparison. |

## What's Complete

All items from the original spec are implemented in the web dashboard:

**Retention:** By gender, grade, session, session+bunk, years at camp, first year, city, school, synagogue, session flow (Sankey), staff cabin analysis

**Registration:** By gender (total, per grade, per session), grade, years at camp, new vs returning, first year, city, school, synagogue, session length (1/2/3-week)

**Additional (beyond original spec):** Waitlist analysis (4 use cases), cancellation analysis (prior status, timing, session swaps), session availability grid, enrollment forecast with revenue, velocity curves with prior year overlay, geographic map, drilldown to individual campers, historical trends, retention trends
