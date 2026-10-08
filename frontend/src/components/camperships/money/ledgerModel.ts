/**
 * The Ledger tab's posted totals (inventory F10; money-v2.html `f10()`, Q6 "under the Ledger,
 * folding"; owner 10-08, R3-2): one row per program with camp aid, outside grants and the total, as
 * `GET /summary`'s `by_program` sends them (PR A splits by the posting's funder type on the server),
 * and the mock's line of camp-aid shares. Pure: nothing is added up here (D21).
 */
import type { ApiAidProgramSplit, ApiAidSummary } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { formatMoney } from '../kit/money'
import { programLabel } from '../requests/programLabel'

/** The two program buckets the server uses for money no program owns (`program_bucket`). */
const NO_PROGRAM_WORDS: Readonly<Record<string, string>> = {
  ambiguous: 'Household level',
  unattributed: 'Not placed',
}
const BUCKETS_LAST = ['ambiguous', 'unattributed']

/**
 * The mock's words for each camp-aid share (money-v2.html l.145). `satisfies` the generated union:
 * a new group fails tsc here. The server's grouping: `placed` = levels override, decision, session,
 * person; `household` = program_family, ambiguous; `not_placed` = none (PR A, Task A3).
 */
const SHARE_WORDS = {
  placed: 'placed on a request',
  household: 'at household level',
  not_placed: 'not placed',
} as const satisfies Record<NonNullable<ApiAidSummary['camp_aid_levels']>[number]['group'], string>

/** A program in words: the rules' label, or the server's no-program bucket. */
export function summaryProgramWords(program: string, names: Readonly<Record<string, string>>) {
  return NO_PROGRAM_WORDS[program] ?? programLabel(names, program)
}

/**
 * The pivot's rows in the rules' order (R3-10): the programs the rules name, as the rules list them;
 * then any other program, A to Z; then "Household level" and "Not placed" last.
 */
export function pivotRows(
  summary: ApiAidSummary,
  names: Readonly<Record<string, string>>
): ApiAidProgramSplit[] {
  const named = Object.keys(names)
  const rank = (program: string) => {
    const bucket = BUCKETS_LAST.indexOf(program)
    if (bucket >= 0) return named.length + 1 + bucket
    const at = named.indexOf(program)
    return at >= 0 ? at : named.length
  }
  return [...(summary.by_program ?? [])].sort(
    (a, b) => rank(a.program) - rank(b.program) || a.program.localeCompare(b.program)
  )
}

/** "placed on a request: 91% · … (each share of camp aid)": the server's shares, whole percents. */
export function shareWords(summary: ApiAidSummary): string {
  const levels = summary.camp_aid_levels ?? []
  if (levels.length === 0) return ''
  const parts = levels.map((l) => `${SHARE_WORDS[l.group]}: ${String(Math.round(l.share * 100))}%`)
  return `${parts.join(' · ')} (each share of camp aid)`
}

/** The mock's foot line under the pivot, every figure the server's. */
export function footWords(summary: ApiAidSummary): string {
  const shares = shareWords(summary)
  return `Counts toward the budget: ${formatMoney(summary.counts_toward_budget)}${shares === '' ? '' : ` · ${shares}`}. Undated postings: ${String(summary.undated_postings ?? 0)}.`
}

/** Whether to draw the Unclassified column: only a season with a line nobody classified has one. */
export const hasUnclassified = (summary: ApiAidSummary) => (summary.unclassified ?? 0) !== 0

/**
 * Review item 24: only when the read's levels are CampMinder's own attribution (a past date, or a
 * season before placements) does a split placement still read as household level.
 */
export function splitWords(summary: ApiAidSummary): string | null {
  return summary.by_level_basis === 'attribution'
    ? "A split placement still counts at household level here: this view reads CampMinder's own attribution, not the placements made in To place."
    : null
}

export function summaryCsvName(year: number, asOf: string | null): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'ledger',
    filters: ['posted by program and source'],
    season: year,
    asOf,
  })
}
