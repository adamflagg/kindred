/**
 * The Register's filters (spec §8.2; ruling G; money-grants.html): the Show switcher, the grantor and the program,
 * all in the URL (`?show=`, `?grantor=`, `?program=`). Pure, and apart from the table on purpose: the
 * owner's 10-06 direction reworks these chips toward the Requests tab's waterfall and outliers (a mock
 * comes first), and that rework replaces this module, not the table.
 */
import type { ApiAidGrantRow } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { countsInTotal, didntApply, isAfterOffer, isHouseholdLevel } from './registerModel'

const OTHER_PROGRAM = 'Other program'

export type RegisterShow =
  | 'all'
  | 'in-cm'
  | 'committed'
  | 'household'
  | 'didnt-apply'
  | 'cancelled'
  | 'after-offer'
  | 'not-counted'

/**
 * The Show switcher (design-language §18; money-grants.html), in the mock's order: All · In CM ·
 * Committed · not in CM · Household level · Didn't apply · Cancelled · After the offer (ruling G) ·
 * Not counted (★17). Each carries the words behind it as its title.
 */
export const REGISTER_SHOWS: ReadonlyArray<{
  readonly value: RegisterShow
  readonly label: string
  readonly title: string
}> = [
  {
    value: 'all',
    label: 'All',
    title: 'Every outside grant in CampMinder this season, plus commitments entered by hand',
  },
  { value: 'in-cm', label: 'In CM', title: 'In CampMinder: a ledger line carries it' },
  {
    value: 'committed',
    label: 'Committed · not in CM',
    title:
      'Committed by hand, not yet posted in CampMinder. Post it there: the next ledger sync matches it and it leaves this choice',
  },
  {
    value: 'household',
    label: 'Household level',
    title: "A line on no camper in a household that isn't a household program",
  },
  {
    value: 'didnt-apply',
    label: "Didn't apply",
    title: 'A family with no aid request this season: the grant counts and offsets nothing',
  },
  {
    value: 'cancelled',
    label: 'Cancelled',
    title: 'The camper cancelled (from CampMinder enrollment)',
  },
  {
    value: 'after-offer',
    label: 'After the offer',
    title: 'Known after Round 1 posted: extra for the family',
  },
  {
    value: 'not-counted',
    label: 'Not counted',
    title:
      'Left out of the total: a reversed line, a line waiting for its camper, or a commitment whose camper cancelled',
  },
]

export function matchesShow(
  row: ApiAidGrantRow,
  show: RegisterShow,
  needsCamper: ReadonlySet<number>
): boolean {
  switch (show) {
    case 'all':
      return true
    case 'in-cm':
      return row.kind === 'ledger'
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
    case 'not-counted':
      return !countsInTotal(row, needsCamper)
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
    'in-cm': count('in-cm'),
    committed: count('committed'),
    household: count('household'),
    'didnt-apply': count('didnt-apply'),
    cancelled: count('cancelled'),
    'after-offer': count('after-offer'),
    'not-counted': count('not-counted'),
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

/** The programs on the Register, by the server's `program_label` ("Other program" when it sends none), in pool order. */
export function programChoices(
  rows: readonly ApiAidGrantRow[],
  rank: (program: string) => number = () => 0
): FilterChoice[] {
  const labels = new Map<string, string>()
  for (const row of rows) {
    if (row.program_family === '') continue
    const label = row.program_label ?? ''
    if (label !== '' || !labels.has(row.program_family)) {
      labels.set(row.program_family, label === '' ? OTHER_PROGRAM : label)
    }
  }
  // Pool order (the rules'), then A to Z: the Ledger's Program picker reads the same way.
  return [...labels]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.label.localeCompare(b.label))
}

/** D70's file name: the chip, then the grantor and program picked. */
export function registerCsvName(year: number, filters: RegisterFilters): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'grants',
    filters: [
      ...(filters.show === 'all' ? [] : [filters.show]),
      ...(filters.grantor === null ? [] : [filters.grantor]),
      ...(filters.program === null ? [] : [filters.program]),
    ],
    season: year,
  })
}
