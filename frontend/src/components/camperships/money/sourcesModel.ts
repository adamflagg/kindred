/**
 * Money › Funders' words, choices and edit bodies (spec §8.1; D58, D88, D100, D105, D159, D160;
 * money-v2.html Sources; Decisions P-12 to P-14, ruling H). Pure. The registry is the server's; the
 * screen names its values and builds the bodies the routes take. Program words are the shared family words
 * the approved read sends (`programWords`, through `programLabel`); a source family shows as the server's key in words (`keyWords`); the
 * funder-naming `source_family` Literal is never spelled out here (P-12).
 */
import type {
  ApiAidDevelopmentGroup,
  ApiAidFunderType,
  ApiAidFundingSource,
  ApiAidFundingSourceIn,
  ApiAidProgramFamily,
  ApiAidSourceChange,
  ApiAidSourceFamily,
  ApiAidSourceRow,
  ApiAidSourceUpdate,
} from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { campToday, formatShortDate } from '../kit/dates'
import { familyRank, programLabel } from '../requests/programLabel'

/** "other_outside" → "other outside": a server key in words, never a hardcoded name. */
export const keyWords = (key: string) => key.replaceAll('_', ' ')

/**
 * A source family in staff words: the server's `source_family_label`, and the key in words only
 * when the label is empty or missing. Every Money surface that shows a family goes through this.
 */
export function familyWordsOf(row: {
  readonly source_family: string
  readonly source_family_label?: string | null
}): string {
  const label = row.source_family_label
  return typeof label === 'string' && label !== '' ? label : keyWords(row.source_family)
}

/** The registry's source families as select choices: the key is the value, the server's label the words. */
export function familyChoices(
  rows: readonly ApiAidSourceRow[]
): Array<{ value: string; label: string }> {
  const byKey = new Map<string, string>()
  for (const r of rows) {
    if (r.source_family !== '' && !byKey.has(r.source_family)) {
      byKey.set(r.source_family, familyWordsOf(r))
    }
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([value, label]) => ({ value, label }))
}

/** The funder type in words (the classify editor's choice). `satisfies`: a new type fails tsc here. */
export const FUNDER_LABELS = {
  camp: 'Camp aid',
  outside: 'Outside grant',
  incentive: 'Incentive (old funder type)',
} as const satisfies Record<ApiAidFunderType, string>

/** The funder types offered: camp aid or outside. "incentive" is a flag, not a funder type (D88, D97). */
export const OFFERED_FUNDERS: readonly ApiAidFunderType[] = ['camp', 'outside']

/** Every program family the route accepts; `satisfies` makes a schema change fail tsc here. */
const PROGRAM_FAMILY_KEYS = {
  summer: true,
  quest: true,
  teen: true,
  bmitzvah: true,
  family_camp: true,
  adult_weekend: true,
  family_school: true,
  other: true,
} as const satisfies Record<ApiAidProgramFamily, true>

export const PROGRAM_FAMILIES = Object.keys(PROGRAM_FAMILY_KEYS) as ApiAidProgramFamily[]

const isFunderType = (value: string): value is ApiAidFunderType =>
  Object.hasOwn(FUNDER_LABELS, value)

const isProgramFamily = (value: string): value is ApiAidProgramFamily =>
  Object.hasOwn(PROGRAM_FAMILY_KEYS, value)

export function funderWords(funderType: string): string {
  return isFunderType(funderType) ? FUNDER_LABELS[funderType] : ''
}

export const isUnclassified = (row: ApiAidSourceRow) => row.classified_by === 'unclassified'

/** Who paid (D88), derived by the server: "This camp", "Another funder", or nothing yet. */
export function whoPaidWords(row: ApiAidSourceRow): string {
  if (row.who_paid === 'the camp') return 'This camp'
  if (row.who_paid === 'another funder') return 'Another funder'
  return ''
}

