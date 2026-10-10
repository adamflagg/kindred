import type { PermissionCheck } from '../../../config/programAccess'
import { Permission } from '../../../constants/permissions'
import type {
  ApiAidBudget,
  ApiAidBudgetPool,
  ApiAidDevelopmentSource,
  ApiAidToday,
  ApiAidTodayLine,
  ApiAidTodayStages,
} from '../../../types/api-types'
import type { HeroSegment, HeroTone } from '../kit/HeroBar'
import { codeWords } from '../requests/attention'
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
  'duplicates',
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

/** Ruling 3: the registrar's queue shows on the finance page only when finance has little of its own. */
export function showRegistrarQueue(finance: readonly ApiAidTodayLine[] | null): boolean {
  if (finance === null) return false
  return (
    FINANCE_ORDER.filter((key) => (finance.find((l) => l.key === key)?.items ?? 0) > 0).length < 3
  )
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
  duplicates: 'Duplicates',
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
  needs_group: 'Funding sources that need a reporting group',
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
}
export function countWords(line: ApiAidTodayLine): string {
  // Finance's synthetic Over budget line counts pools, not lines.
  const [one, many] =
    (line.key as string) === 'over_budget' ? ['pool', 'pools'] : UNIT[line.item_kind]
  const main = `${String(line.items)} ${line.items === 1 ? one : many}`
  return line.families !== null && line.item_kind === 'requests'
    ? `${main} · ${String(line.families)} fam`
    : main
}

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
export const thousands = (n: number) =>
  Math.abs(n) < 1000 ? money(n) : `$${String(Math.trunc(n / 1000))}k`
const awardsWord = (n: number) => `${String(n)} ${n === 1 ? 'award' : 'awards'}`

export function registrarSegments(
  stages: ApiAidTodayStages,
  href: (stage: string) => string
): HeroSegment[] {
  const seg = (
    key: Exclude<keyof ApiAidTodayStages, 'families' | 'posted_this_week'>,
    label: string,
    tone: HeroTone,
    mine = false
  ): HeroSegment => ({
    key,
    value: stages[key],
    label,
    figure: String(stages[key]),
    tone,
    mine,
    href: href(key),
  })
  return [
    seg('accepted', 'Accepted', 'done'),
    seg('waiting_on_family', 'Waiting on the family', 'progress'),
    seg('pending_approval', 'Pending approval', 'light'),
    seg('needs_offer', 'Need an offer', 'act', true),
    seg('held', 'On hold', 'act2', true),
    seg('cancelled', 'Cancelled or withdrawn', 'mute'),
  ]
}

/** Percent of live (not cancelled) requests that already have an offer; null with nothing live. */
export function offerShare(s: ApiAidTodayStages): number | null {
  const live = s.accepted + s.waiting_on_family + s.pending_approval + s.needs_offer + s.held
  return live > 0
    ? Math.round(((s.accepted + s.waiting_on_family + s.pending_approval) / live) * 100)
    : null
}

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
  const segments: HeroSegment[] = [
    {
      key: 'posted',
      value: posted,
      label: 'Posted',
      figure: thousands(posted),
      inner: `Posted ${thousands(posted)}`,
      tone: 'done',
    },
    {
      key: 'needs_offer',
      value: offer,
      label: 'Needs an offer, as the rules price it',
      figure: thousands(offer),
      tone: 'progress',
    },
    {
      key: 'pending',
      value: pend,
      label: 'Pending your approval',
      figure: thousands(pend),
      tone: 'act',
      mine: true,
    },
    {
      key: 'remaining',
      value: remaining,
      label: 'Remaining',
      figure: thousands(remaining),
      inner: `${thousands(remaining)} remaining`,
      tone: 'gap',
    },
    {
      key: 'over',
      value: over,
      label: 'Over',
      figure: thousands(over),
      inner: '',
      tone: 'over',
      mine: true,
    },
    {
      key: 'held',
      value: held,
      label: 'On hold, at what they asked',
      figure: thousands(held),
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
  const outsideList = sources
    .filter((s) => s.who_paid === 'another funder')
    .sort((a, b) => b.amount - a.amount)
  const outside = outsideList.reduce((a, s) => a + s.amount, 0)
  const main: HeroSegment[] = [
    {
      key: 'own',
      value: own,
      label: "This camp's own aid",
      figure: thousands(own),
      inner: `Camp ${thousands(own)}`,
      tone: 'done',
    },
    {
      key: 'outside',
      value: outside,
      label: `Outside funders (${String(outsideList.length)})`,
      figure: thousands(outside),
      inner: `Outside ${thousands(outside)}`,
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
    figure: `${thousands(s.amount)} · ${awardsWord(s.awards)}`,
    inner: thousands(s.amount),
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
      figure: `${thousands(value)} · ${awardsWord(awards)}`,
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
    const upkeep = (today.development ?? [])
      .filter((l) => l.item_kind === 'funders')
      .reduce((a, l) => a + l.items, 0)
    const parts = [
      outside ? `${money(outside)} from outside funders so far` : '',
      upkeep > 0
        ? upkeep === 1
          ? '1 funder record needs a look'
          : `${String(upkeep)} funder records need a look`
        : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : none
  }
  return ''
}

/** Words for the reason codes Today's lines carry that the server sends without a label. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  needs_camper: 'needs a camper',
  not_posted: 'commitment not yet in CampMinder',
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
