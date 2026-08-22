# Camper Status Visibility Design

**Date**: 2026-03-12
**Status**: Draft

## Problem

Waitlisted and cancelled campers are invisible throughout the app. The all-campers list filters to `status = "enrolled"` only, and the camper detail page shows a dead-end "no active enrollments" message for campers whose only attendee records are non-enrolled. This prevents staff from looking up waitlisted campers, viewing their prior year history, or seeing cancelled campers who dropped mid-summer.

## Solution

Surface all camper statuses through the app in incremental PRs:
1. Fix the detail page to render non-enrolled campers with status badges
2. Add a list toggle to switch between "Enrolled" and "All Statuses"
3. Enrich the history timeline with prior-year non-enrolled records
4. Nice-to-haves (status history timeline, session-scoped toggle, count badges)

## Data Model — Status Reference

The Go sync (`pocketbase/sync/attendees.go:234-253`) pulls ALL statuses from CampMinder. Every attendee record exists in PocketBase regardless of status. The `persons` sync also creates person records for all attendees with no status filter.

| `status_id` | `status` string | `is_active` | Badge Color |
|---|---|---|---|
| 2 | `enrolled` | true | hidden (no badge) |
| 8 | `waitlisted` | false | amber |
| 32 | `cancelled` | false | red |
| 256 | `withdrawn` | false | stone/gray |
| 16 | `left_early` | false | orange |
| 64 | `dismissed` | false | red |
| 4 | `applied` | false | blue |
| 128 | `inquiry` | false | stone/gray |
| 512 | `incomplete` | false | stone/gray |
| 1 | `none` / `unknown` | false | stone/gray |

## Scoping Rule

A camper only appears if they have an **attendee record for the current year**. This scopes to CampMinder's season enrollment data — we do not surface the entire persons database. A person with no attendee record this year does not appear in the list or render on the detail page, even if they have prior year history.

## Complete Filter Inventory

Every location in the frontend that filters `status = "enrolled"`, classified by whether it changes or stays.

### Filters Changed in This Feature

| Location | Line | Context | Phase |
|---|---|---|---|
| `hooks/camper/useCamperEnrollment.ts` | 56 | CamperDetail page enrollment query | Phase 1 |
| `components/CamperDetailsPanel.tsx` | 158 | Side pop-in modal inline enrollment query | Phase 1 |
| `components/CamperDetailsPanel.tsx` | 358 | Side pop-in modal sibling enrollment check | Phase 1 |
| `hooks/useCamperEnrollment.ts` | 62 | Shared enrollment hook (used elsewhere) | Phase 1 |
| `hooks/camper/useSiblings.ts` | 63 | Sibling enrollment check on detail page | Phase 1 |
| `utils/pocketbaseDataFetchers.ts` | 36 | AllCampersView list fetch | Phase 2 |

### Filters Intentionally Unchanged

These frontend filters MUST remain `status = "enrolled"` — they serve bunking/request workflows where only enrolled campers are valid targets.

| Location | Line | Reason |
|---|---|---|
| `components/CreateRequestModal.tsx` | 40 | Bunk requests only valid for enrolled campers |
| `components/EditableRequestTarget.tsx` | 150 | Request target lookup — only enrolled are assignable |
| `components/SessionList.tsx` | 486 | Session camper counts — should reflect enrolled count |

> `ManualResolutionModal.tsx` was also on this list; the component was deleted (unreferenced dead
> code) in kindred#2530, so its row is removed rather than left pointing at nothing.

**All backend/API filters remain unchanged.** The Python backend has `status = "enrolled"` or `is_active = 1 && status_id = 2` filters across solver, validation, metrics, geo, velocity, cancellation, waitlist, and session availability services. These are entirely out of scope — only frontend filters are affected by this feature.

## Existing Type: `Camper.attendee_status`

The `Camper` interface (`frontend/src/types/app-types.ts:71`) already has an `attendee_status?: string` field, but it is **never populated**. Two places need to set it:

