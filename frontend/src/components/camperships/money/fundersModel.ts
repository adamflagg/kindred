/**
 * Money › Funders' model (owner 10-08; mock q2): the registry of CampMinder descriptions and the
 * grantor directory merged into one flat list grouped by who pays. Camp first, then each active
 * funder A to Z with its descriptions under it, then "No funder yet" (an outside or unclassified
 * description no visible funder claims). Pure: the screen draws what this builds.
 */
import type { ApiAidGrantor, ApiAidSourceRow } from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { CANTEEN_WORDS, isRetired, seasonAmount, seasonCount } from '../grants/grantorModel'
import { familyWordsOf, isUnclassified } from './sourcesModel'

export type FundersShow = 'all' | 'needs-group' | 'no-funder'

/** `?show=`. */
export function parseFundersShow(raw: string | null): FundersShow {
  if (raw === 'needs-group') return 'needs-group'
  return raw === 'no-funder' ? 'no-funder' : 'all'
}

export const CAMP_ID = 'group:camp'
export const NONE_ID = 'group:none'
export const funderId = (key: string) => `funder:${key}`

/** `?funder=<key>` opens a funder's header; a group header or an empty row keeps its own id. */
export const funderParamOfId = (id: string) => (id.startsWith('funder:') ? id.slice(7) : id)
export const funderIdOfParam = (param: string) =>
  param.startsWith('group:') ? param : funderId(param)

export interface FunderHeader {
  readonly kind: 'funder'
  readonly id: string
  /** Camp, an outside funder, or the "No funder yet" group. */
  readonly tone: 'camp' | 'funder' | 'none'
  readonly name: string
  /** The grantor behind an outside funder's header. */
  readonly grantor: ApiAidGrantor | null
  readonly descriptions: readonly ApiAidSourceRow[]
  readonly lines: number | null
  readonly amount: number | null
  readonly retired: boolean
}
export interface FunderDescription {
  readonly kind: 'description'
  readonly id: string
  readonly source: ApiAidSourceRow
  readonly funderId: string
  readonly funderName: string
}
/** The muted line under a funder no CampMinder description sits under yet. */
export interface FunderEmpty {
  readonly kind: 'empty'
  readonly id: string
  readonly funderId: string
  readonly funderName: string
}
export type FunderRow = FunderHeader | FunderDescription | FunderEmpty

