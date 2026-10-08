/**
 * Money › Sources' words, choices and edit bodies (spec §8.1; D58, D88, D100, D105, D159, D160;
 * money-v2.html Sources; Decisions P-12 to P-14, ruling H). Pure. The registry is the server's; the
 * screen names its values and builds the bodies the routes take. Program words come from the rules
 * (`programLabel`); a source family shows as the server's key in words (`keyWords`); the
 * funder-naming `source_family` Literal is never spelled out here (P-12).
 */
import type {
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
import { programLabel } from '../requests/programLabel'

/** "other_outside" → "other outside": a server key in words, never a hardcoded name. */
export const keyWords = (key: string) => key.replaceAll('_', ' ')

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

/**
 * Ruling H (owner 10-06): "Needs a group 5 · 2 with lines this season", every outside source with
 * no group, then those of them with live lines this season. Both are the server's flags and counts.
 */
export function needsGroupWords(rows: readonly ApiAidSourceRow[]): string {
  const needs = rows.filter((r) => r.needs_group === true)
  const live = needs.filter((r) => (r.lines ?? 0) > 0)
  return `Needs a group ${String(needs.length)} · ${String(live.length)} with lines this season`
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
  ['funder_type', 'Funder'],
  ['counts_as_aid', 'Counts as aid'],
  ['counts_toward_budget', 'Counts toward the budget'],
  ['implied_program_families', 'Programs'],
  ['incentive', 'Incentive'],
  ['grantor_key', 'Grantor'],
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
  'Saving this drops its grantor: only an outside grant or incentive names one (Money › Funders keeps the funder).'

/** "Set a Group…"'s choice: a pool key, no group, or (a source over several pools) keep them. */
export const KEEP_GROUPS = 'keep'
export const NO_GROUP = ''

export interface GroupDraft {
  readonly group: string
  readonly incentive: boolean
  readonly note: string
}

/** The editor's start: the group as shown (several pools: keep them), the flag, an empty note. */
export function groupDraftFrom(source: ApiAidFundingSource): GroupDraft {
  const group = source.group ?? (source.group_label === '' ? NO_GROUP : KEEP_GROUPS)
  return { group, incentive: source.incentive, note: '' }
}

/**
 * The route's body (D159; `_keeps_group`): no `group` keeps the pools as they are, a key is one
 * pool, and `null` clears a source's one pool. For a source over several pools the server reads
 * `null` as "keep" (`_keeps_group`: `body.group == shown`, and `shown` is None there), so the editor
 * doesn't offer "no group" for it (`offersNoGroup`; R3-7): pick one pool, then clear it. The note is
 * optional (owner, Funding sources save 10-03).
 */
export function groupBody(draft: GroupDraft): ApiAidFundingSourceIn {
  const note = draft.note.trim()
  return {
    ...(draft.group === KEEP_GROUPS
      ? {}
      : { group: draft.group === NO_GROUP ? null : draft.group }),
    incentive: draft.incentive,
    ...(note === '' ? {} : { note }),
  }
}

/**
 * Whether "— no group —" is offered (R3-7): not for a source over several pools, where the route
 * would keep them anyway (`groupBody`'s note).
 */
export function offersNoGroup(source: ApiAidFundingSource): boolean {
  return groupDraftFrom(source).group !== KEEP_GROUPS
}

/** Whether the save moves the group (the server's D159 warning shows then). */
export function groupChanged(source: ApiAidFundingSource, draft: GroupDraft): boolean {
  if (draft.group === KEEP_GROUPS) return false
  return (draft.group === NO_GROUP ? null : draft.group) !== source.group
}

/** Whether the save changes anything at all. */
export function groupEdited(source: ApiAidFundingSource, draft: GroupDraft): boolean {
  return groupChanged(source, draft) || draft.incentive !== source.incentive
}

/** The fields "Set a Group…" watches between opening and saving (P-9). */
export const GROUP_WATCHED: ReadonlyArray<readonly [keyof ApiAidFundingSource, string]> = [
  ['group', 'Reporting group'],
  ['families', 'Programs'],
  ['incentive', 'Incentive'],
]