1. **`toAppCamper`** (`utils/transforms.ts`) — add `attendee_status: attendee.status`. This covers the AllCampersView path via `buildCampersFromData` (which calls `toAppCamper` at line 130).
2. **`useCamperEnrollment` inline construction** (`hooks/camper/useCamperEnrollment.ts:112-147`) — this hook builds `Camper` objects inline WITHOUT calling `toAppCamper`. Must add `attendee_status: attendee.status` to the returned object literal. This covers the CamperDetail page path.

**Note:** The `buildCampersFromData` function (`utils/transforms.ts:104`) also has an `is_camper` filter (`if (!person || !person.is_camper) continue`). This is NOT status-related and remains unchanged — it filters out staff members.

---

## Phase 1: Fix Detail Page (PR #1)

### Query Changes

**`useCamperEnrollment`** (`hooks/camper/useCamperEnrollment.ts:56`)
- Remove `status = "enrolled"` from the PocketBase filter
- Keep session type filter (uses `VALID_SUMMER_SESSION_TYPES` constant from `constants/sessionTypes.ts`) and year filter
- Returns all attendee records for this person/year regardless of status
- After this change, a waitlisted camper returns records instead of `[]`, so `camper` is non-null in CamperDetail — this naturally unblocks the `useCamperHistory` enabled gate (`!!camper` passes)

**`CamperDetailsPanel` inline query** (`components/CamperDetailsPanel.tsx:158`)
- This component does NOT use the shared `useCamperEnrollment` hook — it has its own inline PocketBase query
- Remove `status = "enrolled"` from this inline filter
- Same change needed at line 358 (sibling enrollment check)

**`useCamperEnrollment` (shared hook)** (`hooks/useCamperEnrollment.ts:62`)
- Remove `status = "enrolled"` from filter

**`useSiblings`** (`hooks/camper/useSiblings.ts:63`)
- Remove `status = "enrolled"` from sibling enrollment filter
- A waitlisted sibling should show in the siblings panel with their status badge
- The `SiblingWithEnrollment` type (`hooks/camper/types.ts:50-60`) needs a new `attendeeStatus?: string` field
- The sibling mapping logic (lines 117-130 of `useSiblings.ts`) must pass the attendee's status through
- The `SiblingsPanel` component must render `<StatusBadge>` for non-enrolled siblings

**Dummy attendee cleanup** — Both `hooks/useCamperEnrollment.ts:68-82` and `CamperDetailsPanel.tsx:162-176` create dummy attendees with hardcoded `status: 'enrolled'` when no records found. After removing the enrolled filter, this dummy path only triggers when a person has zero attendee records of any status this year (the scoping rule). The dummy attendee should be updated to use `status: 'none'` instead of `status: 'enrolled'` to avoid misrepresenting a camper's actual status.

**`toAppCamper` transform** (`utils/transforms.ts`)
- Populate `attendee_status: attendee.status` from the attendee record

**Primary camper selection** — `CamperDetail.tsx:121` uses `enrolledCampers[0]` as the primary camper. After removing the enrolled filter, if a camper is enrolled in Session 1 but waitlisted in Session 2, the array order depends on PocketBase sort. The `useCamperEnrollment` hook in `hooks/camper/` should sort results with a two-level comparator: (1) **status as primary key** — enrolled first, all other statuses after; (2) **session type as secondary key** — main > embedded > ag > quest (existing priority). This ensures the primary camper is the enrolled one when mixed statuses exist.

**Variable naming** — After this change, `useCamperEnrollment` returns all-status campers, not just enrolled. The return variable is `enrolledCampers` in `CamperDetail.tsx`. Keep the existing name in Phase 1 for minimal diff; a rename to `campers` can happen in Phase 2 when the list toggle makes the broader scope more visible.

**`CamperDetail` orchestration** (`components/CamperDetail.tsx`)
- The "no active enrollments" path now only fires when there are zero attendee records for this person/year (not just zero enrolled)
- Conditionally hide bunking-specific panels when the primary camper's `attendee_status !== "enrolled"`: BunkingStatusPanel, bunk assignment details, satisfaction data, bunk requests

### New Component: `StatusBadge`

**File:** `frontend/src/components/StatusBadge.tsx`

Small component that renders a colored pill for non-enrolled statuses and nothing for enrolled.