/** Incentive or need-based (D88): the flag, once the row says who paid. */
export function incentiveWords(row: ApiAidSourceRow): '' | 'incentive' | 'need-based' {
  if (row.who_paid === null || row.who_paid === undefined) return ''
  return row.incentive === true ? 'incentive' : 'need-based'
}

/** "Summer Sessions, Family Camp Weekends" in the rules' words, or "" when it names none. */
export function programWords(
  programs: readonly string[],
  names: Readonly<Record<string, string>>
): string {
  return programs.map((p) => programLabel(names, p)).join(', ')
}

/**
 * The last logged change (D105), who, when and why: `finance@example.com · Sep 30 · "funds weekend
 * families too"`. "Who" is the server's (an editor's email, ruling B3). Nothing logged yet: "".
 */
export function lastChangeWords(change: ApiAidSourceChange | null | undefined): string {
  if (change === null || change === undefined) return ''
  // `at` is UTC: an evening edit in camp time is still that day (R3-11).
  const day = Number.isNaN(Date.parse(change.at)) ? change.at : campToday(new Date(change.at))
  const head = `${change.by} · ${formatShortDate(day)}`
  return change.note.trim() === '' ? head : `${head} · "${change.note.trim()}"`
}

export type SourcesShow = 'all' | 'needs-group' | 'unclassified'

export function parseShow(raw: string | null): SourcesShow {
  return raw === 'needs-group' || raw === 'unclassified' ? raw : 'all'
}

export function shownSources(
  rows: readonly ApiAidSourceRow[],
  show: SourcesShow
): readonly ApiAidSourceRow[] {
  if (show === 'needs-group') return rows.filter((r) => r.needs_group === true)
  if (show === 'unclassified') return rows.filter(isUnclassified)
  return rows
}

export function sourcesCsvName(year: number, show: SourcesShow): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'sources',
    filters: show === 'all' ? [] : [show],
    season: year,
  })
}

/**
 * The source families finance may pick (P-12): those the registry already uses. A family no
 * description uses yet is not offered; the route checks every value against its own list.
 */
export function familyOptions(rows: readonly ApiAidSourceRow[]): string[] {
  return [...new Set(rows.map((r) => r.source_family))]
    .filter((f) => f !== '' && f !== 'unclassified')
    .sort()
}

/** What a classification edit holds while typed. */
export interface ClassifyDraft {
  readonly name: string
  readonly family: string
  readonly funder: string
  readonly countsAsAid: boolean
  readonly countsTowardBudget: boolean
  readonly programs: readonly ApiAidProgramFamily[]
  readonly note: string
}

/** The editor's start: the row as it stands, and an empty note (each edit gives its own, D105). */
export function draftFrom(row: ApiAidSourceRow): ClassifyDraft {
  return {
    name: row.source_name,
    family: row.source_family === 'unclassified' ? '' : row.source_family,
    // The sync writes "unknown" for a description nobody classified (R3-6): nothing is picked then.
    funder: isFunderType(row.funder_type) ? row.funder_type : '',
    countsAsAid: row.counts_as_aid,
    countsTowardBudget: row.counts_toward_budget,
    programs: row.implied_program_families.filter(isProgramFamily),
    note: '',
  }
}

export type ClassifyRead =
  | { readonly ok: true; readonly body: ApiAidSourceUpdate }
  | { readonly ok: false; readonly problem: string }

/** The whole classification the route takes, or what is missing. The server checks the rest. */
export function readDraft(draft: ClassifyDraft): ClassifyRead {
  if (draft.name.trim() === '') return { ok: false, problem: 'Name the source' }
  if (draft.family === '') return { ok: false, problem: 'Pick its family' }
  if (!isFunderType(draft.funder)) return { ok: false, problem: 'Pick who funds it' }
  // The route's `AidSourceUpdate` budget rule, said before its 422.
  if (draft.countsTowardBudget && !draft.countsAsAid) {
    return { ok: false, problem: 'Counting toward the budget needs it to count as aid' }
  }
  if (draft.countsTowardBudget && draft.family !== 'camp_fa') {
    return { ok: false, problem: "Only the camp's own aid counts toward the budget" }
  }
  if (draft.note.trim() === '') return { ok: false, problem: 'A note is required (it is logged)' }
  return {
    ok: true,
    body: {
      source_name: draft.name.trim(),
      // A family the registry already uses (familyOptions); the route refuses any other with a 422.
      source_family: draft.family as ApiAidSourceFamily,
      funder_type: draft.funder,
      counts_as_aid: draft.countsAsAid,
      counts_toward_budget: draft.countsTowardBudget,
      implied_program_families: [...draft.programs],
      note: draft.note.trim(),
    },
  }
}

