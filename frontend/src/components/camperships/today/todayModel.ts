import type { PermissionCheck } from '../../../config/programAccess'
import { Permission } from '../../../constants/permissions'
import type {
  ApiAidBudget,
  ApiAidBudgetPool,
  ApiAidDevelopment,
  ApiAidDevelopmentSource,
  ApiAidToday,
  ApiAidTodayLine,
  ApiAidTodayStages,
} from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import type { HeroSegment, HeroTone } from '../kit/HeroBar'
import { formatMoneyCompact, formatMoneyFigure, formatWholeMoney } from '../kit/money'
import { liveColumnIndex } from '../reports/developmentModel'
import { codeWords } from '../requests/attention'
import { EXCEPTION_BADGES, PIPELINE_STAGES } from '../requests/strip'
import { REQUEST_VIEWS } from '../requests/views'
import { SECTION_TITLES, isRulesSection } from '../season/rules/rulesModel'

export type TodayKey = ApiAidTodayLine['key']
export type TodayPage = 'finance' | 'registrar' | 'development' | 'viewOnly' | 'none'

/** Spec 2026-10-10 §2: permissions, never role names. */
export function pickTodayPage(can: PermissionCheck): TodayPage {
  if (can.hasPermission(Permission.FINANCIAL_AID_RULES)) return 'finance'
  if (can.hasPermission(Permission.FINANCIAL_AID_CASEWORK)) return 'registrar'
  const view = can.hasPermission(Permission.FINANCIAL_AID_VIEW)
  if (
    !view &&
    (can.hasPermission(Permission.FINANCIAL_AID_GRANTORS) ||
      can.hasPermission(Permission.FINANCIAL_AID_SUMMARY))
  ) {
    return 'development'
  }
  return view ? 'viewOnly' : 'none'
}

/** Spec §5.1 (accepted default 1): grants second, because entering grant information is registrar work. */
export const REGISTRAR_ORDER: readonly TodayKey[] = [
  'needs_offer',
  'grants',
  'waiting_on_family',
  'holds',
  'not_reconciled',
  'to_reverse',
  'session_not_settled',
  // PR 3 (spec 71 §2.4): Requests › Form intake's Needs a look rows, beside the other intake line.
  'form_intake',
  'duplicates',
  'cancel_reason',
  'late_full_coverage',
  'to_place',
]
export const FINANCE_ORDER: readonly TodayKey[] = ['pending_approval', 'rules_sections', 'sources']
export const DEVELOPMENT_ORDER: readonly TodayKey[] = [
  'no_contact',
  'no_eligibility',
  'needs_group',
  'no_grantor',
]
export const TOP_N = 5

export function rankLines(
  lines: readonly ApiAidTodayLine[],
  order: readonly TodayKey[]
): { top: ApiAidTodayLine[]; rest: ApiAidTodayLine[] } {
  const ordered = order
    .map((key) => lines.find((l) => l.key === key))
    .filter((l): l is ApiAidTodayLine => l !== undefined)
  const live = ordered.filter((l) => l.items > 0)
  const ranked = [...live.filter((l) => l.overdue), ...live.filter((l) => !l.overdue)]
  const top = ranked.slice(0, TOP_N)
  return { top, rest: ordered.filter((l) => !top.includes(l)) }
}

/**
 * The registrar's queue on the finance page. Ruling 3 drew it only when finance had little of its own; controller
 * ruling V4 (2026-10-11, the owner found no way to reach it) draws it always, folded, as the mock does.
 */
export function showRegistrarQueue(finance: readonly ApiAidTodayLine[] | null): boolean {
  return finance !== null
}

