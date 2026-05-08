# Solver Config Decisions

Working planning artifact for the multi-phase solver/admin config cleanup. Companion to `docs/reference/issue-triage.md`. Lives parallel to it (both are reference-tier working docs that survive across conversations).

## For fresh agents

If you arrived here cold (e.g., user invoked the `solver-config-it` skill or pointed you at this file):

1. **Read this entire file before doing anything.** Especially the "Status", "Approach", and the "Cross-cutting findings" section — those apply to every domain.
2. **Then read the spec/plan for full context:**
   - Spec: `docs/superpowers/specs/2026-05-07-solver-config-cleanup-design.md`
   - Plan: `docs/superpowers/plans/2026-05-07-solver-config-cleanup.md`
   - Original prompt for this Phase 1.5 re-baseline: GitHub issue #1218.
3. **Pick a domain from the backlog below.** Default: whichever the user names. If they don't, default to the first `[ ]` item.
4. **For the chosen domain, walk all four surfaces** (CONFIG_SCHEMA, seed migration, GUI, code reads — Python and frontend). Reference the existing Cabin Capacity section as a template for what depth of detail to capture.
5. **Propose per-key decisions** (KEEP / HARDCODE / DELETE / FIX) with brief rationale. **HOLD for the user's gut-check** before drafting any PR. The user's pattern is to validate one domain's decisions, then green-light the implementation, then move to the next domain.
6. **Update this file with decisions as they're made.** Mark domain checkboxes ✅ when decisions are locked in. Add cross-cutting findings to the "Cross-cutting findings" section as they surface.
7. **Don't run ahead.** Don't write Phase 2 PRs until the user explicitly approves the domain's decisions. Don't conflate domains. Don't propose Phase 3 (storage split) work — that's explicitly out of scope.

## Status

- **Phase 1 shipped:** PRs #1212, #1213, #1214, #1215.
- **Phase 1 deferred:** Workstreams 5 (manifest pattern + scoped hooks) and 6 (runtime metadata enrichment + backfill) — both filed as part of the original 6-PR plan, never opened as PRs.
  - **W5** is deferred until after Phase 2 because most sections will collapse during the hardcoding sweep.
  - **W6** could ship anytime as a small standalone PR (one PB migration that stamps `metadata.section`/`metadata.business_category` on existing `session_availability`/`budget` rows so they stop bleeding into the Bunk Optimizer tab). User has chosen to hold for now.
- **Phase 1.5 (this doc):** Domain-by-domain re-baseline. Decisions captured here before any Phase 2 PRs.
- **Phase 2:** Hardcoding sweep + dead-code deletion, driven by the per-domain decisions below.
- **Phase 3 (currently deferred):** Storage split for runtime data (`session_availability`, `budget`, `registration` → dedicated PB collections). User has agreed in principle to this end-state.

### Storage architecture (agreed direction)

User has chosen **Option D — hybrid**. Phase 2 hardcodes the bulk of "knobs we don't tune" so the genericized `config` table shrinks dramatically. Phase 3 (post-Phase-2) moves structured runtime data (`session_availability`, `budget`, `registration`) to dedicated typed PB collections — these are records, not config knobs, and the existing config table is the wrong shape for them. End state: ~10-20 truly-tunable rows in the config table, no JSON object values, no "Other Settings" bleed possible. The architecture isn't broken; too many things are in it.

Alternatives weighed and rejected:
- **A. Status quo + hardcode aggressively:** doesn't solve structured-data render bugs.
- **B. Schema-driven codegen:** over-engineering for ~20 post-cleanup rows.
- **C. Per-domain typed tables for everything:** excessive boilerplate for solver knobs that mostly want to be constants.

## Approach

Walk one constraint domain at a time. For each domain, lay out all four surfaces (CONFIG_SCHEMA, seed migration, GUI, code reads + frontend reads) side by side. Make per-key decisions:

- **KEEP** — stays in admin GUI as a tunable knob; runtime tuning happens.
- **HARDCODE** — move to a constants module; user can change via code PR.
- **DELETE** — orphan; no consumer; remove from schema/seed/GUI entirely.
- **FIX** — has a real bug (phantom key, wrong default, wrong query) that needs a code change before the keep/hardcode/delete decision can be made.

Decisions go in this doc with the reasoning. Phase 2 PRs implement them domain-by-domain.

## Domain backlog

