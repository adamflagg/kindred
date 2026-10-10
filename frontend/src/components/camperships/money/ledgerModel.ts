/**
 * The Ledger tab's posted totals (inventory F10; money-v2.html `f10()`, Q6 "under the Ledger,
 * folding"; owner 10-08, R3-2): one row per program with camp aid, outside grants and the total, as
 * `GET /summary`'s `by_program` sends them (PR A splits by the posting's funder type on the server),
 * and the mock's line of camp-aid shares. Pure: nothing is added up here (D21).
 */
import type { ApiAidBudget, ApiAidProgramSplit, ApiAidSummary } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { formatMoney } from '../kit/money'

/** The two program buckets the server uses for money no program owns (`program_bucket`). */
const NO_PROGRAM_WORDS: Readonly<Record<string, string>> = {
  ambiguous: 'Household level',
  unattributed: 'Not placed',
}
const BUCKETS_LAST = ['ambiguous', 'unattributed']

/**
 * The mock's words for each camp-aid share (money-v2.html l.145). `satisfies` the generated union:
 * a new group fails tsc here. The server's grouping: `placed` = levels override, decision, session,
 * person, program_family (money on a program's request); `household` = ambiguous only; `not_placed` = none (PR A, Task A3).
 */
const SHARE_WORDS = {
  placed: 'placed on a camper or request',
  household: 'at household level',
  not_placed: 'not placed',
} as const satisfies Record<NonNullable<ApiAidSummary['camp_aid_levels']>[number]['group'], string>

/** Words for a program the server sent no label for and that is not one of the two buckets. */
const OTHER_PROGRAM_WORDS = 'Other program'

/**
 * A program in words (coordinator 10-08): the server's `program_label` (the season's approved
 * rules' label); with none, the two buckets keep their words and any other key reads "Other
 * program". Never a key spelled out.
 */
export function summaryProgramWords(program: string, label?: string | null): string {
  if (label !== undefined && label !== null && label !== '') return label
  return NO_PROGRAM_WORDS[program] ?? OTHER_PROGRAM_WORDS
}

/** The labels the summary sends, by program key (empty labels skipped). */
export function programLabelsOf(summary: ApiAidSummary | undefined): Record<string, string> {
  const labels: Record<string, string> = {}
  const rows = [...(summary?.by_program ?? []), ...(summary?.cells ?? [])]
  for (const row of rows) {
    if (row.program_label !== undefined && row.program_label !== '') {
      labels[row.program] ??= row.program_label
    }
  }
  return labels
}

/**
 * The Ledger's Program filter choices (lead ruling 10-08): only the programs the summary has money
 * under, in the pivot's order, the two no-program buckets left out (`?program=` takes families).
 * A family with money and no label appears once as "Other program". None until the summary loads.
 */
export function programChoicesOf(
  summary: ApiAidSummary | undefined,
  rank: ProgramRank = NO_RANK
): Array<{ value: string; label: string }> {
  if (!summary) return []
  return pivotRows(summary, rank)
    .filter((row) => !BUCKETS_LAST.includes(row.program))
    .map((row) => ({
      value: row.program,
      label: summaryProgramWords(row.program, row.program_label),
    }))
}

/** A program's place in the rules' pool order (`programRank`); every key alike when none is given. */
export type ProgramRank = (program: string) => number
const NO_RANK: ProgramRank = () => 0

/**
 * The pivot's rows in pool order (final audit M-E8; R3-10): programs grouped by their budget pool,
 * the rules' order inside a pool, then any tie A to Z; then "Household level" and "Not placed" last.
 */
export function pivotRows(
  summary: ApiAidSummary,
  rank: ProgramRank = NO_RANK
): ApiAidProgramSplit[] {
  const place = (program: string) => {
    const bucket = BUCKETS_LAST.indexOf(program)
    return bucket >= 0 ? Number.MAX_SAFE_INTEGER - BUCKETS_LAST.length + bucket : rank(program)
  }
  return [...(summary.by_program ?? [])].sort(
    (a, b) => place(a.program) - place(b.program) || a.program.localeCompare(b.program)
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

export interface TieOut {
  readonly kind: 'match' | 'apart'
  /** Camp aid in CampMinder that counts toward the budget (`counts_toward_budget`, never camp_aid). */
  readonly camp: number
  /** Season › Rounds & budget Posted, every pool (`total.posted`). */
  readonly posted: number
  /** The absolute gap, in dollars; 0 on a match. */
  readonly apart: number
}

const toCents = (dollars: number) => Math.round(dollars * 100)

/** The tie-out line's verdict: the two figures, compared in cents so float noise never shows a gap. */
export function tieOut(summary: ApiAidSummary, budget: ApiAidBudget): TieOut {
  const camp = summary.counts_toward_budget
  const posted = budget.total.total.posted ?? 0
  const gap = Math.abs(toCents(camp) - toCents(posted))
  return { kind: gap === 0 ? 'match' : 'apart', camp, posted, apart: gap / 100 }
}

/**
 * True when To place cannot hold the whole gap, so part of it sits in Requests › Not reconciled
 * (Posted with nothing in CampMinder, or a round short or over): the gap is larger than the open
 * To place total, or Posted is the larger figure (To place only ever adds camp aid). Unknown when
 * the open total is (a past date reads no To place): then no pointer is drawn.
 */
export function gapReachesNotReconciled(t: TieOut, openTotal: number | null): boolean {
  if (t.kind !== 'apart' || openTotal === null) return false
  return toCents(t.posted) > toCents(t.camp) || toCents(t.apart) > toCents(openTotal)
}

/** The tie-out line in words (the check mark is drawn beside a match, not spelled here). */
export function tieOutWords(t: TieOut, openCount: number | null): string {
  const camp = `Camp aid posted ${formatMoney(t.camp)}`
  if (t.kind === 'match') {
    return `${camp} · matches Season › Rounds & budget Posted ${formatMoney(t.posted)}`
  }
  const lines =
    openCount === null ? '' : ` (${String(openCount)} ${openCount === 1 ? 'line' : 'lines'})`
  return `${camp} · Season › Rounds & budget Posted ${formatMoney(t.posted)} · ${formatMoney(t.apart)} apart → see To place${lines}`
}

/** The Unclassified note (mock `NOTE.uncl`): the registry has no entry for it; only its column's season needs it. */
export const UNCLASSIFIED_NOTE =
  "Unclassified: lines whose description Money › Funders hasn't classified yet. The column shows only while the season has some."

/** The tie-out line's note (mock `NOTE.tie`), numbered after the registry's. */
export const TIE_OUT_NOTE =
  'The tie-out line: camp aid that counts toward the budget, against Season › Rounds & budget Posted, every pool. A gap is camp aid in To place, a round short or over (Requests › Not reconciled), or a round checked since the last sync.'

/**
 * The page's own notes and their numbers (mock `noteKeys`/`noteNo`): after the registry's `base`
 * notes, Unclassified only while the season has some, then the tie-out. Max 6 (§12): 4 here. With
 * the registry not loaded (`base` 0) no number is known, so none is drawn.
 */
export function ledgerNoteMarks(
  base: number,
  hasUnclassifiedMoney: boolean
): { unclassified: number | null; tieOut: number | null; extra: string[] } {
  if (base === 0) return { unclassified: null, tieOut: null, extra: [] }
  const unclassified = hasUnclassifiedMoney ? base + 1 : null
  return {
    unclassified,
    tieOut: base + (hasUnclassifiedMoney ? 2 : 1),
    extra: [...(hasUnclassifiedMoney ? [UNCLASSIFIED_NOTE] : []), TIE_OUT_NOTE],
  }
}