/** Finance's synthetic concern line (a pool over its allocation) is built client-side, so it has a key the server never sends. */
export type TodayWordKey = TodayKey | 'over_budget'
export const LINE_WORDS: Readonly<Record<TodayWordKey, string>> = {
  over_budget: 'Over budget',
  needs_offer: 'Needs an offer',
  holds: 'Holds',
  waiting_on_family: 'Waiting on the family',
  not_reconciled: 'Not reconciled',
  to_reverse: 'To reverse',
  session_not_settled: 'Session not settled',
  form_intake: 'Form intake: needs a look',
  duplicates: 'Duplicates',
  cancel_reason: 'Cancelled: give a reason',
  to_place: 'To place',
  grants: 'Grants needing attention',
  late_full_coverage: 'A late full-coverage grant',
  pending_approval: 'Pending approval',
  rules_sections: 'Rules sections awaiting approval',
  would_change: 'Would change',
  sources: 'New CampMinder descriptions',
  intake: 'Intake health',
  equity_field_never_true: 'Equity question never answered yes',
  no_contact: 'Funders missing a contact',
  no_eligibility: 'Funders missing eligibility',
  needs_group: 'Descriptions with no reporting group',
  no_grantor: 'CampMinder descriptions no funder claims',
}

const UNIT: Record<ApiAidTodayLine['item_kind'], readonly [string, string]> = {
  requests: ['req', 'req'],
  grants: ['grant', 'grants'],
  sections: ['section', 'sections'],
  descriptions: ['description', 'descriptions'],
  fields: ['field', 'fields'],
  lines: ['line', 'lines'],
  funders: ['funder', 'funders'],
  campers: ['camper', 'campers'],
}
/**
 * A line's unit. Finance's synthetic Over budget line counts pools, not lines; Form intake's counts people (owner Q4,
 * 10-29), since from 2027 it counts adults on the adult aid form too, some with no person yet.
 */
function unitOf(line: ApiAidTodayLine): readonly [string, string] {
  if ((line.key as string) === 'over_budget') return ['pool', 'pools']
  if (line.key === 'form_intake') return ['person', 'people']
  return UNIT[line.item_kind]
}

export function countWords(line: ApiAidTodayLine): string {
  const [one, many] = unitOf(line)
  const main = `${String(line.items)} ${line.items === 1 ? one : many}`
  return line.families !== null && line.item_kind === 'requests'
    ? `${main} · ${String(line.families)} fam`
    : main
}

/** The count cell's parts (audit R4, spec §5): each figure bold, its unit muted, "31 req 23 fam". */
export function countParts(line: ApiAidTodayLine): Array<{ figure: string; unit: string }> {
  const [one, many] = unitOf(line)
  const parts = [{ figure: String(line.items), unit: line.items === 1 ? one : many }]
  if (line.families !== null && line.item_kind === 'requests')
    parts.push({ figure: String(line.families), unit: 'fam' })
  return parts
}

/** What a next-up chip's days count, in its line's words (audit N6): each line's clock starts somewhere else. */
const CLOCK_WORDS: Readonly<Partial<Record<TodayKey, (d: string) => string>>> = {
  needs_offer: (d) => `asked ${d} ago`,
  waiting_on_family: (d) => `offer posted ${d} ago`,
  pending_approval: (d) => `sent for approval ${d} ago`,
  holds: (d) => `on hold ${d}`,
  not_reconciled: (d) => `posted ${d} ago`,
  grants: (d) => `${d} old`,
  cancel_reason: (d) => `cancelled ${d} ago`,
}
export function clockWords(key: TodayKey | string, days: number): string {
  const d = `${String(days)} ${days === 1 ? 'day' : 'days'}`
  const words = (CLOCK_WORDS as Readonly<Record<string, ((d: string) => string) | undefined>>)[key]
  return words ? words(d) : d
}

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const awardsWord = (n: number) => `${String(n)} ${n === 1 ? 'award' : 'awards'}`

/** The bar's linear stages (ruling 17), each a strip stage: the strip's word and its view. */
const LINEAR: ReadonlyArray<{
  key: 'needs_offer' | 'pending_approval' | 'waiting_on_family'
  tone: HeroTone
  mine: boolean
}> = [
  { key: 'needs_offer', tone: 'act', mine: true },
  { key: 'pending_approval', tone: 'light', mine: false },
  { key: 'waiting_on_family', tone: 'progress', mine: false },
]

const stripView = (key: string) => REQUEST_VIEWS.find((v) => v.key === key)

/**
 * The registrar's bar (owner ruling 17): every live request once, by its own Stage. The linear stages carry the strip's
 * words and open that stage, with a count that matches its list for requests moving through the normal stages; On hold
 * (latest round held) opens Holds, which can list more; Accepted opens the whole season. It sums to `live`.
 */