/** The programs are where the reporting group is stored (D100): moving them re-places lines (D159). */
export function programsChanged(row: ApiAidSourceRow, draft: ClassifyDraft): boolean {
  const before = [...row.implied_program_families].sort().join(',')
  return before !== [...draft.programs].sort().join(',')
}

/** The fields the classify and grantor editors watch between opening and saving (P-9). */
export const SOURCE_WATCHED: ReadonlyArray<readonly [keyof ApiAidSourceRow, string]> = [
  ['source_name', 'Name'],
  ['source_family', 'Family'],
  ['funder_type', 'Paid by'],
  ['counts_as_aid', 'Counts as aid'],
  ['counts_toward_budget', 'Counts toward the budget'],
  ['implied_program_families', 'Programs'],
  ['incentive', 'Incentive'],
  ['grantor_key', 'Funder'],
  ['note', 'Note'],
]

/** The description's grantor by name (the server's), or its key when the server names none. */
export function grantorWords(row: ApiAidSourceRow): string {
  const name = row.grantor_name ?? ''
  return name === '' ? row.grantor_key : name
}

/** Only an outside or incentive description names a grantor (the route's rule). */
export const canNameGrantor = (row: ApiAidSourceRow) =>
  row.funder_type === 'outside' || row.funder_type === 'incentive'

/**
 * Whether saving this classification drops the description's grantor: the write clears it in the
 * same save when the funder leaves outside and incentive (`financial_aid_write_service.py:177–180`).
 */
export function dropsGrantor(row: ApiAidSourceRow, draft: ClassifyDraft): boolean {
  return row.grantor_key !== '' && draft.funder !== 'outside' && draft.funder !== 'incentive'
}

export const DROPS_GRANTOR_WARNING =
  'Saving this drops its funder: only an outside grant or incentive names one. The funder itself stays in Money › Funders.'

export interface GroupDraft {
  /** The picked pool keys. */
  readonly groups: readonly string[]
  readonly incentive: boolean
  readonly note: string
}

/** The editor's start (mock option A, multi-select): the pools the source's programs reach, the flag, no note. */
export function groupDraftFrom(source: ApiAidFundingSource, pools: readonly Pool[]): GroupDraft {
  return {
    groups: poolsOfFamilies(source.families, pools),
    incentive: source.incentive,
    note: '',
  }
}

/** Whether the picked set differs from the pools the source reaches now (order never counts). */
export function groupChanged(
  source: ApiAidFundingSource,
  draft: GroupDraft,
  pools: readonly Pool[]
): boolean {
  return !sameSet(draft.groups, poolsOfFamilies(source.families, pools))
}

/**
 * The route's body (D159): `groups` goes only when the set changed (`[]` clears), so an incentive-only
 * save never rewrites the families; never the single `group`. The note is optional (owner, 10-03).
 */
export function groupBody(
  source: ApiAidFundingSource,
  draft: GroupDraft,
  pools: readonly Pool[]
): ApiAidFundingSourceIn {
  const note = draft.note.trim()
  return {
    ...(groupChanged(source, draft, pools) ? { groups: [...draft.groups] } : {}),
    incentive: draft.incentive,
    ...(note === '' ? {} : { note }),
  }
}

