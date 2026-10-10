/** The control line's words and the URL's view (Scenarios addendum §S5 A, §S5 L). Pure. */
import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import type {
  ApiAidScenarioDraft,
  ApiAidScenarioOption,
  ApiAidScenarioResults,
  ApiAidScenarioSnapshot,
  ApiAidScenarioWorkspace,
} from '../../../../types/api-types'
import { formatShortDate, parseIsoDay } from '../../kit/dates'
import { formatWholeMoney } from '../../kit/money'

const CAMP_TIME_ZONE = 'America/Los_Angeles'
const CODE = /^[A-Z]+[0-9]*$/

/** The sections Round 1's first post locks (api/services/financial_aid_rules_service.py ROUND_SECTIONS[1]). */
export const ROUND1_SECTIONS: readonly string[] = [
  'income',
  'tiers',
  'equity',
  'award_tables',
  'programs',
  'cost',
  'grants',
  'awards',
]

/** "Feb 3, 2:10 pm": a stored moment on camp time (the held pile's). */
export function formatPileMoment(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('month')} ${part('day')}, ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`
}

const applications = (n: number) => `${String(n)} application${n === 1 ? '' : 's'}`

/** The held pile in words (§S5 A2), now the toolbar lead's title: "applications" are requests, one per camper
 * requesting aid (N5). */
export function pillWords(snapshot: ApiAidScenarioSnapshot | null): string {
  if (snapshot === null) return 'No applications held yet'
  const held = `${applications(snapshot.requests)} · as of ${formatPileMoment(snapshot.taken_at)}`
  return snapshot.awaiting_rules > 0
    ? `${held} · ${String(snapshot.awaiting_rules)} held until the rules are approved`
    : held
}

/** The toolbar's lead (scenarios-2): "56 held" with its moment apart, so the moment reads muted. The full sentence
 * (pillWords, "held until the rules are approved" included) is the lead's title. */
export function leadWords(snapshot: ApiAidScenarioSnapshot | null): {
  readonly held: string
  readonly when: string | null
} {
  if (snapshot === null) return { held: 'No applications held yet', when: null }
  return { held: `${String(snapshot.requests)} held`, when: formatPileMoment(snapshot.taken_at) }
}

export const nothingNewWords = (snapshot: ApiAidScenarioSnapshot) =>
  `Nothing new since ${formatPileMoment(snapshot.taken_at)}`

export type StartValue = 'rules' | 'rules_draft' | 'last_rules'

export interface StartEntry {
  readonly value: StartValue
  readonly label: string
  readonly disabled: boolean
}

export const isStart = (code: string): code is StartValue =>
  code === 'rules' || code === 'rules_draft' || code === 'last_rules'

/**
 * Start from ▾ (§S5 A5): the rules in effect, the rules draft only while it differs from them (owner, §S15 item 4:
 * "draft sure"), and last season's rules, in that order. With no version in effect the first entry is the draft
 * and there is no separate draft entry: they would be the same document.
 */
export function startEntries(workspace: ApiAidScenarioWorkspace): StartEntry[] {
  const lastVersion = workspace.last_rules_version ?? null
  const last: StartEntry = {
    value: 'last_rules',
    label: lastVersion === null ? "Last season's rules (none approved)" : "Last season's rules",
    disabled: lastVersion === null,
  }
  if (workspace.pricing_version === null) {
    return [
      {
        value: 'rules',
        label: `Rules draft · v${String(workspace.rules_version)}`,
        disabled: false,
      },
      last,
    ]
  }
  const entries: StartEntry[] = [
    {
      value: 'rules',
      label: `Rules in effect · v${String(workspace.pricing_version)}`,
      disabled: false,
    },
  ]
  const draftVersion = workspace.rules_draft_version ?? null
  if (draftVersion !== null)
    entries.push({
      value: 'rules_draft',
      label: `Rules draft · v${String(draftVersion)}`,
      disabled: false,
    })
  entries.push(last)
  return entries
}

/** What the sandbox is from, in the Spend table's "from …" words. */
export function fromName(draft: ApiAidScenarioDraft, workspace: ApiAidScenarioWorkspace): string {
  if (draft.from_code === 'rules') {
    return workspace.pricing_version === null
      ? `Rules draft v${String(workspace.rules_version)}`
      : `Rules v${String(workspace.pricing_version)}`
  }
  if (draft.from_code === 'rules_draft')
    return `Rules draft v${String(workspace.rules_draft_version ?? workspace.rules_version)}`
  if (draft.from_code === 'last_rules') return "last season's rules"
  return draft.from_code
}

/** "4 changes, same as B" (§S5 A6): amber on the control line; null with no change. */
export function changeWords(
  count: number,
  sameAs: string | null,
  workspace: ApiAidScenarioWorkspace
): string | null {
  if (count === 0) return null
  const base = `${String(count)} change${count === 1 ? '' : 's'}`
  if (sameAs === null) return base
  const name =
    sameAs === 'rules'
      ? `Rules v${String(workspace.pricing_version ?? workspace.rules_version)}`
      : sameAs
  return `${base}, same as ${name}`
}

export interface ScenarioView {
  readonly panel: 'sandbox' | 'compare'
  readonly requestSet: AidRequestSet
  readonly codes: readonly string[]
  readonly rules: boolean
  readonly lastRules: boolean
  readonly draft: boolean
  readonly lastSeason: boolean
  readonly byTier: boolean
  /** Any column param present: when none is, Compare's first open checks its defaults (§S5 H). */
  readonly anyColumn: boolean
}

export function parseCodes(raw: string | null): string[] {
  const codes = (raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => CODE.test(c))
  return [...new Set(codes)]
}

export function parseRequestSet(raw: string | null): AidRequestSet {
  if (raw === 'deadline') return { kind: 'deadline' }
  if (raw !== null && parseIsoDay(raw) !== null) return { kind: 'date', date: raw }
  return { kind: 'all' }
}

export function requestSetParam(set: AidRequestSet): string | null {
  if (set.kind === 'deadline') return 'deadline'
  if (set.kind === 'date') return set.date
  return null
}

/** The view's params (§S5 L; D15). `panel=trail` and `trail_page` are today's: they read as the sandbox. */
export function parseView(params: URLSearchParams): ScenarioView {
  const on = (name: string) => params.get(name) === '1'
  const codes = parseCodes(params.get('compare'))
  const view = {
    panel: params.get('panel') === 'compare' ? ('compare' as const) : ('sandbox' as const),
    requestSet: parseRequestSet(params.get('through')),
    codes,
    rules: on('rules'),
    lastRules: on('lastrules'),
    draft: on('draft'),
    lastSeason: on('last'),
    byTier: on('tiers'),
  }
  return {
    ...view,
    anyColumn: codes.length > 0 || view.rules || view.lastRules || view.draft || view.lastSeason,
  }
}

export const PRICE_CHOICES: ReadonlyArray<{
  readonly value: 'all' | 'deadline' | 'date'
  readonly label: string
}> = [
  { value: 'all', label: 'All held' },
  { value: 'deadline', label: 'Through the R1 deadline' },
  { value: 'date', label: 'Through a date…' },
]

/** The corner cell's and By tier's words for what the figures are priced on (§S5 E, §S5 H). */
export function requestSetWords(set: AidRequestSet, through: string | null): string {
  if (set.kind === 'all') return 'the applications held'
  const day = through ?? (set.kind === 'date' ? set.date : null)
  if (day === null) return 'received through the Round 1 deadline' // a refused deadline read: never a blank date
  return set.kind === 'deadline'
    ? `received through ${formatShortDate(day)} (the Round 1 deadline)`
    : `received through ${formatShortDate(day)}`
}

/** What a figure is priced on, after its count (§S5 E, §S5 H): "51 applications held", "51 received through Feb 1
 * (the Round 1 deadline)". The held pile's words lose their "the" after a count. */
export function pricedOnWords(count: number, set: AidRequestSet, through: string | null): string {
  if (set.kind === 'all') return `${String(count)} application${count === 1 ? '' : 's'} held`
  return `${String(count)} ${requestSetWords(set, through)}`
}

/**
 * What the figures on screen were priced on (CodeRabbit on #3047): their own request set, which after a refused read
 * (the last good figures kept, §S5 E States) is not Price ▾'s. No request set on a result means every application
 * held; with no figures yet the words follow Price ▾.
 */
export function pricedOnFigures(
  results: ApiAidScenarioResults | null,
  asked: AidRequestSet
): string {
  if (results === null) return pricedOnWords(0, asked, null)
  const note = results.request_set ?? null
  const set: AidRequestSet =
    note === null
      ? { kind: 'all' }
      : note.basis === 'round1_deadline'
        ? { kind: 'deadline' }
        : { kind: 'date', date: note.through }
  return pricedOnWords(results.requests, set, note?.through ?? null)
}

/** The load guard's words (§S5 C): "1 change isn't kept. Loading A drops it." / "3 changes aren't kept. … them." */
export function guardWords(count: number, name: string): string {
  return count === 1
    ? `1 change isn't kept. Loading ${name} drops it.`
    : `${String(count)} changes aren't kept. Loading ${name} drops them.`
}