export function registrarSegments(stages: ApiAidTodayStages, view: AidView): HeroSegment[] {
  const season = aidHref('/aid/requests', view)
  const holdsView = stripView('holds')
  return [
    ...LINEAR.map(({ key, tone, mine }): HeroSegment => {
      const stage = stripView(key)
      return {
        key,
        value: stages[key],
        label: stage?.label ?? key,
        figure: String(stages[key]),
        tone,
        mine,
        href: stage ? aidHref('/aid/requests', view, { view: stage.slug }) : season,
      }
    }),
    {
      key: 'on_hold',
      value: stages.on_hold,
      label: holdsView?.label ?? 'On hold',
      figure: String(stages.on_hold),
      tone: 'act2',
      mine: true,
      title: `On hold: ${String(stages.on_hold)} requests whose latest round is on hold. The Holds list can show more requests, because it also lists holds raised after an offer was made.`,
      href: holdsView ? aidHref('/aid/requests', view, { view: holdsView.slug }) : season,
    },
    {
      key: 'accepted',
      value: stages.accepted,
      label: 'Accepted',
      figure: String(stages.accepted),
      tone: 'done',
      title: `Accepted: ${String(stages.accepted)} requests whose family has accepted the offer, including a refused appeal (they keep the grant they accepted)`,
      href: season,
    },
  ]
}

export interface HeroFlag {
  readonly key: string
  readonly label: string
  readonly count: number
  readonly href: string
}

/**
 * The registrar hero's chips (ruling 17): the strip's flags, which sit on top of any stage, in the strip's order. Each
 * is the strip's own count (the server's queue membership), opening its list; a flag at zero is not drawn.
 */
export function registrarFlags(stages: ApiAidTodayStages, view: AidView): HeroFlag[] {
  return EXCEPTION_KEYS.flatMap((key) => {
    const stage = stripView(key)
    const count = stages.flags[key]
    return stage && count > 0
      ? [
          {
            key,
            label: stage.label,
            count,
            href: aidHref('/aid/requests', view, { view: stage.slug }),
          },
        ]
      : []
  })
}

/** The strip's flags, in its order: Not reconciled from the pipeline, then the exception badges. */
const EXCEPTION_KEYS = [...PIPELINE_STAGES, ...EXCEPTION_BADGES].filter(
  (k): k is keyof ApiAidTodayStages['flags'] => !LINEAR.some((l) => l.key === k)
)

/** Percent of live (not cancelled) requests that already have an offer; null with nothing live. */
export function offerShare(s: ApiAidTodayStages): number | null {
  return s.live > 0 ? Math.round((s.offered / s.live) * 100) : null
}

/** The hero's key figures read as the week card's (audit N9: exact under $10,000, so $1,750 never reads "$1k");
 *  the words inside a bar stay compact. */
export function budgetSegments(
  cell: ApiAidBudgetPool['total'],
  below: ApiAidBudgetPool['below']
): { segments: HeroSegment[]; total: number; allocated: number | null } {
  const posted = cell.posted ?? 0
  const offer = cell.needs_offer ?? 0
  const pend = cell.pending_approval ?? 0
  const held = below.held_asked ?? 0
  const remaining = Math.max(cell.remaining ?? 0, 0)
  const over = Math.max(-(cell.remaining ?? 0), 0)
  // Final check S3: over budget, the spending is drawn only up to the allocation (Posted first, then Needs an offer,
  // then Pending) and the `over` segment carries the rest, so the overrun is drawn once and the marker sits where the
  // spending ends. The key row keeps every amount.
  let room = over > 0 ? Math.max(cell.allocated ?? 0, 0) : Infinity
  const upTo = (amount: number) => {
    const drawn = Math.min(amount, room)
    room -= drawn
    return drawn
  }
  const [postedDrawn, offerDrawn, pendDrawn] = [upTo(posted), upTo(offer), upTo(pend)]
  const segments: HeroSegment[] = [
    {
      key: 'posted',
      value: posted,
      drawn: postedDrawn,
      label: 'Posted',
      figure: formatMoneyFigure(posted),
      inner: `Posted ${formatMoneyCompact(posted)}`,
      tone: 'done',
    },
    {
      key: 'needs_offer',
      value: offer,
      drawn: offerDrawn,
      label: 'Needs an offer, as the rules price it',
      figure: formatMoneyFigure(offer),
      tone: 'progress',
    },
    {
      key: 'pending',
      value: pend,
      drawn: pendDrawn,
      label: 'Pending your approval',
      figure: formatMoneyFigure(pend),
      tone: 'act',
      mine: true,
    },
    {
      key: 'remaining',
      value: remaining,
      label: 'Remaining',
      figure: formatMoneyFigure(remaining),
      inner: `${formatMoneyCompact(remaining)} remaining`,
      tone: 'gap',
    },
    {
      key: 'over',
      value: over,
      label: 'Over',
      figure: formatMoneyFigure(over),
      inner: '',
      tone: 'over',
      mine: true,
    },
    {
      key: 'held',
      value: held,
      label: 'On hold, at what they asked',
      figure: formatMoneyFigure(held),
      inner: '',
      tone: 'est',
      title: `On hold, asked ${money(held)}: if the holds clear at what they asked`,
    },
  ]
  const allocated = cell.allocated
  return { segments, total: Math.max(allocated ?? 0, posted + offer + pend) + held, allocated }
}

