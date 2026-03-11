# CampMinder Date Fields on Attendees

## Fields

| PB Field | CM API Field | Type | Meaning | Stability |
|----------|-------------|------|---------|-----------|
| `effective_date` | `EffectiveDate` | date | Original registration/application date | **Stable** — never overwritten |
| `enrollment_date` | `PostDate` | date | Date of the CURRENT status transition | **Changes** on every status change |
| `last_updated_utc` | `LastUpdatedUTC` | datetime | Last modification timestamp | Changes on any update |

## Key Rule

**`effective_date` = original registration/application date (ALWAYS stable).**

For ALL statuses, `effective_date` represents when the person first took action
(applied, enrolled, waitlisted). It never gets overwritten by subsequent status changes.

**`enrollment_date` (PostDate) = when the current status was set.** MISLEADING NAME.
It gets overwritten each time status changes:
- Enrolled → PostDate = enrollment date
- Enrolled → Cancelled → PostDate = cancellation date (EffectiveDate stays = original reg)
- Applied → Enrolled → PostDate = enrollment date (EffectiveDate stays = application date)

> **Future rename:** `enrollment_date` should be renamed to `status_date` or
> `post_date` to avoid confusion. Filed as a separate task.

### `last_updated_utc` (LastUpdatedUTC)
- Any modification to the CampMinder record updates this
- Not used in reconstruction — too broad (includes memo edits, etc.)
- Notable: for waitlisted records, this diverges significantly from PostDate
  (mean 183 days later) due to background system updates

## Date Field Behavior Per Status (Verified Against Full Dataset)

Data verified against 3,780 enrollment records across 2024/2025/2026.

| Status | n | `effective_date` | `enrollment_date` (PostDate) | `last_updated_utc` |
|--------|---|------------------|------------------------------|---------------------|
| **Enrolled (2)** | 2562 | Original reg date | ~Same as ED (median 0d gap; 53% same-day, 30% +1d) | ~Same as PD (68%) |
| **Cancelled (32)** | 791 | **Original reg date** (stable) | **Cancellation date** (median 108d after ED) | ~Same as PD (68%) |
| **Withdrawn (256)** | 5 | **Original reg date** (stable) | **Withdrawal date** (median 79d after ED) | ~Same as PD |
| **Waitlisted (8)** | 247 | Application/waitlist date | ~Same as ED (median 1d gap) | Diverges! Only 3% same as PD, mean 183d later |
| **None (1)** | 92 | Original action date | Status-change date or same (37% same-day) | 57% same as PD |
| **Incomplete (512)** | 83 | Application date | ~Same as ED (66% same-day) | ~Same as PD |
| **Applied (4)** | ~0 | Application date | ~Same as ED | ~Same as PD |

## Cancellation Analysis

33% of cancellations are session swaps (cancel Session A + enroll Session B same day),
not true departures. 401 are pure cancellations (no enrolled records for that person).

| Category | Count | Description |
|----------|-------|-------------|
| Pure cancellations | 401 | Person has no enrolled records at all |
| Session swaps | 261 (33%) | Cancel Session A + Enroll Session B same day |
| Mixed | 129 | Has enrollments on different days |

## Velocity / Reconstruction Reference

| Status | Count in velocity? | Registration date field | Departure date field |
|--------|-------------------|------------------------|---------------------|
| Enrolled (2) | Yes | `effective_date` | N/A |
| Cancelled (32) | +1 at ED, -1 at PD | `effective_date` | `enrollment_date` |
| Withdrawn (256) | +1 at ED, -1 at PD | `effective_date` | `enrollment_date` |
| Waitlisted (8) | No (not enrolled) | `effective_date` | N/A |
| Incomplete (512) | No | `effective_date` | N/A |
| None (1) | No | `effective_date` | N/A |
| Applied (4) | No | `effective_date` | N/A |

## Reconstruction Logic

To reconstruct "how many were enrolled at day X":

1. For each attendee with status in {enrolled, cancelled, withdrawn}:
   - **Enrollment event**: `effective_date` (when they first registered)
   - **Cancellation event** (cancelled/withdrawn only): `enrollment_date` (when they left)
2. Count events within [season_start, season_start + day_offset]
3. Net enrolled = gross enrollments - cancellations

See: `api/services/reconstruction.py`
