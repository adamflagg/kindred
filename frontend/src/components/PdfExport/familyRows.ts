import type { ValidationStatistics, ImpossibilityReport } from '../../services/solver'
import { friendlyReasonLabel } from '../impossibility/reasonHints'

export type FamilyCohort = 'got_nothing' | 'violated' | 'priority_unmet'
export type FamilyRowData = {
  key: string
  name: string
  cm_id: string
  grade: number
  gender: string
  cohort: FamilyCohort
  detail: string
}

export function buildFamilyRows(
  statistics: ValidationStatistics,
  impossibilityReport: ImpossibilityReport,
): FamilyRowData[] {
  const rows: FamilyRowData[] = []

  for (const c of impossibilityReport.mp_campers_entirely_impossible ?? []) {
    rows.push({
      key: `gn-${c.cm_id}`,
      name: c.name,
      cm_id: String(c.cm_id),
      grade: c.grade,
      gender: c.gender,
      cohort: 'got_nothing',
      detail: `All requests impossible · ${c.reason_codes.map(friendlyReasonLabel).join(', ')}`,
    })
  }
  for (const v of statistics.negative_request_violations_detail ?? []) {
    rows.push({
      key: `nv-${v.requester_cm_id}-${v.target_cm_id}-${v.bunk_cm_id}`,
      name: v.requester_name,
      cm_id: v.requester_cm_id,
      grade: 0,
      gender: '',
      cohort: 'violated',
      detail: `Placed with ${v.target_name} in ${v.bunk_name}`,
    })
  }
  for (const p of statistics.priority_unsuccessfuls ?? []) {
    rows.push({
      key: `pu-${p.requester_cm_id}-${p.target_cm_id}`,
      name: p.requester_name,
      cm_id: p.requester_cm_id,
      grade: 0,
      gender: '',
      cohort: 'priority_unmet',
      detail: `Wanted ${p.target_name} · "${p.raw_text}"`,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.grade - b.grade)
  return rows
}

export const cohortLabel = (c: FamilyCohort): string =>
  c === 'got_nothing' ? 'Got nothing' : c === 'violated' ? 'Not-bunk-with violated' : 'Priority unmet'