export function overPools(budget: ApiAidBudget): Array<{ label: string; over: number }> {
  return budget.pools
    .filter((p) => (p.total.remaining ?? 0) < 0)
    .map((p) => ({ label: p.label, over: -(p.total.remaining ?? 0) }))
}

const SKY: readonly HeroTone[] = ['sky0', 'sky1', 'sky2', 'sky3', 'sky4', 'sky5']

export function developmentSegments(sources: readonly ApiAidDevelopmentSource[]): {
  main: HeroSegment[]
  funders: HeroSegment[]
  own: number
  outside: number
} {
  const own = sources.filter((s) => s.who_paid === 'the camp').reduce((a, s) => a + s.amount, 0)
  // One segment per funder (audit D3): a funder paying through two descriptions is one name with both amounts.
  const byName = new Map<string, ApiAidDevelopmentSource>()
  for (const s of sources.filter((x) => x.who_paid === 'another funder')) {
    const held = byName.get(s.name)
    byName.set(
      s.name,
      held ? { ...held, amount: held.amount + s.amount, awards: held.awards + s.awards } : s
    )
  }
  const outsideList = [...byName.values()].sort((a, b) => b.amount - a.amount)
  const outside = outsideList.reduce((a, s) => a + s.amount, 0)
  const main: HeroSegment[] = [
    {
      key: 'own',
      value: own,
      label: "This camp's own aid",
      figure: formatMoneyFigure(own),
      inner: `Camp ${formatMoneyCompact(own)}`,
      tone: 'done',
    },
    {
      key: 'outside',
      value: outside,
      label: `Outside funders (${String(outsideList.length)})`,
      figure: formatMoneyFigure(outside),
      inner: `Outside ${formatMoneyCompact(outside)}`,
      tone: 'sky0',
    },
  ]
  const split = outsideList.length > 7
  const shown = split ? outsideList.slice(0, 6) : outsideList
  const others = split ? outsideList.slice(6) : []
  const funders: HeroSegment[] = shown.map((s, i) => ({
    key: s.source_key || s.name,
    value: s.amount,
    label: s.name,
    figure: `${formatMoneyFigure(s.amount)} · ${awardsWord(s.awards)}`,
    inner: formatMoneyCompact(s.amount),
    tone: SKY[i % SKY.length] ?? 'sky0',
    title: `${s.name}: ${money(s.amount)} · ${awardsWord(s.awards)}`,
  }))
  if (others.length > 0) {
    const value = others.reduce((a, s) => a + s.amount, 0)
    const awards = others.reduce((a, s) => a + s.awards, 0)
    funders.push({
      key: 'others',
      value,
      label: `${String(others.length)} other funders`,
      figure: `${formatMoneyFigure(value)} · ${awardsWord(awards)}`,
      inner: `${String(others.length)} others`,
      tone: 'mute',
      title: others.map((s) => `${s.name} ${money(s.amount)}`).join(' · '),
    })
  }
  return { main, funders, own, outside }
}