export interface FunderCounts {
  readonly funders: number
  readonly descriptions: number
  readonly noFunder: number
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`

/**
 * The switcher's choices (design-language §18; money-funders.html): short words with the counts inside,
 * the long words in each title. Ruling H's "1 with lines this season" sits in Needs a group's title.
 */
export function switcherOptions(
  c: FunderCounts,
  sources: readonly ApiAidSourceRow[]
): Array<{ value: FundersShow; label: string; count: number; title: string }> {
  const needs = sources.filter((r) => r.needs_group === true)
  const live = needs.filter((r) => (r.lines ?? 0) > 0)
  const allWords = `All ${plural(c.funders, 'funder')} · ${plural(c.descriptions, 'description')}`
  return [
    // No funder yet but descriptions to show: a bare 0 would sit over a table of rows, so the count is the
    // descriptions it shows (the title says which).
    c.funders === 0 && c.descriptions > 0
      ? { value: 'all', label: 'All', count: c.descriptions, title: allWords }
      : { value: 'all', label: 'All', count: c.funders, title: allWords },
    {
      value: 'needs-group',
      label: 'Needs a group',
      count: needs.length,
      title: `${plural(needs.length, 'outside source')} with no group · ${String(live.length)} with lines this season`,
    },
    {
      value: 'no-funder',
      label: 'No funder yet',
      count: c.noFunder,
      title: `${plural(c.noFunder, 'description')} no funder claims yet`,
    },
  ]
}

function sum(
  rows: readonly ApiAidSourceRow[],
  pick: (r: ApiAidSourceRow) => number | null | undefined
) {
  const values = rows.map(pick).filter((v): v is number => typeof v === 'number')
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
}

export function buildFunders({
  sources,
  grantors,
  show,
  showRetired,
}: {
  readonly sources: readonly ApiAidSourceRow[]
  readonly grantors: readonly ApiAidGrantor[]
  readonly show: FundersShow
  readonly showRetired: boolean
}): { rows: FunderRow[]; counts: FunderCounts } {
  const visible = grantors
    .filter((g) => showRetired || !isRetired(g))
    .sort((a, b) => a.name.localeCompare(b.name))
  const byKey = new Map(visible.map((g) => [g.key, g] as const))
  const camp = sources.filter((s) => s.funder_type === 'camp')
  const under = new Map<string, ApiAidSourceRow[]>()
  const none: ApiAidSourceRow[] = []
  for (const s of sources) {
    if (s.funder_type === 'camp') continue
    const grantor = byKey.get(s.grantor_key)
    if (s.grantor_key === '' || grantor === undefined) none.push(s)
    else under.set(grantor.key, [...(under.get(grantor.key) ?? []), s])
  }

  const counts: FunderCounts = {
    funders: visible.length + (camp.length > 0 ? 1 : 0),
    descriptions: sources.length,
    noFunder: none.length,
  }

  const keep = (list: readonly ApiAidSourceRow[]) =>
    show === 'needs-group' ? list.filter((s) => s.needs_group === true) : list
  const rows: FunderRow[] = []
  const add = (header: FunderHeader, list: readonly ApiAidSourceRow[]) => {
    for (const source of list) {
      rows.push({
        kind: 'description',
        id: source.id,
        source,
        funderId: header.id,
        funderName: header.name,
      })
    }
  }
  const group = (tone: 'camp' | 'none', list: readonly ApiAidSourceRow[]) => {
    const shown = keep(list)
    if (list.length === 0 || shown.length === 0) return
    const header: FunderHeader = {
      kind: 'funder',
      id: tone === 'camp' ? CAMP_ID : NONE_ID,
      tone,
      name: tone === 'camp' ? 'Camp' : 'No funder yet',
      grantor: null,
      descriptions: list,
      lines: sum(list, (s) => s.lines),
      amount: sum(list, (s) => s.amount),
      retired: false,
    }
    rows.push(header)
    add(header, shown)
  }

  if (show !== 'no-funder') {
    group('camp', camp)
    for (const g of visible) {
      const list = under.get(g.key) ?? []
      const shown = keep(list)
      // A chip that filters descriptions leaves out a funder with none of them.
      if (show !== 'all' && shown.length === 0) continue
      const header: FunderHeader = {
        kind: 'funder',
        id: funderId(g.key),
        tone: 'funder',
        name: g.name,
        grantor: g,
        descriptions: list,
        lines: seasonCount(g),
        amount: seasonAmount(g),
        retired: isRetired(g),
      }
      rows.push(header)
      if (list.length === 0) {
        rows.push({
          kind: 'empty',
          id: `${header.id}:empty`,
          funderId: header.id,
          funderName: g.name,
        })
      } else add(header, shown)
    }
  }
  group('none', none)
  return { rows, counts }
}

/** A funder's terms in words (mock q2): plain, full coverage with its two facts, or a named fund. */
export function funderTerms(g: ApiAidGrantor): string {
  if (!g.full_coverage) return 'Not full coverage'
  const facts = `Full coverage · covers canteen: ${CANTEEN_WORDS[g.covers_canteen]} · pays after camp aid: ${g.pays_after_camp_aid ? 'yes' : 'no'}`
  return g.pays_after_camp_aid ? `Named fund · ${facts}` : facts
}

/** How many contacts a free-text contacts field names: one per line (or `;`). */
const contactCount = (contacts: string) =>
  contacts.split(/\r?\n|;/).filter((c) => c.trim() !== '').length

export function funderHeaderWords(g: ApiAidGrantor): { terms: string; detail: string } {
  const n = contactCount(g.contacts)
  const parts = [
    ...(g.eligibility === '' ? [] : [`eligibility: ${g.eligibility}`]),
    n === 0 ? 'no contacts' : plural(n, 'contact'),
  ]
  return { terms: funderTerms(g), detail: parts.join(' · ') }
}

export const campWords = (n: number) => ({
  terms: "The camp's own aid · counts toward the budget",
  detail: `no terms or contacts · ${plural(n, 'description')}`,
})

export const noFunderWords = (n: number, canClassify: boolean, canPickFunder: boolean) => ({
  terms: canPickFunder
    ? `Pick each description's funder${canClassify ? '; classify an unclassified one first' : ''}`
    : 'Descriptions no funder claims yet',
  detail: plural(n, 'description'),
})

/** The mock's "—" for a no, not the word. */
export const yesNo = (value: boolean) => (value ? 'yes' : '—')

/** The CSV's and the search's words: a no stays "no" (the dash is only what the screen draws). */
export const yesNoWords = (value: boolean) => (value ? 'yes' : 'no')

/** The source family in words: the server's label, never the key. An unclassified row has none. */
export function sourceFamilyWords(row: ApiAidSourceRow): string {
  return isUnclassified(row) ? '' : familyWordsOf(row)
}

/**
 * What the table's search matches beside each row's own text: a description on its funder's name; a
 * header on its descriptions and its funder's aliases, so a hit on a description keeps its header.
 */
export function funderSearchExtra(row: FunderRow): string[] {
  if (row.kind === 'funder') {
    return [...row.descriptions.map((d) => d.description), ...(row.grantor?.aliases ?? [])]
  }
  return [row.funderName]
}

export function fundersCsvName(year: number, show: FundersShow): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'funders',
    filters: show === 'all' ? [] : [show],
    season: year,
  })
}
