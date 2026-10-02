/**
 * Scenarios' compare and trail, laid out (spec §7.4; D38, D138; RPT-17, RPT-32; scenarios-v2.html).
 * Pure. The draft is always the first column, beside up to four ticked kept options; each figure is
 * the server's (`CompareColumnOut`, `CommitteeOut`), each setting changed against the column's own
 * reference reads in amber.
 */
import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type {
  ApiAidCommittee,
  ApiAidCompareColumn,
  ApiAidLastSeason,
} from '../../../../types/api-types'
import { formatMoney } from '../../kit/money'
import { isDollarForDollar } from './scenarioModel'

export const MAX_COMPARED = 4
const CODE = /^[A-Z]+[0-9]*$/

/** `?compare=A1,B2`: the kept options ticked to compare, at most four, in the order ticked. */
export function parseCodes(raw: string | null): string[] {
  const codes = (raw ?? '').split(',').filter((code) => CODE.test(code))
  return [...new Set(codes)].slice(0, MAX_COMPARED)
}

/**
 * Unticking removes one; a fifth tick is refused (the same array comes back, and the tab says so):
 * dropping the oldest would take a column off the screen unasked.
 */
export function toggleCode(codes: readonly string[], code: string): readonly string[] {
  if (codes.includes(code)) return codes.filter((c) => c !== code)
  return codes.length >= MAX_COMPARED ? codes : [...codes, code]
}

