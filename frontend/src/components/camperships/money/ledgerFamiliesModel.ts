/**
 * Money › Ledger's family rows and the lines behind its totals (spec §8.1; D26, D97, D151; P-22,
 * owner ruling F; money-v2.html Ledger). Pure. Every figure is the server's; the filters and the
 * day go to the server, and the lines read gets exactly the family read's.
 */
import type {
  ApiAidLedgerLevel,
  ApiAidLedgerTotal,
  ApiAidSourceRow,
} from '../../../types/api-types'
import { asOfQuery, type AidAsOf } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatMoney } from '../kit/money'
import type { PillTone } from '../kit/kitStyles'

/**
 * The level where a family's money isn't on a request (P-22), in staff's words. `satisfies`
 * against the generated union: a new level fails tsc here.
 */
export const LEDGER_LEVEL_WORDS = {
  household: 'household level',
  left: 'left at family level',
  no_request: 'no request',
  program_mismatch: 'program mismatch',
} as const satisfies Record<ApiAidLedgerLevel, string>

/** The pill each level wears (money-v2.html: no request red, the rest amber). */
export const LEDGER_LEVEL_TONE = {
  household: 'amber',
  left: 'amber',
  no_request: 'red',
  program_mismatch: 'amber',
} as const satisfies Record<ApiAidLedgerLevel, PillTone>

export const LEDGER_LEVELS = Object.keys(LEDGER_LEVEL_WORDS) as ApiAidLedgerLevel[]

const isLevel = (value: string): value is ApiAidLedgerLevel =>
  Object.hasOwn(LEDGER_LEVEL_WORDS, value)

/** The two totals, as the footer and the lines' heading name them. */
export const LEDGER_TOTAL_WORDS = {
  in_campminder_net: 'In CampMinder (net)',
  outside_grants: 'Outside grants',
} as const satisfies Record<ApiAidLedgerTotal, string>

export const parseLinesTotal = (raw: string | null): ApiAidLedgerTotal | null =>
  raw === 'in_campminder_net' || raw === 'outside_grants' ? raw : null

/** The Ledger's filters, as the URL holds them (`?source=`, `?program=`, `?level=`); null is all. */
export interface LedgerFilters {
  readonly source: string | null
  readonly program: string | null
  readonly level: ApiAidLedgerLevel | null
}

const present = (value: string | null) => (value === null || value === '' ? null : value)

export function parseLedgerFilters(params: URLSearchParams): LedgerFilters {
  const level = params.get('level')
  return {
    source: present(params.get('source')),
    program: present(params.get('program')),
    level: level !== null && isLevel(level) ? level : null,
  }
}

/**
 * What both reads send: the page's day (with its axis) and each filter set. The family read and
 * the lines read take the same object, so a total opens exactly the lines it adds up (ruling F).
 */
export function ledgerParams(filters: LedgerFilters, asOf: AidAsOf): Record<string, string> {
  return {
    ...asOfQuery(asOf),
    ...(filters.source === null ? {} : { source: filters.source }),
    ...(filters.program === null ? {} : { program: filters.program }),
    ...(filters.level === null ? {} : { level: filters.level }),
  }
}

/** The Source filter's choices: the source families the registry holds, never "" (P-22). */
export function sourceFamilyOptions(rows: readonly ApiAidSourceRow[]): string[] {
  return [...new Set(rows.map((r) => r.source_family))].filter((f) => f !== '').sort()
}

/**
 * A select's choices plus the value the URL sends when none of them is it (a stale or hand-edited
 * `?source=`/`?program=`): what is sent is what is shown, so the select never says "all" over a
 * filtered read.
 */
export function withSentValue(
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  sent: string | null,
  label: (key: string) => string
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  if (sent === null || options.some((o) => o.value === sent)) return options
  return [...options, { value: sent, label: label(sent) }]
}

/** "6 · 2 reversed", or "3". */
export function linesWords(lines: number, reversed: number): string {
  return reversed > 0 ? `${String(lines)} · ${String(reversed)} reversed` : String(lines)
}

const filterWords = (filters: LedgerFilters) =>
  [filters.source, filters.program, filters.level].filter((f): f is string => f !== null)

export function ledgerCsvName(year: number, filters: LedgerFilters, asOf: string | null): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'ledger',
    filters: filterWords(filters),
    season: year,
    asOf,
  })
}

export function ledgerLinesCsvName(
  year: number,
  total: ApiAidLedgerTotal,
  filters: LedgerFilters,
  asOf: string | null
): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'ledger',
    filters: [`${LEDGER_TOTAL_WORDS[total]} lines`, ...filterWords(filters)],
    season: year,
    asOf,
  })
}

/**
 * The family footer's note on money not yet classified (coordinator ruling 2026-10-08). The family
 * read counts an unclassified line as an outside grant until it is classified, while `GET /summary`
 * splits it out; the summary is season-wide, so under any filter the note names no amount. The
 * figure is the summary's, never summed here.
 */
export function unclassifiedNote(
  unclassified: number | null | undefined,
  filtered: boolean
): string | null {
  if (!unclassified || unclassified <= 0) return null
  return filtered
    ? 'may include money not yet classified'
    : `includes ${formatMoney(unclassified)} not yet classified`
}
