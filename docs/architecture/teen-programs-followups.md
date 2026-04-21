# Teen Programs Metrics — Follow-Up Work

Gaps and deferred scope from the initial Teen Programs forecast feature (PR #970).
Each item can ship independently — listed roughly by impact.

## 1. Retention toggle for teen programs

**What:** Add a UI checkbox on the retention page (similar to the existing 3/5-year trend toggle) that includes SCIT/TLI attendance when calculating returner cohorts. When toggled on, a rising 10th grader who returns as TLI the next year counts as "retained" rather than "did not return".

**Why:** Real data shows 50–86% of TLI attendees return as SCIT the following year, and a meaningful slice of rising 10th graders come back as TLI. Today they appear as "did not return" in retention charts, understating true camper retention.

**Backend ready:** `api/utils/session_metrics.py::SUMMER_PROGRAM_WITH_TEENS_TYPES` is defined as the teen-inclusive superset. Retention service currently uses the narrower `SUMMER_PROGRAM_SESSION_TYPES`.

**Work:**
- Add `include_teen_retention: bool` query param to retention endpoints
- Branch `retention_service` to use `SUMMER_PROGRAM_WITH_TEENS_TYPES` when the flag is set
- Add frontend toggle in the retention page header
- Update 4 retention tests in `test_retention_aged_out.py` to cover both modes

## 2. Teen reconstruction mode (historical week-by-week)

**What:** `/forecast?day_offset=N` currently skips teen rows entirely in reconstruction mode. Teens don't appear in any historical "Week N" view.

**Why:** Staff can't compare 2025-at-this-point-in-registration vs 2026-at-this-point-in-registration for teens. All other programs have this view.

**Work:**
- Extend `_build_teen_row` to accept a reconstruction map
- Add enrollment snapshot loading for teen sessions in `reconstruction.py`
- Add tests covering `day_offset` mode with teen session_types

## 3. Gender split on teen forecast rows

**What:** SCIT and TLI rows display `null` for `enrolled_boys` / `enrolled_girls` even though the underlying CampMinder data has gender.

**Why:** Grand total aggregation works without it (the `has_gender` flag is any-session-based), but teen rows individually lack the breakdown that main/AG rows have.

**Work:**
- In `_build_teen_row`, accumulate boys/girls counts from `_count_attendees_with_gender_for_session` instead of discarding them
- Update teen tests to assert gender counts
- (~15 lines total)

## 4. Drill-down from SCIT to CIT / SIT individually

**What:** In the forecast page, clicking "SCIT" could expand to show CIT enrollment and SIT enrollment as separate sub-rows. Similarly, the session filter dropdown could let staff narrow to "CIT only" or "SIT only".

**Why:** SCIT combines two distinct CampMinder sessions. Staff may want to see "we have 28 CIT and 15 SIT" not just "SCIT: 43". The aggregated row serves the high-level view; drill-down serves operational detail.

**Work:**
- Forecast service: emit aggregated row + optional per-underlying-session rows (behind a query param)
- Frontend: click-to-expand UX on teen rows
- Session dropdown: add CIT / SIT / TLI as selectable entries under a "Teen Programs" group

## 5. Intra-teen retention stats

**What:** A dedicated view (or section on the retention page) showing teen-to-teen transitions: "2024 TLI → 2025 SCIT", "2024 SCIT → 2025 (aged out)", etc.

**Why:** Camp has strong signals here that today live only in ad-hoc queries. Real data shows 50–86% TLI→SCIT retention; very few people do SCIT twice or return to main camp post-teen.

**Work:**
- Backend: new retention endpoint or augment existing one with a teen-cross-program flow breakdown
- Frontend: new chart or table in the retention page
- Should respect the grade alignment (TLI=rising 11th, SCIT=rising 12th) but measure person-level transitions, not grade assumptions

## 6. Automate historical migration

**What:** The `scripts/migrate_teen_session_types.py` script must be run manually once per environment. Could be wrapped into a deploy-time hook or one-shot sync endpoint.

**Why:** Small operational burden; running in the wrong order (sync before migration) could temporarily produce rejected session writes in an environment that hadn't had the PB enum migration yet.

**Work:**
- Either wire the migration into `scripts/start_dev.sh` + container init, or
- Convert to a PocketBase JS migration (would run automatically on PB startup)
- Low priority — idempotency + `--dry-run` make manual runs safe

## 7. Consider `Teen Interns` and `Teen L.A. Trip`

**What:** Programs with `session_type='teen'` (or `'other'`) exist for year-round teen programs (Tawonga Teen Interns, Teen L.A. Trip). They're currently excluded from the forecast page.

**Why:** Low signal — they're small, year-round, and not part of the summer enrollment/revenue cycle. But if staff ever want them tracked, they'd follow the same pattern as SCIT/TLI (new session_type, new `type_*` config key).

**Work:** Only if staff request it. Not blocking.

## 8. Configurable session count per teen program

**What:** SCIT is hardcoded to aggregate CIT + SIT via `session_type='scit'` classification in Go sync. If the camp ever adds a third CIT-like program, the collapse-to-one-row behavior may or may not be desired.

**Why:** Future-proofing. Today the camp's structure is stable (1 CIT + 1 SIT per year, both under `'scit'`). If new teen programs emerge, we'd need to decide per-program whether to collapse or keep separate.

**Work:** Only if structure changes. Architectural note more than action item.