/** Spec §3: one sentence per page; a clause at zero is dropped. */
export function bandSentence(
  page: TodayPage,
  today: ApiAidToday,
  budget: ApiAidBudget | undefined,
  outside: number | null
): string {
  const items = (lines: readonly ApiAidTodayLine[] | null | undefined, key: TodayKey) =>
    lines?.find((l) => l.key === key)?.items ?? 0
  const none = 'Nothing is waiting on you'
  if (page === 'registrar' || page === 'viewOnly') {
    const overdue = (today.casework ?? []).filter((l) => l.overdue && l.items > 0).length
    const offer = items(today.casework, 'needs_offer')
    const parts = [
      overdue > 0
        ? overdue === 1
          ? '1 line is overdue'
          : `${String(overdue)} lines are overdue`
        : '',
      offer > 0
        ? offer === 1
          ? '1 request needs an offer'
          : `${String(offer)} requests need an offer`
        : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(', and ') : none
  }
  if (page === 'finance') {
    const pend = items(today.finance, 'pending_approval')
    const over = budget ? overPools(budget) : []
    const parts = [
      pend > 0
        ? pend === 1
          ? '1 request waits on your approval'
          : `${String(pend)} requests wait on your approval`
        : '',
      ...over.map((p) => `${p.label} is ${money(p.over)} over`),
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : none
  }
  if (page === 'development') {
    const upkeep = upkeepItems(today.development)
    const parts = [
      outside ? `${money(outside)} from outside funders so far` : '',
      upkeep > 0
        ? upkeep === 1
          ? '1 upkeep item needs a look'
          : `${String(upkeep)} upkeep items need a look`
        : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : none
  }
  return ''
}

/** Development's upkeep, one count for the band and Upkeep left (audit D18): every item on every line. */
export function upkeepItems(lines: readonly ApiAidTodayLine[] | null | undefined): number {
  return (lines ?? []).reduce((sum, l) => sum + l.items, 0)
}

/** Words for the reason codes Today's lines carry that the server sends without a label. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  needs_camper: 'needs a camper',
  not_posted: 'not yet in CM',
  posted_then_reversed: 'posted, then reversed',
  possible_match: 'possible match',
  camper_cancelled: 'camper cancelled',
  no_grantor: 'no grantor',
  unclassified: 'unclassified',
  needs_group: 'needs a group',
  short: 'short',
  over: 'over',
  not_in_campminder: 'Missing in CM',
  r1: 'R1',
  r2: 'R2',
  r3: 'R3',
  // Form intake's Needs a look reasons (PR 3)
  campminder_aid: 'CM aid on no request',
  enrolled_no_request: 'enrolled, no request',
  session_unclear: 'session unclear',
  registration_ask_unreviewed: 'reg. ask to review',
  // The adult aid form's (adult aid form design §10)
  form_response_to_link: 'responses to link',
  form_response_deleted: 'response deleted in Google',
  form_response_unlinked: 'response no longer linked',
  form_changed_after_decision: 'second response after a decision',
  form_pull_refused: 'read from Google refused',
  form_choice_unclear: 'program choice unclear',
}
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * A reason in staff words, never a code: the server's label when it sends one, else Today's own words, the Rules
 * page's section titles (rules sections), or the Requests grid's hold and check words, which fall back to the
 * code in sentence case.
 */
export function reasonWords(
  lineKey: string,
  reason: { readonly code: string; readonly label?: string | null | undefined }
): string {
  if (reason.label) return reason.label
  const known = REASON_WORDS[reason.code]
  if (known !== undefined) return sentence(known)
  if (lineKey === 'rules_sections' && isRulesSection(reason.code))
    return SECTION_TITLES[reason.code]
  return codeWords(reason.code)
}

const NAMED_REASONS: readonly string[] = ['rules_sections', 'equity_field_never_true']

/** Lower-case a later reason's first letter, unless its first word is an acronym ("CM …", "R1"). */
const midSentence = (words: string): string => {
  const first = words.split(' ')[0] ?? ''
  return first.length > 1 && first === first.toUpperCase()
    ? words
    : words.charAt(0).toLowerCase() + words.slice(1)
}

/** Reasons shown in full up to this many; past it, the top two and "+N more" (owner 2a, 2026-10-11). */
const REASONS_SHOWN = 3

/**
 * A line's reasons as one sentence (audit R13): "Short 4 · missing in CM 3 · over 1", most common first and
 * capitalised once. Owner 2a: three reasons or fewer all show; more, and the cell shows the two most common then a
 * plain "+N more", so it reads without a hover. A named thing (a rules section, an equity field) carries no count. A
 * line with money and no reasons says its money (To place, audit R17). `all`: every reason (the cell's title).
 */
export function reasonsLine(line: ApiAidTodayLine, all = false): string {
  // Stable: equal counts keep the server's order.
  const reasons = [...(line.reasons ?? [])].sort((a, b) => b.items - a.items)
  const shown = all || reasons.length <= REASONS_SHOWN ? reasons : reasons.slice(0, 2)
  const parts = shown.map((r, i) => {
    const words = i === 0 ? reasonWords(line.key, r) : midSentence(reasonWords(line.key, r))
    return r.items > 0 && !NAMED_REASONS.includes(line.key) ? `${words} ${String(r.items)}` : words
  })
  if (parts.length === 0 && line.key === 'to_place' && line.amount != null)
    return formatWholeMoney(line.amount)
  const more = reasons.length - shown.length
  return [...parts, ...(more > 0 ? [`+${String(more)} more`] : [])].join(' · ')
}

/** Every reason, for the Why cell's title (owner 2a: the cell itself shows the top ones). */
export const reasonsTitle = (line: ApiAidTodayLine): string => reasonsLine(line, true)

export interface GroupRow {
  readonly key: string
  readonly label: string
  readonly total: number
  readonly outside: number
  /** Campers helped (Reports › Development's Recipients, live); null where the report has no figure (no group). */
  readonly campers: number | null
}

const NO_GROUP = 'In no group'

/** Reports › Development's live figure for a row key and group, or null. */
function liveFigure(dev: ApiAidDevelopment, key: string, group: string | null): number | null {
  const at = liveColumnIndex(dev)
  if (at < 0) return null
  return dev.rows.find((r) => r.key === key && r.group === group)?.values[at] ?? null
}

/**
 * By reporting group's rows (audit D11, D13, D14): the sources' money by group, in the rules' pool order (the read's
 * `groups`), then the money in no group last, worded as Reports › Development words it. Campers helped is the
 * report's live Recipients row; money and counts only, never a family.
 */
export function reportingGroupRows(dev: ApiAidDevelopment): GroupRow[] {
  const sums = new Map<string, { total: number; outside: number }>()
  for (const s of dev.sources) {
    const key = s.group === '' ? '' : s.group
    const g = sums.get(key) ?? { total: 0, outside: 0 }
    g.total += s.amount
    if (s.who_paid === 'another funder') g.outside += s.amount
    sums.set(key, g)
  }
  const known = dev.groups.map((g) => g.key)
  const extra = [...sums.keys()].filter((k) => k !== '' && !known.includes(k)).sort()
  const label = (key: string) =>
    dev.groups.find((g) => g.key === key)?.label ??
    dev.sources.find((s) => s.group === key)?.group_label ??
    key
  return [...known, ...extra, '']
    .filter((key) => sums.has(key))
    .map((key) => {
      const g = sums.get(key) ?? { total: 0, outside: 0 }
      return {
        key: key === '' ? 'no-group' : key,
        label: key === '' ? NO_GROUP : label(key),
        total: g.total,
        outside: g.outside,
        campers: key === '' ? null : liveFigure(dev, 'recipients', key),
      }
    })
}

/** The Every group total row: the money summed, Campers helped the report's own every-group Recipients figure. */
export function reportingGroupTotal(dev: ApiAidDevelopment): {
  total: number
  outside: number
  campers: number | null
} {
  const rows = reportingGroupRows(dev)
  return {
    total: rows.reduce((a, r) => a + r.total, 0),
    outside: rows.reduce((a, r) => a + r.outside, 0),
    campers: liveFigure(dev, 'recipients', null),
  }
}
