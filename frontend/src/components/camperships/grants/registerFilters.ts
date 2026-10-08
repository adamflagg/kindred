/**
 * The Register's filters (spec §8.2; ruling G; grants-v2.html): the chips, the grantor and the program,
 * all in the URL (`?show=`, `?grantor=`, `?program=`). Pure, and apart from the table on purpose: the
 * owner's 10-06 direction reworks these chips toward the Requests tab's waterfall and outliers (a mock
 * comes first), and that rework replaces this module, not the table.
 */
import type { ApiAidGrantRow } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { programLabel } from '../requests/programLabel'
import { didntApply, isAfterOffer, isHouseholdLevel } from './registerModel'

export type RegisterShow =
  'all' | 'committed' | 'household' | 'didnt-apply' | 'cancelled' | 'after-offer'

/** The chips, in the mock's order, then ruling G's "After the offer". Sentence case: chips. */
export const REGISTER_SHOWS: ReadonlyArray<{
  readonly value: RegisterShow
  readonly label: string
}> = [
  { value: 'all', label: 'All' },
  { value: 'committed', label: 'Committed, not yet in CampMinder' },
  { value: 'household', label: 'Household level' },
  { value: 'didnt-apply', label: "Didn't apply" },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'after-offer', label: 'After the offer' },
]

export function matchesShow(
  row: ApiAidGrantRow,
  show: RegisterShow,
  needsCamper: ReadonlySet<number>
): boolean {
  switch (show) {
    case 'all':
      return true
    case 'committed':
      return row.kind === 'commitment'
    case 'household':
      return isHouseholdLevel(row)
    case 'didnt-apply':
      return didntApply(row, needsCamper)
    case 'cancelled':
      return row.cancelled
    case 'after-offer':
      return isAfterOffer(row)
  }
}

/** `?grantor=none`: lines whose description names no grantor yet. */
export const NO_GRANTOR = 'none'

export interface RegisterFilters {
  readonly show: RegisterShow
  /** A grantor key, NO_GRANTOR, or null for every grantor. */
  readonly grantor: string | null
  /** A program family key, or null for every program. */
  readonly program: string | null
}

export function readRegisterFilters(params: URLSearchParams): RegisterFilters {
  const raw = params.get('show')
  const show = REGISTER_SHOWS.find((s) => s.value === raw)?.value ?? 'all'
  return { show, grantor: params.get('grantor'), program: params.get('program') }
}

/** The grantor and program filters, without the chip: what the chips count over. */
function matchesPickers(row: ApiAidGrantRow, filters: RegisterFilters): boolean {
  const grantor = filters.grantor === NO_GRANTOR ? '' : filters.grantor
  return (
    (grantor === null || row.grantor_key === grantor) &&
    (filters.program === null || row.program_family === filters.program)
  )
}

export function filterRegister(
  rows: readonly ApiAidGrantRow[],
  filters: RegisterFilters,
  needsCamper: ReadonlySet<number>
): ApiAidGrantRow[] {
  return rows.filter(
    (row) => matchesPickers(row, filters) && matchesShow(row, filters.show, needsCamper)
  )
}

/** Each chip's count: the rows clicking it would show under the grantor and program picked. */
export function showCounts(
  rows: readonly ApiAidGrantRow[],
  filters: RegisterFilters,
  needsCamper: ReadonlySet<number>
): Readonly<Record<RegisterShow, number>> {
  const picked = rows.filter((row) => matchesPickers(row, filters))
  const count = (show: RegisterShow) =>
    picked.filter((row) => matchesShow(row, show, needsCamper)).length
  return {
    all: picked.length,
    committed: count('committed'),
    household: count('household'),
    'didnt-apply': count('didnt-apply'),
    cancelled: count('cancelled'),
    'after-offer': count('after-offer'),
  }
}

export interface FilterChoice {
  readonly value: string
  readonly label: string
}

/** The grantors on the Register, by name; "No grantor yet" for an unmapped description's lines. */
export function grantorChoices(rows: readonly ApiAidGrantRow[]): FilterChoice[] {
  const seen = new Map<string, string>()
  for (const row of rows) {
    const value = row.grantor_key === '' ? NO_GRANTOR : row.grantor_key
    if (!seen.has(value))
      seen.set(value, row.grantor_key === '' ? 'No grantor yet' : row.grantor_name)
  }
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** The programs on the Register, in the rules' words (D31); a row with no program offers none. */
export function programChoices(
  rows: readonly ApiAidGrantRow[],
  names: Readonly<Record<string, string>>
): FilterChoice[] {
  const keys = new Set(rows.map((r) => r.program_family).filter((key) => key !== ''))
  return [...keys]
    .map((value) => ({ value, label: programLabel(names, value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** D70's file name: the chip, then the grantor and program picked. */
export function registerCsvName(year: number, filters: RegisterFilters): string {
  return aidCsvFilename({
    surface: 'grants',
    view: 'register',
    filters: [
      ...(filters.show === 'all' ? [] : [filters.show]),
      ...(filters.grantor === null ? [] : [filters.grantor]),
      ...(filters.program === null ? [] : [filters.program]),
    ],
    season: year,
  })
}
