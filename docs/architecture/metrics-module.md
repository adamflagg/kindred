# Metrics Module

Analytics dashboard for camp enrollment, retention, and trends. Separate from the bunking/solver pipeline.

## Architecture

```text
Frontend Pages → React Query hooks → FastAPI Router → Domain Services → MetricsRepository → PocketBase
```

**Backend** (`api/`):
- **Router**: `routers/metrics.py` — single router at `/api/metrics` with 11 metric endpoints, plus `POST /cache/invalidate` and `GET /cache/stats`
- **Services**: One per metric domain, receive a repository via constructor injection
- **Repository**: `services/metrics_sql_repository.py` (`MetricsSQLRepository`, direct SQLite reads of PocketBase's database) by default; `services/metrics_repository.py` (`MetricsRepository`, the PocketBase HTTP API) when `METRICS_SQL_ENABLED` is not `true` (`_create_repository` in `routers/metrics.py`). Both return objects keyed by `cm_id`
- **Schemas**: `schemas/metrics.py`, `schemas/velocity.py`, `schemas/forecast.py`, `schemas/day1.py` — Pydantic response models

| Service | Endpoint | Purpose |
|---------|----------|---------|
| `retention_service.py` | `/retention` | Two-year comparison, all demographic breakdowns |
| `registration_service.py` | `/registration` | Single-year enrollment by gender, grade, session, demographics |
| `velocity_service.py` | `/velocity` | Week-over-week enrollment curves with prior year overlay |
| `forecast_service.py` | `/forecast`, `/forecast/week-options` | Budget goals, capacity, revenue projections |
| `day1_service.py` | `/registration/day1` | Enrollments on the first two days of each registration tier opening (the opening day and the day after) |
| `cancellation_service.py` | `/cancellations` | Prior status + re-enrollment analysis |
| `waitlist_service.py` | `/waitlist` | Four-category waitlist analysis |
| `historical_service.py` | `/historical` | Multi-year trends (default 5 years) |
| `retention_trends_service.py` | `/retention-trends` | 3-year retention transitions |
| `drilldown_service.py` | `/drilldown` | Chart click-through to attendee lists |
| `session_availability_service.py` | (separate router) | Per-session capacity vs enrollment |

**Shared utilities**: `breakdown_calculator.py` (generic retention/registration aggregation), `extractors.py` (demographic field extraction), `session_context.py` / `session_utils.py` (session type filtering), and `api/utils/session_metrics.py`, the one session resolver every metric uses (#3210): session-type constants, the summer teen window, AG parent folding, and `match_session_in_year` / `resolve_scope_ids` for a session renamed between years

## Frontend (`frontend/src/pages/metrics/`)

Three sections via `MetricsLayout.tsx` with sticky two-level navigation. Above every page the layout shows a scope line saying what the page counts (`scopeLine.ts`) and a freshness chip (`AnalyticsFreshness`, `useAnalyticsFreshness`). A season with no enrollment rows yet (`useSeasonHasRows`) shows one line instead of the page (`SeasonEmptyState`, e.g. "No enrollments yet for 2027 — view 2026"), #3219:

| Section | Pages |
|---------|-------|
| **Registration** | RegistrationOverview, GeoAnalysis, WaitlistAnalysis, SessionAvailability, ForecastPage, CancellationAnalysis, Day1Page |
| **Retention** | RetentionOverview, SessionFlowPage (Sankey), BunkRetentionPage (heatmap), StaffCabinAnalysisPage |
| **Trends** | TrendsOverview (multi-year), VelocityPage, CancellationVelocityPage |

**State management**: `MetricsSessionContext` uses URL search params (`session`, `view`, `compare`, `duration`, `teen`, `teen_pipeline`) for session filtering across all tabs. View modes: `sessions` (default, camp types), `quests`, `all`.

**Hooks**: `hooks/useMetrics.ts` — one hook per endpoint (`useRetentionMetrics`, `useRegistrationMetrics`, `useHistoricalTrends`, etc.); velocity has its own (`useVelocity.ts`, `useVelocityChartData.ts`). All use React Query with `keepPreviousData` for smooth filter transitions.

**Components**: `components/metrics/` — `MetricCard`, `BreakdownChart`, `RetentionRateLineChart`, `DrillDownModal`, `ComparisonSummaryTable`, `SessionDetailsTable`, `MetricsQueryGuard`, `AnalyticsFreshness`, `SeasonEmptyState`, etc.

## Key Data Dependencies

| Metric | Source Tables |
|--------|--------------|
| Retention | `attendees` + `persons` + `bunk_assignments` + `camp_sessions` |
| Registration | `attendees` + `persons` + `bunk_plans` |
| Velocity | `enrollment_snapshots` (fast path) or reconstructed from `attendees.enrollment_date` |
| Waitlist/Cancellations | `attendee_status_history` + `attendees` |
| Trends (yearly Cancelled, Cancel %) | `attendees` final status `cancelled`, the same count as Overview (decision 10, #3207); never status history, which starts in 2026 |
| Forecast | `attendees` + `bunk_plans` + `config` (budget goals, session fees) |

## Metrics-Specific Patterns

- **Parallel fetches**: Services use `asyncio.gather()` for all independent repository calls; repository uses `asyncio.to_thread()` for synchronous PocketBase SDK
- **Batched queries**: Large person ID sets split into batches: `BATCH_SIZE = 100` in `MetricsRepository` (PocketBase filter length), `500` in `MetricsSQLRepository` (SQLite parameter limit)
- **Session type constants** (`api/utils/session_metrics.py`): `DISPLAY_SESSION_TYPES` (main, embedded, ag, quest, scit, tli — teens gated to the summer window), `BUNK_SESSION_TYPES` (main, embedded, ag — cabin heatmaps only), `SUMMER_PROGRAM_SESSION_TYPES` (main, embedded, ag, quest — counts toward years at camp). Family Camp (`family`, `family_adult`) is never in summer metrics
- **Aged-out logic**: Grade >= 10 excluded from retention base (no eligible session to return to)
- **Demographics**: Use normalized fields when available (`normalized_school`, `normalized_city`, `normalized_congregation`), fall back to raw fields
- **AG sessions**: Linked to parent via `parent_id`; metrics for AG fold into parent main session
- **Session swaps** (`api/utils/session_swap.py`): a cancelled camper with any enrolled record in the season, no time window (decision 46). Swaps + true departures split the cancelled exactly as still-enrolled / not-enrolled do, on the caller's scope
- **Number formatting** (frontend): every displayed number goes through `utils/numberFormat.ts` (separators, one-decimal percent, U+2212 minus; decision 43). Definitions are numbered notes via the kit's `DefinitionNotes`/`DefRef`, never hover text (decision 11)

## Same Point Last Year (decision 7)

While a season is live, a prior season is compared at **the same registration day**: enrolled at
day N = registered by N (`effective_date`, else `enrollment_date`) and not cancelled by N (a
cancelled or withdrawn record's `enrollment_date`). After the season, prior seasons are compared at
their final. One rule, one place:

- `api/services/same_point.py` `live_same_point(repo, year, today)` — the season's registration day
  while it is live, with the prior-side read day clamped by `same_point_offset` (decision 45: on a
  priority, early or open date the prior is read through the next day). None means "compare with
  finals". **Live ends the day the season's last summer session starts** (PM-8 A, owner 2026-10-25;
  `season_end`): the latest `start_date` among the sessions summer metrics count
  (`DISPLAY_SESSION_TYPES`, SCIT/TLI only inside the summer window, never Family Camp). A season with
  no readable session start dates falls back to `SEASON_WEEKS` weeks from the anchor, and logs it.
  `SEASON_WEEKS` is otherwise only a chart extent (Velocity's x-axis, Forecast's week options, Today's
  Pace curve).
- `same_day_point(repo, year, today)` — the same registration day with no season end: **Today**'s
  rule. Today never compares with last year's final; with no anchor on either season it has no
  comparison and says so (`prior_unavailable_reason`), never a substitute. Today's hero asks
  `/registration?same_point_of=<season>&same_point_all_year=true`, which answers `prior_basis:
  'unavailable'` instead of a final when there is no day to read.
- **Forecast** live mode takes its prior read day (`prior_offset`, already clamped) and
  `prior_basis` from it, and drops the Week-0 lower bound, since a negative day there is a real
  "N days before the anchor". Week mode is always same point.
- **Overview** (`/registration?same_point_of=<season>`): the compare year is read at that day with
  `reconstruction.attendees_at_cutoff`, the record-level form of the rule `_reconstruct_core` counts per
  session, so every breakdown can use it. The response says `prior_basis`, `day_offset`,
  `prior_day_offset` and `as_of_date`. A past waitlist cannot be rebuilt, so `total_waitlisted` is
  None on a same-point read. Cancelled counts the Cancelled status only, as Overview's final does.
- **Geo** reads the same `/registration?same_point_of=` compare as Overview, and says which basis in
  Overview's grammar (`describeGeoCompareBasis`); on the priority date its Change cells read "updates
  tomorrow", as Overview's and Cancellations' deltas do.
- **Cancellations** (`/cancellations?same_point_of=<season>`): cancelled by day N = a cancelled,
  withdrawn or dismissed record whose `enrollment_date` (the date `attendees_at_cutoff` reads "left by
  N" from) is on or before the cutoff; "has other sessions", swaps and departures read who was enrolled
  then (`attendees_at_cutoff`); by session, grade, gender, time to cancel and registration month are
  computed over that set. The status before cancelling and Re-enrolled need status history: they read
  the changes detected by the cutoff only when the year's history starts by its anchor, and are None
  (no comparison, never a final) otherwise. The response carries the same basis fields as Overview.
- **Waitlist** (`/waitlist?same_point_of=<season>`): a past waitlist can't be rebuilt for a day, so
  while the season is live the answer is `prior_basis: 'unavailable'` and the tab shows no comparison;
  after it, or for a season with no registration anchor, `'final'`. Overview's Total Waitlisted keeps
  its own "no compare".
- **Velocity** compares each prior line at `same_point_offset(current_day_offset)`. Its TODAY line
  and live point (`today_day_offset`) end on the same day the comparison does, the day the last
  summer session starts (`same_point.season_end`), not `SEASON_WEEKS` after the anchor.

**Two bases (K13).** Velocity's current season reads the nightly `enrollment_snapshots` from the
first snapshot on (main, embedded and AG sessions only); everything else is rebuilt: every season
before the first snapshot (`snapshots_start` on the response, 2026-03-02 in prod), the weeks before
a season's first snapshot, and Quests and teen programs always. Each point says which in
`data_source`; the page labels the lines with a numbered note when the lines on screen do not share
one basis (`components/velocity/velocityBases.ts`). Overview's same-point compare is the same mix:
this season's live count against a rebuilt prior, and its note says so.

## Week 0 (Pre-Registration Enrollment)

Week 0 captures enrollments that occur before the registration anchor date (priority_reg_date or early_reg_date). These are typically staff/board early-access registrations.

**How it works:**
- **Week 0 window**: Fixed 7-day period from `anchor - 7 days` to `anchor - 1 day`. All pre-anchor enrollments are bucketed here regardless of how far back they occurred.
- **`day_offset=-1`**: Sentinel value in the forecast API that maps to `week_number=0` via Python floor division: `(-1 // 7) + 1 = 0`.
- **Conditional display**: Week 0 only appears in the forecast dropdown and velocity curves when `has_pre_anchor_enrollments()` returns true for that year.
- **Repository method**: `has_pre_anchor_enrollments(year, anchor_date)` checks attendees using the same date priority as `get_enrollment_date()` (`reconstruction.py`) — `effective_date` first, `enrollment_date` only when `effective_date` is empty.
- **Reconstruction**: `_reconstruct_core` uses a lower bound of `anchor - 7 days` for negative offsets. `reconstruct_daily_multi` and `_build_daily_points` accept a `week0` flag to emit 7 days of negative-offset data.

**Key functions:**
- `_week_number()` / `_week_start()` in `velocity_service.py` — return 0 / `anchor - 7d` for pre-anchor dates
- `format_week_date_range()` in `camp_calendar.py` — handles `week_num=0` as a special case
- `get_week_options()` in `forecast_service.py` — appends Week 0 at the bottom of the dropdown when pre-anchor data exists

## Adding a New Metric

1. Add Pydantic response model in `api/schemas/metrics.py`
2. Create service in `api/services/` following existing pattern (constructor takes `MetricsRepository`)
3. Add endpoint in `api/routers/metrics.py` with standard query params (`year`, `session_types`, `session_cm_id`)
4. Add React Query hook in `frontend/src/hooks/useMetrics.ts`
5. Create page in appropriate `frontend/src/pages/metrics/` subsection
6. Register in `metricsNav.ts` for navigation
7. Service tests: mock `MetricsRepository` with `AsyncMock`