```tsx
<StatusBadge status="waitlisted" />  // amber pill
<StatusBadge status="cancelled" />   // red pill
<StatusBadge status="enrolled" />    // renders null
```

**Styling:** `rounded-full px-1.5 py-0.5 text-xs font-medium` — matches existing gender badge pill pattern in AllCampersView.

**Color mapping** (with dark mode following `bg-[color]-100 dark:bg-[color]-900/30` pattern):

| Status | Background (light / dark) | Text (light / dark) | Label |
|---|---|---|---|
| `enrolled` | — | — | (hidden) |
| `waitlisted` | amber-100 / amber-900/30 | amber-800 / amber-300 | Waitlisted |
| `cancelled` | red-100 / red-900/30 | red-800 / red-300 | Cancelled |
| `dismissed` | red-100 / red-900/30 | red-800 / red-300 | Dismissed |
| `left_early` | orange-100 / orange-900/30 | orange-800 / orange-300 | Left Early |
| `applied` | blue-100 / blue-900/30 | blue-800 / blue-300 | Applied |
| `withdrawn` | stone-100 / stone-900/30 | stone-700 / stone-400 | Withdrawn |
| `inquiry` | stone-100 / stone-900/30 | stone-700 / stone-400 | Inquiry |
| `incomplete` | stone-100 / stone-900/30 | stone-700 / stone-400 | Incomplete |
| `none` / `unknown` | stone-100 / stone-900/30 | stone-700 / stone-400 | No Status / Unknown |

Optional `size` prop (`sm` | `md`) for hero header variant. Status text is visible to screen readers since it renders as text content inside the pill.

### Badge Placement

**HeroHeader** (`components/camper/HeroHeader.tsx`)
- Inline next to the camper's name
- Receives `attendee_status` via camper prop

**CamperDetailsPanel** (`components/CamperDetailsPanel.tsx`)
- Near camper name at top of the side panel

**AllCampersView row** (`components/AllCampersView.tsx`)
- In the name/details column next to the gender pill
- Rendering logic added in Phase 1 but only visible when Phase 2 toggle exposes non-enrolled campers

### Conditional UI on Detail Page

When primary camper's `attendee_status !== "enrolled"`:
- **Show:** Person info, HeroHeader with status badge, session enrollment with status label (e.g., "Session 2 — Waitlisted"), prior year history, siblings (with their own status badges if non-enrolled)
- **Hide:** BunkingStatusPanel, bunk assignment details, satisfaction data, bunk requests

### Files Affected (Phase 1)

| File | Change |
|---|---|
| `frontend/src/hooks/camper/useCamperEnrollment.ts` | Remove `status = "enrolled"` filter, add `attendee_status` to inline Camper construction, add status-based sort for primary selection |
| `frontend/src/hooks/useCamperEnrollment.ts` | Remove `status = "enrolled"` filter, fix dummy attendee status to `'none'` |
| `frontend/src/hooks/camper/useSiblings.ts` | Remove `status = "enrolled"` filter, pass attendee status through |
| `frontend/src/hooks/camper/types.ts` | Add `attendeeStatus?: string` to `SiblingWithEnrollment` interface |
| `frontend/src/components/CamperDetailsPanel.tsx` | Remove `status = "enrolled"` from inline queries (lines 158, 358), fix dummy attendee status, add StatusBadge |
| `frontend/src/utils/transforms.ts` | Populate `attendee_status` in `toAppCamper` |
| `frontend/src/components/StatusBadge.tsx` | **New** — shared status badge component |
| `frontend/src/components/camper/HeroHeader.tsx` | Add StatusBadge next to name |
| `frontend/src/components/camper/SiblingsPanel.tsx` | Add StatusBadge for non-enrolled siblings |
| `frontend/src/components/CamperDetail.tsx` | Conditional panel hiding for non-enrolled |
| `frontend/src/components/AllCampersView.tsx` | Add StatusBadge rendering in row (prep for Phase 2) |

---

## Phase 2: All Campers List Toggle (PR #2)

### Status Dropdown

Add an "Enrollment Status" dropdown to AllCampersView alongside existing Session, Sex, and Bunk dropdowns.

