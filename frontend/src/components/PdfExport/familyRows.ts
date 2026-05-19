import type { ValidationStatistics, ImpossibilityReport } from '../../services/solver'
import { friendlyReasonLabel } from '../impossibility/reasonHints'

export type FamilyCohort = 'got_nothing' | 'violated' | 'priority_unmet'

export type FamilySubRow = {
  session: string
  detail: string
}

export type FamilyRowData = {
  key: string // {cm_id}-{cohort}
  name: string
  cm_id: string
  grade: number
  gender: string
  cohort: FamilyCohort
  sessions: string[] // unique session_cm_ids (as strings), in encounter order
  subRows: FamilySubRow[] // one per session contribution
  detail: string // TODO Task 12: drop detail field; consumers should use subRows[].detail
}

export function buildFamilyRows(
  statistics: ValidationStatistics,
  impossibilityReport: ImpossibilityReport
): FamilyRowData[] {
  type RawRow = {
    cm_id: string
    name: string
    grade: number
    gender: string
    cohort: FamilyCohort
    session: string
    detail: string
  }
  const raw: RawRow[] = []

  for (const c of impossibilityReport.mp_campers_entirely_impossible ?? []) {
    raw.push({
      cm_id: String(c.cm_id),
      name: c.name,
      grade: c.grade ?? 0,
      gender: c.gender ?? '',
      cohort: 'got_nothing',
      session: String(c.session_cm_id), // normalize number → string
      detail: `All requests impossible · ${c.reason_codes.map(friendlyReasonLabel).join(', ')}`,
    })
  }
  for (const v of statistics.negative_request_violations_detail ?? []) {
    raw.push({
      cm_id: v.requester_cm_id,
      name: v.requester_name,
      grade: v.requester_grade ?? 0, // null sorts as 0
      gender: '',
      cohort: 'violated',
      session: v.session_cm_id, // already string
      detail: `Placed with ${v.target_name} in ${v.bunk_name}`,
    })
  }
  for (const p of statistics.priority_unsuccessfuls ?? []) {
    raw.push({
      cm_id: p.requester_cm_id,
      name: p.requester_name,
      grade: p.requester_grade ?? 0,
      gender: '',
      cohort: 'priority_unmet',
      session: p.session_cm_id, // already string
      detail: `Wanted ${p.target_name} · "${p.raw_text}"`,
    })
  }

  // Collapse per-(cm_id, cohort)
  const grouped = new Map<string, FamilyRowData>()
  for (const r of raw) {
    const key = `${r.cm_id}-${r.cohort}`
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.sessions.includes(r.session)) existing.sessions.push(r.session)
      existing.subRows.push({ session: r.session, detail: r.detail })
    } else {
      grouped.set(key, {
        key,
        name: r.name,
        cm_id: r.cm_id,
        grade: r.grade,
        gender: r.gender,
        cohort: r.cohort,
        sessions: [r.session],
        subRows: [{ session: r.session, detail: r.detail }],
        detail: r.detail, // transitional — Task 12 removes; equals subRows[0].detail
      })
    }
  }

  // Grade-first sort, name tiebreak
  return [...grouped.values()].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name))
}

export const cohortLabel = (c: FamilyCohort): string =>
  c === 'got_nothing'
    ? 'Got nothing'
    : c === 'violated'
      ? 'Not-bunk-with violated'
      : 'Priority unmet'