/** Whether the save changes anything at all. */
export function groupEdited(
  source: ApiAidFundingSource,
  draft: GroupDraft,
  pools: readonly Pool[]
): boolean {
  return groupChanged(source, draft, pools) || draft.incentive !== source.incentive
}

/** The fields "Set a Group…" watches between opening and saving (P-9). */
export const GROUP_WATCHED: ReadonlyArray<readonly [keyof ApiAidFundingSource, string]> = [
  ['group', 'Reporting group'],
  ['families', 'Programs'],
  ['incentive', 'Incentive'],
]

/**
 * A season's reporting group as Edit… sees it (final UX, owner 10-09 star 19): the pool, and the program
 * families the rules send to it, which is what the source stores (D100's `implied_program_families`).
 */
export interface Pool {
  readonly key: string
  readonly label: string
  readonly families: readonly string[]
}

/** The server's groups as pools, in the rules' order. A server that sent no families leaves none. */
export const poolsOfGroups = (groups: readonly ApiAidDevelopmentGroup[]): Pool[] =>
  groups.map((g) => ({ key: g.key, label: g.label, families: g.families ?? [] }))

/** The pools a set of families reaches, in the rules' order. A family no pool funds reaches none. */
export const poolsOfFamilies = (families: readonly string[], pools: readonly Pool[]): string[] =>
  pools.filter((p) => p.families.some((f) => families.includes(f))).map((p) => p.key)

/** What picking these pools writes: every family each funds, once, sorted (as Set a Group… writes one pool). */
export function familiesOfPools(picked: readonly string[], pools: readonly Pool[]): string[] {
  const out = new Set<string>()
  for (const pool of pools) if (picked.includes(pool.key)) for (const f of pool.families) out.add(f)
  return [...out].sort()
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

/**
 * The families a Classify save sends once the picker's pools are `picked`. While they are the pools the
 * description already reached, nothing moved: it keeps exactly what it opened with, so finance's narrower
 * setting (D100: "specific programs within them") and a family no pool funds are never rewritten.
 */
export function classifyPrograms(
  picked: readonly string[],
  pools: readonly Pool[],
  opened: readonly string[]
): ApiAidProgramFamily[] {
  const families = sameSet(picked, poolsOfFamilies(opened, pools))
    ? opened
    : familiesOfPools(picked, pools)
  // The route's own list: a family it would refuse is never sent.
  return families.filter(isProgramFamily)
}

/** A pool's families in the shared family order (the Program picker's, `familyRank`), then any other by key. */
const coverWords = (pool: Pool, names: Readonly<Record<string, string>>) =>
  [...pool.families]
    .sort((a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b))
    .map((f) => programLabel(names, f))
    .join(', ')

/** The muted line under the picker (mock `coversMulti`): the programs the picked pools cover, in the shared words. */
export function coversWords(
  picked: readonly string[],
  pools: readonly Pool[],
  names: Readonly<Record<string, string>>
): string {
  const chosen = pools.filter((p) => picked.includes(p.key))
  if (chosen.length === 0) return 'No group: the source will need one.'
  const [only] = chosen
  if (chosen.length === 1 && only !== undefined) return `Covers: ${coverWords(only, names)}`
  return `Covers: ${chosen.map((p) => `${coverWords(p, names)} (${p.label})`).join(' · ')}`
}

/**
 * The opened row's "Programs it funds" line in the pools' words (mock `fundsLine`): the group, with
 * what it covers when there is one, or the groups. Null: it reaches no pool.
 */
export function fundsWords(
  families: readonly string[],
  pools: readonly Pool[],
  names: Readonly<Record<string, string>>
): { lead: string; names: string; covers: string | null } | null {
  const keys = poolsOfFamilies(families, pools)
  const reached = pools.filter((p) => keys.includes(p.key))
  const [only] = reached
  if (reached.length === 0 || only === undefined) return null
  return reached.length === 1
    ? { lead: 'Reporting group', names: only.label, covers: coverWords(only, names) }
    : { lead: 'Reporting groups', names: reached.map((p) => p.label).join(', '), covers: null }
}
