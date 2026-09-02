import type { ValidationStatistics, ImpossibilityReport } from '../../services/solver'
import { friendlyReasonLabel } from '../impossibility/reasonHints'
import { isMaterialRequest } from '../../utils/requestBucket'

export type FamilyCohort =
  'got_nothing' | 'violated' | 'priority_unmet' | 'sacrificed_mp' | 'impossible_request'

export type FamilySubRow = {
  session: string
  detail: string
  // Structured per-sub-row data used by the modal for rich JSX rendering.
  // Avoids re-deriving via .find() which breaks when a camper has N violations
  // in the same session (all N sub-rows share the same requester+session key).
  targetName?: string
  bunkName?: string
  rawText?: string
  reasonCodes?: string[]
  honoredInPlan?: boolean
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
    // Structured per-entry data carried into sub-rows for rich modal rendering.
    targetName?: string
    bunkName?: string
    rawText?: string
    reasonCodes?: string[]
    honoredInPlan?: boolean
  }
  const raw: RawRow[] = []

  // Prefer the post-response cohort (carries honored_in_plan, reconciled against
  // the final plan); fall back to the pre-check report only when the field is
  // absent entirely (e.g. PDF export from a pre-check, or post-check before this
  // field shipped). An explicit empty array is authoritative — "zero impossible
  // campers" — and must NOT resurface stale pre-check rows.
  const statsCohort = statistics.mp_campers_entirely_impossible
  if (statsCohort !== undefined) {
    for (const c of statsCohort) {
      if (c.fully_honored) continue // #1716: got their whole material ask — drop (modal footer counts these)
      const partial = Boolean(c.honored_in_plan && !c.fully_honored)
      raw.push({
        cm_id: String(c.cm_id),
        name: c.name,
        grade: c.grade ?? 0,
        gender: c.gender ?? '',
        cohort: partial ? 'sacrificed_mp' : 'got_nothing',
        session: String(c.session_cm_id),
        detail: partial
          ? `Material request unmet · ${c.reason_codes.map(friendlyReasonLabel).join(', ')}`
          : `All requests impossible · ${c.reason_codes.map(friendlyReasonLabel).join(', ')}`,
        reasonCodes: c.reason_codes,
        honoredInPlan: c.honored_in_plan,
        ...(c.bunk_name ? { bunkName: c.bunk_name } : {}),
      })
    }
  } else {
    for (const c of impossibilityReport.mp_campers_entirely_impossible ?? []) {
      raw.push({
        cm_id: String(c.cm_id),
        name: c.name,
        grade: c.grade ?? 0,
        gender: c.gender ?? '',
        cohort: 'got_nothing',
        session: String(c.session_cm_id), // normalize number → string
        detail: `All requests impossible · ${c.reason_codes.map(friendlyReasonLabel).join(', ')}`,
        reasonCodes: c.reason_codes,
      })
    }
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
      targetName: v.target_name,
      bunkName: String(v.bunk_name),
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
      targetName: p.target_name,
      rawText: p.raw_text,
    })
  }
  // Stream D Phase 3: campers whose material-parent request was sacrificed by break-glass
  // (placed but request left unmet). One raw entry per unmet request; deduplicated by
  // (cm_id, cohort) into one row per camper (multiple unmet requests become subRows).
  for (const s of statistics.unsatisfied_material_parent_detail ?? []) {
    let detail: string
    if (s.request_type === 'bunk_with') {
      detail = `Material request unmet: wanted to bunk with ${s.target_name}`
    } else if (s.request_type === 'not_bunk_with') {
      detail = `Material request unmet: wanted to NOT bunk with ${s.target_name}`
    } else if (s.request_type === 'age_preference') {
      detail = `Material request unmet: age preference (${s.target_name})`
    } else {
      // Future request types — produce a safe generic label rather than silently dropping.
      detail = `Material request unmet: ${s.target_name}`
    }
    raw.push({
      cm_id: s.requester_cm_id,
      name: s.requester_name,
      grade: 0, // unsatisfied_material_parent_detail carries no grade field
      gender: '',
      cohort: 'sacrificed_mp',
      session: s.requester_bunk_name, // use requester bunk as session proxy (no session_cm_id here)
      detail,
      targetName: s.target_name,
      bunkName: s.requester_bunk_name,
    })
  }

  // #1717: fold the full pre-check impossibility detail into Families to contact.
  // Mirror the pre-check filter EXACTLY: PreValidationResultsModal hides
  // socialize_with rows (isMaterialRequest=false) ONLY for the
  // age_pref_no_eligible_grade reason (Group 65 #1537); every other reason shows
  // all items. The modal never filters by bucket directly — source_field is the
  // actual predicate, and only for that one reason. Items already surfaced via a
  // cohort row are skipped to avoid duplication.
  const seenCmIds = new Set(raw.map((r) => r.cm_id))
  for (const item of impossibilityReport.flat ?? []) {
    // Parity with pre-check: only socialize_with rows under age_pref are hidden;
    // a socialize_with friend who isn't enrolled (target_not_in_solver) is still
    // shown by the pre-check, so it must survive the fold-in too.
    if (
      item.reason_code === 'age_pref_no_eligible_grade' &&
      !isMaterialRequest({ source_field: item.source_field })
    )
      continue
    const cmId = String(item.requester.cm_id)
    if (seenCmIds.has(cmId)) continue // already surfaced via a cohort — don't duplicate
    raw.push({
      cm_id: cmId,
      // requester.name is absent when the requester isn't in the solver's
      // roster (kindred#2689) — fall back to a "#<cm_id>" identifier rather
      // than an empty string, matching the precedent at
      // RequestReviewPanel.tsx:671,957 for an unresolved requester.
      name: item.requester.name ?? `#${item.requester.cm_id}`,
      grade: item.requester.grade ?? 0,
      gender: item.requester.gender ?? '',
      cohort: 'impossible_request',
      session: String((item.detail?.['requester_session'] as number | undefined) ?? ''),
      detail: friendlyReasonLabel(item.reason_code),
      reasonCodes: [item.reason_code],
    })
  }

  // Collapse per-(cm_id, cohort)
  const grouped = new Map<string, FamilyRowData>()
  for (const r of raw) {
    const key = `${r.cm_id}-${r.cohort}`
    const subRow: FamilySubRow = {
      session: r.session,
      detail: r.detail,
      ...(r.targetName !== undefined && { targetName: r.targetName }),
      ...(r.bunkName !== undefined && { bunkName: r.bunkName }),
      ...(r.rawText !== undefined && { rawText: r.rawText }),
      ...(r.reasonCodes !== undefined && { reasonCodes: r.reasonCodes }),
      ...(r.honoredInPlan !== undefined && { honoredInPlan: r.honoredInPlan }),
    }
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.sessions.includes(r.session)) existing.sessions.push(r.session)
      existing.subRows.push(subRow)
    } else {
      grouped.set(key, {
        key,
        name: r.name,
        cm_id: r.cm_id,
        grade: r.grade,
        gender: r.gender,
        cohort: r.cohort,
        sessions: [r.session],
        subRows: [subRow],
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
      : c === 'sacrificed_mp'
        ? 'Request dropped'
        : c === 'impossible_request'
          ? "Request can't be placed"
          : 'Priority unmet'
