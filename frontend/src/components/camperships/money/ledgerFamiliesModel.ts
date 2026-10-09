/**
 * Money › Ledger's family rows and the lines behind its totals (spec §8.1; D26, D97, D151; P-22,
 * owner ruling F; money-v2.html Ledger). Pure. Every figure is the server's; the filters and the
 * day go to the server, and the lines read gets exactly the family read's.
 */
import { sessionName } from '../../../utils/sessionName'
import type { ApiAidLedgerLevel, ApiAidLedgerTotal } from '../../../types/api-types'
import { asOfQuery, type AidAsOf } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatMoney } from '../kit/money'
import type { PillTone } from '../kit/kitStyles'
import type { AidPickerOption } from '../kit/pickerWords'

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

/**
 * A picker's choices plus the value the URL sends when none of them is it (a stale or hand-edited
 * `?source=`/`?program=`): what is sent is what is shown, so the picker never says "All" over a
 * filtered read. It sits right after All, as the Requests picker does for a stale value.
 */
export function withAllAndSent(
  options: ReadonlyArray<AidPickerOption<string>>,
  sent: string | null,
  label: (key: string) => string
): ReadonlyArray<AidPickerOption<string>> {
  if (sent === null || options.some((o) => o.value === sent)) return options
  const [all, ...rest] = options
  return [...(all ? [all] : []), { value: sent, label: label(sent) }, ...rest]
}

const CAMP_FAMILY = 'camp_fa'
const UNCLASSIFIED_FAMILY = 'unclassified'

/**
 * The Source picker's choices (design-language §3; mock `srcOpts`): All; the camp's own aid; under
 * "Outside grants", "Every outside grant" (`source=outside`, #3107) and then each outside source
 * family; "Not classified" only while the season has some. The registry's families are the words.
 */
export function sourcePickerOptions(
  families: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  sent: string | null,
  hasUnclassified: boolean
): ReadonlyArray<AidPickerOption<string>> {
  const camp = families.find((f) => f.value === CAMP_FAMILY)
  const unclassified = families.find((f) => f.value === UNCLASSIFIED_FAMILY)
  const showUnclassified = hasUnclassified || sent === UNCLASSIFIED_FAMILY
  return [
    { value: '', label: 'All' },
    ...(camp ? [{ ...camp, group: "The camp's own" }] : []),
    { value: 'outside', label: 'Every outside grant', group: 'Outside grants' },
    ...families
      .filter((f) => f.value !== CAMP_FAMILY && f.value !== UNCLASSIFIED_FAMILY)
      .map((f) => ({ ...f, group: 'Outside grants' })),
    ...(showUnclassified
      ? [
          {
            value: UNCLASSIFIED_FAMILY,
            label: unclassified?.label ?? 'Not yet classified',
            group: 'Not classified',
          },
        ]
      : []),
  ]
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
 * The total row's note on money not yet classified (coordinator ruling 2026-10-08; mock `unclWords`).
 * The family read counts an unclassified line as an outside grant until it is classified, while
 * `GET /summary` splits it out; the summary is season-wide, so under any filter the note names no
 * amount. The figure is the summary's, never summed here.
 */
export function unclassifiedNote(
  unclassified: number | null | undefined,
  filtered: boolean
): string | null {
  if (!unclassified || unclassified <= 0) return null
  return filtered
    ? 'Outside grants may include money not yet classified'
    : `Outside grants incl. ${formatMoney(unclassified)} not yet classified`
}

/** What the total row's hint says about the totals (mock `TIP`), in the label's title. */
export const TOTALS_TIP =
  'Each total opens its lines. The totals follow the filters, not the search.'

/** "4 families" / "1 family": the total row's label. */
export const familiesWords = (n: number): string =>
  `${String(n)} ${n === 1 ? 'family' : 'families'}`

/** An opening total's native title. */
export const totalOpenTitle = (total: ApiAidLedgerTotal): string =>
  `${LEDGER_TOTAL_WORDS[total]}: open the lines behind it`

/** The total row's last cell: the unclassified note, else the muted hint; the title carries the tip. */
export function footNoteWords(
  unclassified: number | null | undefined,
  filtered: boolean
): { words: string; title: string } {
  const note = unclassifiedNote(unclassified, filtered)
  return note === null
    ? { words: 'each total opens its lines', title: TOTALS_TIP }
    : { words: note, title: `${note}. ${TOTALS_TIP}` }
}

/** The lines card's heading row: "In CampMinder (net) $6,400" and "the 5 lines behind it, 2 reversed (struck, not counted)". */
export function linesHeading(
  total: ApiAidLedgerTotal,
  amount: number,
  lines: number,
  reversed: number
): { title: string; desc: string } {
  const reversedWords = reversed === 0 ? '' : `, ${String(reversed)} reversed (struck, not counted)`
  return {
    title: `${LEDGER_TOTAL_WORDS[total]} ${formatMoney(amount)}`,
    desc: `the ${String(lines)} ${lines === 1 ? 'line' : 'lines'} behind it${reversedWords}`,
  }
}

/** A household request's session in the tiny form ("FC4"), the one entry point for session names (#2763). */
export const householdSessionTiny = (s: { name: string; session_type: string }): string =>
  sessionName(s.name, s.session_type, 'tiny')

/** Family Camp household rows' Campers cell (mock `campersCell`): the campers, then "FC4, WW · household". */
export function householdCampersWords(
  campers: readonly string[],
  sessions: ReadonlyArray<{ name: string; session_type: string }>
): string {
  const tiny = [...new Set(sessions.map(householdSessionTiny))].join(', ')
  return [...(campers.length > 0 ? [campers.join(', ')] : []), `${tiny} · household`].join(' · ')
}
