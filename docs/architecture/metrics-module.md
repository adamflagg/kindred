# Metrics Module

Analytics dashboard for camp enrollment, retention, and trends. Separate from the bunking/solver pipeline.

## Architecture

```text
Frontend Pages → React Query hooks → FastAPI Router → Domain Services → MetricsRepository → PocketBase
```

**Backend** (`api/`):
- **Router**: `routers/metrics.py` — single router at `/api/metrics` with 10 endpoints
- **Services**: One per metric domain, receive `MetricsRepository` via constructor injection
- **Repository**: `services/metrics_repository.py` — all PocketBase access, returns dicts keyed by `cm_id`
- **Schemas**: `schemas/metrics.py`, `schemas/velocity.py` — Pydantic response models

| Service | Endpoint | Purpose |
|---------|----------|---------|
| `retention_service.py` | `/retention` | Two-year comparison, all demographic breakdowns |
| `registration_service.py` | `/registration` | Single-year enrollment by gender, grade, session, demographics |
| `velocity_service.py` | `/velocity` | Week-over-week enrollment curves with prior year overlay |
| `forecast_service.py` | `/forecast` | Budget goals, capacity, revenue projections |
| `cancellation_service.py` | `/cancellations` | Prior status + re-enrollment analysis |
| `waitlist_service.py` | `/waitlist` | Four-category waitlist analysis |
| `historical_service.py` | `/historical` | Multi-year trends (default 5 years) |
| `retention_trends_service.py` | `/retention-trends` | 3-year retention transitions |
| `drilldown_service.py` | `/drilldown` | Chart click-through to attendee lists |
| `comparison_service.py` | `/comparison` | Year-over-year summary |
| `session_availability_service.py` | (separate router) | Per-session capacity vs enrollment |

**Shared utilities**: `breakdown_calculator.py` (generic retention/registration aggregation), `extractors.py` (demographic field extraction), `session_context.py` / `session_utils.py` (session type filtering)

## Frontend (`frontend/src/pages/metrics/`)

Three sections via `MetricsLayout.tsx` with sticky two-level navigation:

| Section | Pages |
|---------|-------|
| **Registration** | RegistrationOverview, GeoAnalysis, WaitlistAnalysis, SessionAvailability, ForecastPage, CancellationAnalysis |
| **Retention** | RetentionOverview, SessionFlowPage (Sankey), BunkRetentionPage (heatmap), StaffCabinAnalysisPage |
| **Trends** | TrendsOverview (multi-year), VelocityPage, CancellationVelocityPage |

**State management**: `MetricsSessionContext` uses URL search params (`session`, `view`, `compare`) for session filtering across all tabs. View modes: `sessions` (default, camp types), `quests`, `all`.

**Hooks**: `hooks/useMetrics.ts` — one hook per endpoint (`useRetentionMetrics`, `useRegistrationMetrics`, `useVelocity`, etc.). All use React Query with `keepPreviousData` for smooth filter transitions.

**Components**: `components/metrics/` — `MetricCard`, `BreakdownChart`, `RetentionRateBarChart`, `RetentionRateLineChart`, `DrilldownModal`, `ComparisonSummaryTable`, etc.

## Key Data Dependencies

| Metric | Source Tables |
|--------|--------------|
| Retention | `attendees` + `persons` + `bunk_assignments` + `camp_sessions` |
| Registration | `attendees` + `persons` + `bunk_plans` |
| Velocity | `enrollment_snapshots` (fast path) or reconstructed from `attendees.enrollment_date` |
| Waitlist/Cancellations | `attendee_status_history` + `attendees` |
| Forecast | `attendees` + `bunk_plans` + `config` (budget goals, session fees) |

## Metrics-Specific Patterns

- **Parallel fetches**: Services use `asyncio.gather()` for all independent repository calls; repository uses `asyncio.to_thread()` for synchronous PocketBase SDK
- **Batched queries**: Large person ID sets split into `BATCH_SIZE = 100` to avoid oversized PocketBase filter strings
- **Session type constants**: `DISPLAY_SESSION_TYPES` (main, embedded, ag, quest), `BUNK_SESSION_TYPES` (main, embedded, ag — cabin heatmaps only), `SUMMER_PROGRAM_SESSION_TYPES` (counts toward years at camp)
- **Aged-out logic**: Grade >= 10 excluded from retention base (no eligible session to return to)
- **Demographics**: Use normalized fields when available (`normalized_school`, `normalized_city`, `normalized_congregation`), fall back to raw fields
- **AG sessions**: Linked to parent via `parent_id`; metrics for AG fold into parent main session

## Week 0 (Pre-Registration Enrollment)

Week 0 captures enrollments that occur before the registration anchor date (priority_reg_date or early_reg_date). These are typically staff/board early-access registrations.

**How it works:**
- **Week 0 window**: Fixed 7-day period from `anchor - 7 days` to `anchor - 1 day`. All pre-anchor enrollments are bucketed here regardless of how far back they occurred.
- **`day_offset=-1`**: Sentinel value in the forecast API that maps to `week_number=0` via Python floor division: `(-1 // 7) + 1 = 0`.
- **Conditional display**: Week 0 only appears in the forecast dropdown and velocity curves when `has_pre_anchor_enrollments()` returns true for that year.
- **Repository method**: `has_pre_anchor_enrollments(year, anchor_date)` checks attendees using the same date priority as `_get_enrollment_date()` — `effective_date` first, `enrollment_date` only when `effective_date` is empty.
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