- **Default: "Enrolled"** — current behavior, `status = "enrolled"` filter applied
- **Option: "All Statuses"** — removes the status filter from `fetchAttendeesWithPersons`

The `fetchAttendeesWithPersons` function (`utils/pocketbaseDataFetchers.ts`) accepts an optional `statusFilter` parameter instead of hardcoding `"enrolled"`.

### List Row Changes

Status badge (from Phase 1's `StatusBadge` component) renders in each row's name/details column for non-enrolled campers. Enrolled campers show no badge (current appearance unchanged).

### Multi-Session Merge

`mergeMultiSessionCampers` (`utils/mergeMultiSessionCampers.ts`) needs to handle mixed-status sessions. The primary enrollment selection should prefer enrolled sessions over non-enrolled, then fall back to session type priority (`main > embedded > ag > taste`).

---

## Phase 3: Enriched History Timeline (PR #3)

### Prior-Year Non-Enrolled Records

`useCamperHistory` currently queries `bunk_assignments` for prior years. A camper who was waitlisted in a prior year has no bunk assignment and no history entry.

**Change:** Also query prior-year `attendees` records, merge with bunk assignment history. Timeline shows entries like "2023: Session 2 — Waitlisted" alongside "2022: Session 1 — B-4".

---

## Phase 4: Nice-to-Haves (Future PRs)

- **Status history timeline** on detail page — data exists in `attendee_status_history` collection (tracks transitions like enrolled -> cancelled with `detected_at` timestamp)
- **Session-scoped CampersView** (`CampersView` inside `SessionView`) supporting status filtering — currently receives campers as props from parent
- **Count badges on dropdown** (e.g., "Enrolled (247) | All (263)")

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Waitlisted in 1 session, enrolled in another | Primary = enrolled session. Waitlisted session shown with status badge in additional sessions. |
| Waitlisted only, no enrolled sessions this year | Detail page shows person info + status badge + prior year history. Bunking panels hidden. |
| Cancelled mid-summer | Remains visible with "cancelled" badge. Prior bunk assignment may still exist in history. |
| Person with no attendee records this year | Not shown in list. Detail page shows existing "no active enrollments" dead-end. |
| Left early (status_id=16) | Shown with "left early" orange badge. Bunk assignment may still exist. |
| Multi-session mixed statuses | Primary enrollment = enrolled session (if any), then by session type priority. Status badge on non-enrolled sessions. |
| Solver/validation | Unchanged — uses `is_active = 1 && status_id = 2`. Only enrolled campers in solver. |
| Social graph | Unchanged — uses `is_active = true`. Non-enrolled campers excluded. |
| Bunk assignments for non-enrolled campers | Gracefully show "not assigned" — no error. |
| Siblings with non-enrolled status | Shown in siblings panel with their own status badge. |
| Request modals (Create, Edit, Manual Resolution) | Unchanged — only show enrolled campers as valid targets. |
| Session list counts | Unchanged — reflect enrolled count only. |

## Decisions Log

| Decision | Rationale |
|---|---|
| "Enrolled" vs "All Statuses" toggle (not per-status filters) | Simple UX, covers the primary use case |
| No badge for enrolled status | Enrolled is the default — badge would be visual noise on 95% of campers |
| Scoped to current-year attendee records only | Prevents surfacing the entire CampMinder persons database |
| Detail page requires current-year attendee record | Prevents dead pages for old staffers or pre-2015 attendees with no useful data |
| Backend solver/metrics filters unchanged | Non-enrolled campers should never enter the solver or affect metrics |
| Request modals unchanged (enrolled-only) | Can't create bunk requests for non-enrolled campers |
| Session list counts unchanged (enrolled-only) | Counts should reflect operational reality |
| `attendee_status` field reused (not new field) | Already exists on `Camper` type, just never populated |
| Prior-year non-enrolled history deferred to Phase 3 | Keeps Phase 1 focused; distinct behavior change deserves own tests |
| Dummy attendee status changed to `'none'` | Prevents misrepresenting a person with no attendee records as enrolled |
| Primary camper selection prefers enrolled status | Mixed-status multi-session campers should show enrolled session as primary |