/** `?through=deadline` or `?through=2027-02-01` (D138); anything else counts every frozen request. */
export function parseRequestSet(raw: string | null): AidRequestSet {
  if (raw === 'deadline') return { kind: 'deadline' }
  if (raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return { kind: 'date', date: raw }
  return { kind: 'all' }
}

export function requestSetParam(set: AidRequestSet): string | null {
  if (set.kind === 'deadline') return 'deadline'
  return set.kind === 'date' ? set.date : null
}

export interface CompareCell {
  readonly text: string
  /** Differs from the column's reference (the screen's amber). */
  readonly changed: boolean
  readonly negative: boolean
}

export interface CompareRow {
  readonly key: string
  readonly label: string
  readonly cells: readonly CompareCell[]
  /** Said beside the rows above it, never summed into them (Held, In no tier): drawn muted. */
  readonly informational?: boolean
}

const plain = (text: string): CompareCell => ({ text, changed: false, negative: false })
const moneyCell = (value: number | null | undefined): CompareCell => ({
  text: formatMoney(value),
  changed: false,
  negative: value !== null && value !== undefined && value < 0,
})
const changedAt = (column: ApiAidCompareColumn, section: string, key: string) =>
  column.changes.some((change) => change.path[0] === section && change.path[1] === key)

/** The settings rows: what differs, the minimum award, the dollar-for-dollar switch, how many settings moved. */
export function settingRows(columns: readonly ApiAidCompareColumn[]): CompareRow[] {
  return [
    { key: 'label', label: 'What differs', cells: columns.map((c) => plain(c.label)) },
    {
      key: 'minimum',
      label: 'Minimum award',
      cells: columns.map((c) => ({
        ...plain(formatMoney(Number(c.document.awards.minimum))),
        changed: changedAt(c, 'awards', 'minimum'),
      })),
    },
    {
      key: 'dollar',
      label: 'Grants offset dollar-for-dollar',
      cells: columns.map((c) => ({
        ...plain(isDollarForDollar(c.document) ? 'yes' : 'no'),
        changed: changedAt(c, 'grants', 'offset_mode'),
      })),
    },
    {
      key: 'changes',
      label: 'Settings changed',
      cells: columns.map((c) => plain(String(c.changes.length))),
    },
  ]
}

const updown = (up: number | null, down: number | null) =>
  up === null || down === null ? '—' : `▲${String(up)} ▼${String(down)}`

/** The results rows (results.py's meanings), then the committee's Round 1 share of the budget (RPT-17). */
export function resultRows(columns: readonly ApiAidCompareColumn[]): CompareRow[] {
  const committee = (c: ApiAidCompareColumn) => c.committee ?? null
  return [
    { key: 'round1', label: 'Round 1', cells: columns.map((c) => moneyCell(c.results.round1)) },
    {
      key: 'round2',
      label: 'Round 2, appeals keyed so far',
      cells: columns.map((c) => moneyCell(c.results.round2)),
    },
    { key: 'round3', label: 'Round 3', cells: columns.map((c) => moneyCell(c.results.round3)) },
    {
      key: 'round1_remaining',
      label: 'Round 1 remaining',
      cells: columns.map((c) => moneyCell(c.results.round1_remaining)),
    },
    {
      key: 'remaining',
      label: 'Remaining, every round',
      cells: columns.map((c) => moneyCell(c.results.remaining)),
    },
    {
      key: 'at_minimum',
      label: 'At the minimum',
      cells: columns.map((c) => plain(String(c.results.at_minimum))),
    },
    {
      key: 'updown',
      label: 'Requests up / down against its reference',
      cells: columns.map((c) => plain(updown(c.up, c.down))),
    },
    {
      key: 'pct_of_budget',
      label: 'Round 1, % of the total budget',
      cells: columns.map((c) => {
        const pct = committee(c)?.round1_pct_of_budget ?? null
        return plain(pct === null ? '—' : `${String(pct)}%`)
      }),
    },
  ]
}

/** Every tier any column holds, in order: the committee's "All" rows (table null). */
function tiersOf(views: ReadonlyArray<ApiAidCommittee | null>, round: 1 | 2): number[] {
  const tiers = new Set<number>()
  for (const view of views) {
    const rows = round === 1 ? view?.round1_by_tier : view?.round2_by_tier
    for (const row of rows ?? []) if (row.table === null) tiers.add(row.tier)
  }
  return [...tiers].sort((a, b) => a - b)
}

const pctOfAsk = (pct: number | null) => (pct === null ? '' : ` · ${String(pct)}% of ask`)

/**
 * By tier (RPT-17, RPT-32): each tier's money and its share of what was asked, for Round 1 or Round
 * 2, from the committee's "All" rows. A column that holds no row for a tier reads "—".
 */
export function tierRows(views: ReadonlyArray<ApiAidCommittee | null>, round: 1 | 2): CompareRow[] {
  const tiers = tiersOf(views, round).map((tier) => ({
    key: `r${String(round)}:${String(tier)}`,
    label: `Tier ${String(tier)}`,
    cells: views.map((view) => {
      if (round === 1) {
        const row = view?.round1_by_tier.find((r) => r.table === null && r.tier === tier)
        return plain(
          row === undefined ? '—' : `${formatMoney(row.round1)}${pctOfAsk(row.pct_of_ask)}`
        )
      }
      const row = view?.round2_by_tier.find((r) => r.table === null && r.tier === tier)
      return plain(
        row === undefined ? '—' : `${formatMoney(row.round2)}${pctOfAsk(row.pct_of_ask)}`
      )
    }),
  }))
  if (tiers.length === 0) return []

  // What the tier rows leave out, shown only when some column has it (as the Results panel's "In no tier").
  const rows: CompareRow[] = [...tiers]
  const held = views.map((view) => {
    const all = (round === 1 ? view?.round1_by_tier : view?.round2_by_tier)?.filter(
      (r) => r.table === null
    )
    return {
      count: round === 1 ? sum(all, (r) => ('held' in r ? r.held : 0)) : 0,
      asked: sum(all, (r) => r.held_asked),
    }
  })
  if (held.some((h) => h.count !== 0 || h.asked !== 0)) {
    rows.push(
      round === 1
        ? {
            key: 'r1:held',
            label: 'Held',
            cells: held.map((h) => plain(`${String(h.count)} · ${formatMoney(h.asked)} asked`)),
            informational: true,
          }
        : {
            key: 'r2:held',
            label: 'Held',
            cells: held.map((h) => plain(`${formatMoney(h.asked)} asked`)),
            informational: true,
          }
    )
  }
  const none = views.map((view) =>
    round === 1 ? (view?.not_in_tiers ?? 0) : (view?.round2_not_in_tiers ?? 0)
  )
  if (none.some((n) => n !== 0)) {
    rows.push({
      key: `r${String(round)}:none`,
      label: 'In no tier',
      cells: none.map(moneyCell),
      informational: true,
    })
  }
  return rows
}

function sum<T>(rows: readonly T[] | undefined, pick: (row: T) => number): number {
  return (rows ?? []).reduce((total, row) => total + pick(row), 0)
}

/** Last season's column (RPT-17): its posted money, or its label when it isn't loaded (never zeros). */
export function lastSeasonHeading(last: ApiAidLastSeason): string {
  return last.loaded ? `${String(last.year)} as posted` : last.label
}