- [x] **Cabin Capacity** — decisions locked in (see below); ready to draft Phase 2 PR.
- [ ] Cabin Minimum Occupancy
- [ ] Age Spread + spread.max_age_months
- [ ] Grade Spread + spread.max_grade
- [ ] Grade Ratio + Grade Cohesion + Age/Grade Flow
- [ ] Level Progression
- [ ] Must Satisfy One + Age Preference (phantom)
- [ ] Objective Source Multipliers
- [ ] Diminishing Returns
- [ ] Solver Execution (auto_apply_*)
- [ ] Smart Local Resolution (likely all DELETE — confirmed orphan; runtime values hardcoded in `phase2_resolution_service.py:626-636`)
- [ ] AI Confidence Thresholds + Name Matching
- [ ] AI Request Parsing + Source Field Weights
- [ ] AI Confidence Scoring (the big one — ~40 keys, many already orphan / unsectioned)
- [ ] AI Manual Review Triggers + Spread Validation + Dedup Scoring
- [ ] AI Historical Context + History Tracking
- [ ] AI Context Building + Age Preference Source Priority
- [ ] Tour staleness (single key)
- [ ] Runtime data (session_availability / budget / registration) — Phase 3 vs W6 metadata-only stopgap

## Storage architecture decision (locked in)

**Option D — Hybrid: hardcode + dedicated tables for structured data.** Phase 2 hardcodes most knobs in the existing `config` table. Phase 3 moves structured runtime data (`session_availability`, `budget`, `registration`) to dedicated typed tables. End state: `config` table is small (~10-20 truly-tunable rows like `objective.source_multipliers.*` and headline penalty weights). Big migration file shrinks proportionally. JSON object values eliminated. Bleed structurally impossible.

Rejected alternatives:
- **Schema-driven codegen** (Python `schema.py` → PB migration + GUI metadata + TS types): over-engineering for ~10 post-cleanup rows; high tooling cost.
- **Per-domain typed tables for solver knobs**: excessive boilerplate; solver knobs mostly want to be code constants, not table rows.
- **Status quo + hardcode aggressively**: doesn't fix the structured-data render-bug class (caused by JSON object values in `session_availability`/`budget`).

The current `config` table architecture isn't broken at small scale — too many things are in it. Cleaning up the contents reveals the table is fine at the right scale.

## Cross-cutting findings (apply to multiple domains)

### `default=` kwarg still on direct `get_int`/`get_float`/`get_bool`/`get_str` reads
Phase 1 PR #1214 only stripped `default=` from `get_soft_constraint_weight`. ~20 production sites still pass hardcoded defaults to direct reads. Some agree with the seed value, some disagree (e.g., `constraint.grade_spread.mode` defaults to `"hard"` at three sites but is seeded `"soft"`). Each domain review should either drop the kwarg or note why it stays.

### Phantom keys (read by code, not in schema, not seeded)
- `constraint.age_preference.penalty` — `bunking/solver/constraints/age_preference.py:113`, default=500
- `constraint.grade_spread.max_spread` — `objective_evaluator.py:427`, `score_evaluator.py:269`, default=2
- `constraint.level_progression.prefer_progression` — `level_progression.py:30`, default=0 (gated off; dead read)

These produce silent fallback values; no schema validation catches them.

### `capacity_override` is wired to display only, not solver
`session_availability.<year>.<cm_id>.value.capacity_override` (per-session capacity, edited via `SessionConfigTable.tsx:202` in /manage/registration) is read **only** by `session_availability_service.py:287` for the availability/waitlist UI. It does not propagate to `bunk.max_size` or to the solver. The "more evenly solved under-enrolled sessions" intent the field was added for never got the solver-side wiring. User decision: leave as-is for now (display-only), don't rip out — Phase 3 will move it into a dedicated session table column.