/** The next flat letter (§S11.1), as the server's starting_point_code counts it: starting points only, so options
 * kept before PR 10 as variants (A1, B2) never take one. A..Z, then AA, AB… */
export function nextLetter(options: readonly ApiAidScenarioOption[]): string {
  let number = options.filter((option) => option.starting_point === null).length + 1
  let letters = ''
  while (number > 0) {
    const rest = (number - 1) % 26
    letters = String.fromCharCode(65 + rest) + letters
    number = Math.floor((number - 1) / 26)
  }
  return letters
}

/** Keep…'s line (§S5 B): Round 1 + Round 2 on the whole held pile, which is what Keep stores, whatever Price ▾
 * says. "projects" is the arrival curve's word (§S2 rule 3), so it says "prices". */
export function keepFigureWords(results: ApiAidScenarioResults | null): string {
  if (results === null) return ''
  const n = results.requests
  return `with what it prices now: ${formatWholeMoney(results.round1 + results.round2)} on ${String(n)} application${n === 1 ? '' : 's'}`
}

/** aid_scenario_options.name's size: the server's NAME_MAX (Task 56), which KeepIn.name enforces. */
export const KEEP_NAME_MAX = 80

/** Keep…'s prefill: the draft's label cut to the name field, ending "…", exactly as the server's `_fit_name` cuts a
 * blank name, so keeping the default is never refused (plan review M3). A label can run to 2,000 characters. */
export function keepName(label: string): string {
  return label.length <= KEEP_NAME_MAX ? label : `${label.slice(0, KEEP_NAME_MAX - 1)}…`
}