Note: only ~3 of these fields are filled today; the feature is mostly conceptual / quest-specific. Future PR could wire it to drive per-session solver capacity (override → bump per-bunk max_size at fetch time, distributing across the session's bunks). Not in scope for current Phase 2.

### Dead-row queries (look up a config_key that was never seeded)
Multiple consumers query `category="constraint" && subcategory="cabin_capacity" && config_key="default"` — but the seed migration creates `config_key="standard"` (from `constraint.cabin_capacity.standard`). The "default" row doesn't exist; queries silently fall back to hardcoded 12. Affected sites:
- `api/services/metrics_repository.py:212-228` — `fetch_capacity_config()`
- `api/services/metrics_sql_repository.py:341+` — SQL variant
- `frontend/src/components/SessionList.tsx:506` — frontend filter

This is the same bug class, three times. Same fix as the Cabin Capacity decisions below.

### Section drift in `1500000012_config_sections.js`
- `ui-preferences` is double-defined: `1500000012` says `display_order=29`, `1500000091_tour_config.js` says `display_order=50`. Idempotent insert means whichever ran first wins.
- Display order has gaps (4→6, 10→13, 23→25, 25→27) from deleted sections — cosmetic.

### AI keys seeded without `metadata.section` (visible bleed in Processing tab)
~24 keys in `aiConfigs` (mostly `ai.confidence_scoring.resolution.fuzzy.*`, `.phonetic.*`, and `context_scores.*`) are not in SECTION_MAPPING. They show as primitives in "Other Settings" under whatever tab `business_category` heuristic picks. Will be touched per-domain when AI Confidence Scoring is reviewed.

---

## Decisions

### Cabin Capacity

**Status:** ✅ decisions locked in. Ready for Phase 2 PR drafting.

#### User-confirmed intent (final)
1. **Solver hard min:** never fill a cabin below the configured minimum — covered by Cabin Minimum Occupancy domain, not this one.
2. **Solver hard max:** never exceed `DEFAULT_BUNK_CAPACITY=12`. (Was `cabin_capacity.standard` PB row + `bunk.max_size` Pydantic default — both effectively the same hardcoded 12 today; collapsing to one constant. Per-bunk variance for specialty cabins becomes a future feature requiring a real PB column.)
3. **Per-session capacity override** lives on `session_availability.<year>.<cm_id>.value.capacity_override`, edited via /manage/registration. **Stays as-is: display-only, NOT wired to solver.** ~3 fields filled today, mostly for quest-related capacity tracking. Wiring it to solver is on the future-feature radar (would let under-enrolled session bunks bump effective capacity) but **explicitly out of scope for this Phase 2 PR**.
4. **Staff manual drag cap:** `MAX_BUNK_CAPACITY=14`, always. Enforced at frontend drag handler. After Phase 2, the magic-number `14` in `BunkingBoardByArea.tsx:412` imports the constant.
5. **No soft mode.** Soft constraint path is dead and will be deleted entirely.

#### Surface 1 — CONFIG_SCHEMA (`bunking/config/schema.py`)
4 keys, all `required=True`:
- `constraint.cabin_capacity.max` — int, 1-30
- `constraint.cabin_capacity.standard` — int, 1-30
- `constraint.cabin_capacity.mode` — string ["hard", "soft"]
- `constraint.cabin_capacity.penalty` — int, ≥0

#### Surface 2 — Seed migration (`pocketbase/pb_migrations/1500000011_config.js`)
All 4 keys seeded in `configDefinitions` (lines 792-825):
- `max=14`, `standard=12`, `mode="hard"`, `penalty=50000`
- All 4 mapped to `'cabin-capacity'` section
- All 4 have FRIENDLY_NAMES + TOOLTIPS entries

#### Surface 3 — GUI
- Section "Cabin Capacity Rules" defined in `1500000012_config_sections.js:109` (display_order=3)
- All 4 keys render under `/admin/config/solver` → "Cabin Capacity Rules"
- Frontend live read: `SessionView.tsx:86` uses `useSolverConfigValue('constraint.cabin_capacity.standard', 12)` for the per-session optimize-button capacity dropdown default

#### Surface 4 — Code paths

**The hard cap is always on, regardless of `mode`.** `cabin_capacity.py:28-46` (`add_cabin_capacity_constraints`) runs unconditionally and enforces `total <= min(bunk.capacity, cabin_capacity.max)`. So `max=14` is the absolute ceiling for every solver run.

**`mode="soft"` is the only thing that activates the soft penalty path.** `add_cabin_capacity_soft_constraint` (graduated overflow penalties using `standard`/`max`/`penalty`) is invoked only when `mode="soft"`. **Git history shows no evidence `mode` has ever been flipped to "soft" since January 2026.** With the seeded `mode="hard"`, the entire soft path is dead code.

**`bunk.max_size` is NOT a real per-bunk field — it's a Pydantic default that always returns 12.** Verified post-decision-locking:
- `bunks` PB collection schema has no `max_size`/`capacity` field. Fields: `cm_id`, `name`, `year`, `gender`, `is_active`, `sort_order`, `area_id`.
- `bunking/models.py:263` defines `max_size: int = 12` as a Pydantic default.
- Every read site is `getattr(bunk, "max_size", 12)` or `bunk.get("max_size") or standard_capacity` — fallback hit every time.
- No sync code (Python or Go) writes `max_size`. No migration adds the field.
- The "per-bunk variance for under-enrolled sessions" use case the field implies is theoretical, not implemented. There is no path from `capacity_override` (display-only) to any per-bunk variance.
- → `bunk.max_size` is effectively the constant 12 wearing a costume. Phase 2 deletes the Pydantic field along with the rest.

**`standard=12` use sites:**
| Site | Purpose |
|---|---|
| `cabin_capacity.py:68` | Soft path: per-bunk overflow ceiling (`max - standard = 2` extra slots) — **dead with mode=hard** |
| `cabin_capacity.py:105` | Soft path: per-gender total capacity for unavoidable-overflow accounting — **dead with mode=hard** |
| `grade_ratio.py:41` | Compute absolute grade-percentage cap per cabin — **live** |
| `objective_evaluator.py:454` | Post-solve displayed score — **live** |
| `score_evaluator.py:285` | Post-solve displayed score — **live** |
| `solver.py:338` (router) | Pre-solve capacity vs. enrollment validation — **live** |
| `SessionView.tsx:86` | Frontend "default capacity" for the optimize button dropdown — **live** |
| 3 dead-row queries (see Cross-cutting) | Silently fall back to hardcoded 12 — **broken** |

So `standard` has 5 live consumers outside the soft path. Hardcoding it means importing a constant in all 5 sites + fixing the 3 dead-row queries.

#### Surface 5 — Per-session override (separate storage layer; display-only)
- `session_availability.<year>.<cm_id>` rows have `value.capacity_override` (int), `value.min_grade`, `value.max_grade`
- Written by `SessionConfigTable.tsx:202` via /manage/registration
- **Today and after this Phase 2 PR:** only consumed by `session_availability_service.py:287` for availability/waitlist UI (not solver)
  - `capacity_override` is interpreted as total session capacity, split M/F evenly: `half = override // 2`
  - `min_grade`/`max_grade` populate the availability response; solver derives grade ranges from session names instead
- **Currently filled for ~3 quest sessions only**; the field is mostly a display-only knob today
- **Decision: keep as-is, do NOT wire to solver in this PR.** Future PR could connect override → per-session bunk capacity bump (out of scope here)
- Phase 3 will move this field out of the JSON `value` blob into a typed column on a dedicated `session_capacity` (or similar) table

#### Manual-drag enforcement (frontend)
- `frontend/src/components/BunkingBoardByArea.tsx:412` — hardcoded literal `14` blocks drops at occupancy ≥ 14
- `frontend/src/components/BunkCard.tsx:182` — visual over-capacity indicator at `bunk.occupancy > effectiveCapacity` (where `effectiveCapacity = bunk.capacity ?? defaultCapacity`)
- The PB `cabin_capacity.max=14` config row is **already orphaned** for this use case — the live enforcement is the magic number 14 in `BunkingBoardByArea.tsx`

#### The "too flexible" incident
The user remembers a few months ago, the solver was too willing to overpack cabins. Almost certainly the soft constraint path (`add_cabin_capacity_soft_constraint`) with penalty weights that lost to `must_satisfy_one.penalty` etc. The user does not want soft mode.

#### Per-key decisions

- ✅ **DELETE `constraint.cabin_capacity.mode`.** Has been "hard" forever; "soft" is the dead-code path. Delete schema entry, seed entry, GUI entry, and the `if capacity_mode == "soft"` branch readers in `direct_solver.py:326`, `objective_evaluator.py:395`.
- ✅ **DELETE `constraint.cabin_capacity.penalty`.** Only consumed by the soft path. Goes with mode.
- ✅ **DELETE the soft constraint path itself.** Remove `add_cabin_capacity_soft_constraint` from `cabin_capacity.py` (~135 lines including the unavoidable-overflow accounting). Remove its callers. Reduces solver complexity significantly.
- ✅ **HARDCODE `constraint.cabin_capacity.max` as `MAX_BUNK_CAPACITY = 14`.** Roles:
  1. **Frontend manual drag:** `BunkingBoardByArea.tsx:412` imports the constant instead of the magic number `14`. This is the live use of `max=14` post-Phase-2.
  2. **Sync sanity (optional):** assert any `bunk.max_size > 14` is rejected at sync time (defensive). If we go this route, this is also the place to clamp a future `capacity_override` if/when it gets wired.
  3. **Note:** the solver itself caps at `DEFAULT_BUNK_CAPACITY=12`, NOT at `MAX_BUNK_CAPACITY=14`. The `MAX_BUNK_CAPACITY` constant is the staff-edit ceiling, not the solver ceiling.
- ✅ **HARDCODE `constraint.cabin_capacity.standard` as `DEFAULT_BUNK_CAPACITY = 12`.** This becomes both:
  1. Default for `bunk.max_size` when not set (already the case in `bunking/models.py:263`).
  2. Reference value for grade-ratio math and post-solve evaluator display. Optional rename consideration: split into two constants (`DEFAULT_BUNK_CAPACITY` for the default, `GRADE_RATIO_REFERENCE_CAPACITY` for the math) if their values ever need to diverge. For now, single constant is fine.
  3. Frontend `SessionView.tsx:86` uses the constant directly (TS); future codegen could share but not blocking.
- ✅ **DELETE `bunk.max_size` from the `Bunk` Pydantic model.** Not a real PB field; just a Pydantic default of 12. Replace all read sites (`data_fetcher.py:425`, `score_evaluator.py:290`, `objective_evaluator.py:460`, `bunking_validator.py:304/322/333`, `validation.py:158`, `scenarios.py:357`) with the `DEFAULT_BUNK_CAPACITY` constant. Solver formula simplifies from `min(bunk.max_size, X)` to just `DEFAULT_BUNK_CAPACITY`. Per-bunk variance is a future feature, not a refactor — add a real PB column then.
- ✅ **KEEP `capacity_override` on `session_availability` rows AS-IS** (display-only). Do NOT wire to solver in this PR. This is the explicit user decision: keep the GUI field for quest capacity tracking, don't add the solver wiring. Future feature work could add the wiring; tracked as out-of-scope here.

#### Required FIX before Phase 2 PR lands
- ✅ Fix the three dead-row queries: `metrics_repository.py:212-228`, `metrics_sql_repository.py:341+`, `SessionList.tsx:506`. They look up `config_key="default"` which was never seeded. Replace with the new constant `DEFAULT_BUNK_CAPACITY` (server-side) and inline the `12` (or import the TS constant) on the frontend. Since `standard` is going away in this same PR, the constant path is the only correct fix.

#### GUI consequence
The "Cabin Capacity Rules" section becomes empty (all 4 keys gone). Either:
- Delete the section entry from `1500000012_config_sections.js` (removes the empty header), or
- Leave it for whatever future per-bunk capacity controls might surface (e.g., a future GUI for setting `bunk.max_size` per cabin).

Lean: delete it. Per-bunk `max_size` editing is in `/manage/registration` already, not the admin solver tab.

#### Open questions for user (gut-check before implementing)
1. **`capacity_override` interpretation when wired to solver.** Two choices:
   - **Total-and-split (recommended):** Match existing `session_availability_service.py:287` logic — `override` is total session capacity, divide as `M = override // 2`, `F = override - half`, `mixed = override`. Apply per-bunk within the session. Quest with override=16 across 1M+1F bunks → each bunk gets 8.
   - **Per-bunk size:** `override` is the new `max_size` for every bunk in that session. Quest with override=8 across 1M+1F → each bunk has size 8 (total 16). Conceptually cleaner but requires re-confirming the 3 existing quest values.
2. **Min/max grade fields on the same form (`min_grade`/`max_grade` on `session_availability`).** Same propagation gap as `capacity_override` — they don't reach the solver today; solver derives grade ranges from session-name regex. Wire-or-rip is a separate question for the Grade Spread / Grade Ratio domain reviews. Flagged here so it's not a surprise when those domains come up.

#### Out of scope for this domain
- Per-session min/max grade wiring — see Grade Spread / Grade Ratio domain reviews.
- Visible "Other Settings" bleed in solver tab caused by `session_availability` rows — addressed by W6 stopgap, not by domain decisions here. Note: once Path A wiring lands, the solver-relevance gap closes regardless of W6.
