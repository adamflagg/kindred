/**
 * Programs and costs (spec §4, §5): one card over the `programs` and `cost` sections, drawn by group (a budget pool,
 * named by its label; A3's `groups`). Pure: the card, its editor and its tests read the season through here. Programs
 * stay in the data (ground rule 1); a group is drawn from its sessions.
 */
import { sessionOrderIds, type SessionOrderInput } from '../../../../utils/sessionOrder'
import type { CatalogSession } from '../../../../hooks/camperships/useAidSessionCatalog'
import type { ApiAidGroup, ApiAidValidationIssue } from '../../../../types/api-types'
import { boxText, parseSetting, type FieldSpec } from './sectionEdit'

export const NOT_OPEN = 'none'
export type SubSection = 'summer' | 'quest' | 'teen' | 'other'
/**
 * CampMinder session types → the card's sub-sections (§4.4). Vocabulary, never a session (ground rule 4). The words
 * are the family words every Camperships screen shares (server `FAMILY_WORDS`); teen-type sessions (Teen Winter
 * Retreat) sit with Teen Programs, not Quests (ux3 taxonomy).
 */
export const SUBSECTION_OF_TYPE: Readonly<Record<string, SubSection>> = {
  main: 'summer',
  embedded: 'summer',
  quest: 'quest',
  teen: 'teen',
  scit: 'teen',
  tli: 'teen',
}
export const SUBSECTION_LABELS: Readonly<Record<SubSection, string>> = {
  summer: 'At Camp',
  quest: 'Quests',
  teen: 'Teen Programs',
  other: 'Other',
}
const SUB_ORDER: readonly SubSection[] = ['summer', 'quest', 'teen', 'other']
export type PriceKind = 'catalog' | 'per_person' | 'typed'

export interface ProgramShape {
  label: string
  session_cm_ids?: number[]
  session_types?: string[]
  budget_pool?: string | null
  cost_source: PriceKind
  open_to_aid?: boolean
  equity_class?: string | null
  r1_table?: string | null
  table_from_equity_class?: boolean
}
export interface CostShape {
  tuition?: Record<string, string>
  family_rates?: Array<{ session_cm_id: number; standard: string; infant: string }>
  not_running_session_cm_ids?: number[]
  infant_age_cutoff_months?: number | null
  override_reasons?: string[]
}
export interface ProgramsCostsDoc {
  readonly programs: Record<string, ProgramShape>
  readonly cost: CostShape
  readonly pools: Record<string, { label: string }>
}
export interface CardRow {
  readonly session: CatalogSession
  /** The session's place in the Camperships order (Q8) among the season's sessions. */
  readonly rank: number
  readonly program: string | null
  readonly group: string
  readonly kind: PriceKind | null
  readonly sub: SubSection
  readonly tuition: string | null
  readonly standard: string | null
  readonly infant: string | null
  readonly notRunning: boolean
  readonly cancelledOnBoard: boolean
  readonly minimumOnly: boolean
  readonly tag: string | null
}
export interface CardGroup {
  readonly pool: string
  readonly label: string
  readonly running: readonly CardRow[]
  readonly notRunning: readonly CardRow[]
  readonly agCount: number
  readonly subLabels: boolean
}
export interface CardView {
  readonly groups: readonly CardGroup[]
  readonly notOpen: readonly CardRow[]
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/** The two sections and the pools' labels as the card reads them (decimals stay strings, as stored). */
export function docOf(document: {
  programs: unknown
  cost: unknown
  budget: unknown
}): ProgramsCostsDoc {
  return {
    programs: structuredClone(record(document.programs)) as Record<string, ProgramShape>,
    cost: structuredClone(record(document.cost)),
    pools: structuredClone(record(record(document.budget)['pools'])) as Record<
      string,
      { label: string }
    >,
  }
}

/** The server's `resolve_program` (lookup.py): an explicit id, then a type; then, for an AG session no program
 *  claims, its parent's program (review M7). The card hides AG sessions under their parent either way. */
export function resolveProgram(
  doc: ProgramsCostsDoc,
  cmId: number,
  type: string,
  parent?: { readonly cmId: number; readonly type: string }
): string | null {
  const entries = Object.entries(doc.programs)
  const own =
    entries.find(([, p]) => (p.session_cm_ids ?? []).map(Number).includes(cmId))?.[0] ??
    entries.find(([, p]) => (p.session_types ?? []).includes(type))?.[0] ??
    null
  if (own !== null || type !== 'ag' || parent === undefined || parent.cmId <= 0) return own
  return resolveProgram(doc, parent.cmId, parent.type)
}

export const orderInput = (s: CatalogSession): SessionOrderInput => ({
  cm_id: s.cmId,
  name: s.name,
  session_type: s.type,
  start_date: s.startDate,
  end_date: s.endDate,
  parent_cm_id: s.parentId,
})

export function isAgChild(
  session: CatalogSession,
  byId: ReadonlyMap<number, CatalogSession>
): boolean {
  return session.type === 'ag' && session.parentId > 0 && byId.has(session.parentId)
}

const priceOf = (doc: ProgramsCostsDoc, cmId: number) => {
  const rate = (doc.cost.family_rates ?? []).find((r) => Number(r.session_cm_id) === cmId)
  return {
    tuition: doc.cost.tuition?.[String(cmId)] ?? null,
    standard: rate?.standard ?? null,
    infant: rate?.infant ?? null,
  }
}

/** The mock's rule: no tag that says "Summer", the group's name, or part of the session's own name. */
function tagOf(label: string, groupLabel: string, name: string): string | null {
  const l = label.toLowerCase()
  if (l === 'summer' || l === groupLabel.toLowerCase() || name.toLowerCase().includes(l))
    return null
  return label
}

/** Rows by their place in the Camperships session order (owner Q8; the rule itself lives in utils/sessionOrder.ts). */
export const bySessionOrder = (a: CardRow, b: CardRow) => a.rank - b.rank

export function cardView(
  doc: ProgramsCostsDoc,
  groups: readonly ApiAidGroup[],
  sessions: readonly CatalogSession[],
  cancelled: ReadonlySet<number>
): CardView {
  const byId = new Map(sessions.map((s) => [s.cmId, s] as const))
  const rankOf = new Map(
    sessionOrderIds(sessions.map(orderInput)).map((id, place) => [id, place] as const)
  )
  const pools = new Set(groups.map((g) => g.pool))
  const notRunningIds = new Set((doc.cost.not_running_session_cm_ids ?? []).map(Number))
  const rowOf = (session: CatalogSession): CardRow => {
    const key = resolveProgram(doc, session.cmId, session.type)
    const program = key === null ? undefined : doc.programs[key]
    const open = program !== undefined && program.open_to_aid !== false
    const pool =
      open && program.budget_pool && pools.has(program.budget_pool) ? program.budget_pool : NOT_OPEN
    const groupLabel = groups.find((g) => g.pool === pool)?.label ?? ''
    return {
      session,
      rank: rankOf.get(session.cmId) ?? Number.MAX_SAFE_INTEGER,
      program: key,
      group: pool,
      kind: pool === NOT_OPEN ? null : (program?.cost_source ?? null),
      sub: SUBSECTION_OF_TYPE[session.type] ?? 'other',
      ...priceOf(doc, session.cmId),
      notRunning: notRunningIds.has(session.cmId),
      cancelledOnBoard: cancelled.has(session.cmId),
      minimumOnly:
        open && program.table_from_equity_class === false && (program.r1_table ?? null) === null,
      tag:
        program !== undefined && pool !== NOT_OPEN
          ? tagOf(program.label, groupLabel, session.name)
          : null,
    }
  }
  const rows = sessions.filter((s) => !isAgChild(s, byId)).map(rowOf)
  const ags = sessions.filter((s) => isAgChild(s, byId))
  const view: CardGroup[] = groups.map((g) => {
    const mine = rows.filter((r) => r.group === g.pool)
    const running = mine.filter((r) => !r.notRunning)
    const priced = running
      .filter((r) => r.kind !== 'per_person')
      .sort((a, b) => SUB_ORDER.indexOf(a.sub) - SUB_ORDER.indexOf(b.sub) || bySessionOrder(a, b))
    const perPerson = running.filter((r) => r.kind === 'per_person').sort(bySessionOrder)
    const parentRunsHere = (ag: CatalogSession) =>
      running.some((r) => r.session.cmId === ag.parentId)
    return {
      pool: g.pool,
      label: g.label,
      running: [...priced, ...perPerson],
      notRunning: mine.filter((r) => r.notRunning).sort(bySessionOrder),
      agCount: ags.filter(parentRunsHere).length,
      subLabels: new Set(priced.map((r) => r.sub)).size >= 2,
    }
  })
  return { groups: view, notOpen: rows.filter((r) => r.group === NOT_OPEN).sort(bySessionOrder) }
}

export type EditField = 't' | 's' | 'i' | 'g' | 'nr'
export const editKey = (cmId: number, field: EditField) => `${String(cmId)}:${field}`
export type Edits = ReadonlyMap<string, string>
export type CardSection = 'programs' | 'cost'
export type SaveResult =
  | {
      readonly kind: 'ok'
      readonly contents: Readonly<Partial<Record<CardSection, Record<string, unknown>>>>
    }
  | { readonly kind: 'invalid'; readonly words: string; readonly boxes: readonly string[] }

/** #3050's shared money box: whole dollars with digit grouping, cents to two places, as stored. */
export const MONEY_BOX: FieldSpec = { kind: 'number', unit: 'money', whole: false, nullable: true }
export const moneyText = (value: string | null) => (value === null ? '' : boxText(value, MONEY_BOX))

/** The fix line's count, as the approved mock words it (programs-costs-v3: `bad.length === 1 ? 'box' : n + ' boxes'`). */
export const fixWords = (n: number) =>
  n === 1 ? 'Fix the box marked in red.' : `Fix the ${String(n)} boxes marked in red.`

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function kindFor(row: CardRow, doc: ProgramsCostsDoc): PriceKind {
  const program = row.program === null ? undefined : doc.programs[row.program]
  if (program !== undefined && program.open_to_aid !== false && program.cost_source !== 'typed') {
    return program.cost_source
  }
  return row.session.type === 'family' ? 'per_person' : 'catalog'
}

export function pickTarget(doc: ProgramsCostsDoc, group: string, kind: PriceKind): string | null {
  const candidates = Object.entries(doc.programs).filter(([, p]) =>
    group === NOT_OPEN
      ? p.open_to_aid === false
      : p.open_to_aid !== false && p.budget_pool === group && p.cost_source === kind
  )
  let best: [string, ProgramShape] | undefined
  for (const c of candidates) {
    if (
      best === undefined ||
      (c[1].session_cm_ids ?? []).length > (best[1].session_cm_ids ?? []).length
    )
      best = c
  }
  return best?.[0] ?? null
}

export function buildContents(
  doc: ProgramsCostsDoc,
  view: CardView,
  sessions: readonly CatalogSession[],
  edits: Edits
): SaveResult {
  const programs = structuredClone(doc.programs)
  const cost = structuredClone(doc.cost)
  const rows = [...view.groups.flatMap((g) => [...g.running, ...g.notRunning]), ...view.notOpen]
  const byId = new Map(sessions.map((s) => [s.cmId, s] as const))
  const place = (cmId: number, target: string) => {
    // Only a program that lists the id is rewritten, so an unmoved program serialises exactly as stored.
    for (const p of Object.values(programs)) {
      if ((p.session_cm_ids ?? []).map(Number).includes(cmId))
        p.session_cm_ids = (p.session_cm_ids ?? []).map(Number).filter((id) => id !== cmId)
    }
    const t = programs[target]
    if (t !== undefined) t.session_cm_ids = [...(t.session_cm_ids ?? []), cmId]
  }
  // 1. Group picks (§4.5): the target program of the picked group and the row's kind.
  let moved = 0
  const endsIn = new Map(rows.map((r) => [r.session.cmId, r.group] as const))
  for (const row of rows) {
    const picked = edits.get(editKey(row.session.cmId, 'g'))
    if (picked === undefined || picked === row.group) continue
    const target = pickTarget(doc, picked, kindFor(row, doc))
    if (target !== null) {
      place(row.session.cmId, target)
      endsIn.set(row.session.cmId, picked)
      moved += 1
    }
  }
  // 2. AG sessions follow their parent's program, in the same save: only after a group move, so a prices-only save
  // never writes an AG session no program lists (Review Focus 6).
  for (const ag of moved === 0 ? [] : sessions.filter((s) => isAgChild(s, byId))) {
    const parent = Object.entries(programs).find(([, p]) =>
      (p.session_cm_ids ?? []).map(Number).includes(ag.parentId)
    )
    const current = Object.entries(programs).find(([, p]) =>
      (p.session_cm_ids ?? []).map(Number).includes(ag.cmId)
    )
    if (parent !== undefined && current?.[0] !== parent[0]) place(ag.cmId, parent[0])
  }
  // 3. Prices and Not running.
  const bad: string[] = []
  let pairBad = 0
  const read = (key: string): string | null | undefined => {
    const raw = edits.get(key)
    if (raw === undefined) return undefined
    const parsed = parseSetting(raw, MONEY_BOX)
    if (parsed.kind === 'invalid') {
      bad.push(key)
      return undefined
    }
    return parsed.value as string | null
  }
  const tuition = new Map(Object.entries(cost.tuition ?? {}))
  const rates = new Map(
    (cost.family_rates ?? []).map((r) => [Number(r.session_cm_id), { ...r }] as const)
  )
  const notRunning = new Set((cost.not_running_session_cm_ids ?? []).map(Number))
  for (const row of rows) {
    const id = row.session.cmId
    const nr = edits.get(editKey(id, 'nr'))
    if (nr === 'true') notRunning.add(id)
    if (nr === 'false') notRunning.delete(id)
    // Spec §5.2 J: a session that ends not running or not open keeps its stored price untouched. Its boxes are
    // disabled or hidden, so a bad value typed before that must not block Save with a box nobody can see.
    if (notRunning.has(id) || endsIn.get(id) === NOT_OPEN) continue
    const t = read(editKey(id, 't'))
    if (t !== undefined) {
      if (t === null) tuition.delete(String(id))
      else tuition.set(String(id), t)
    }
    const sKey = editKey(id, 's'),
      iKey = editKey(id, 'i')
    if (edits.has(sKey) || edits.has(iKey)) {
      const old = rates.get(id)
      const s = edits.has(sKey) ? read(sKey) : (old?.standard ?? null)
      const i = edits.has(iKey) ? read(iKey) : (old?.infant ?? null)
      if (s === undefined || i === undefined) continue // a bad box: already listed
      if (s === null && i === null) rates.delete(id)
      else if (s === null || i === null) {
        pairBad += 1
        bad.push(s === null ? sKey : iKey)
      } else rates.set(id, { session_cm_id: id, standard: s, infant: i })
    }
  }
  if (bad.length > 0) {
    return pairBad > 0
      ? {
          kind: 'invalid',
          words: `A per-person price needs both Standard and Infant ($0 is a real price). ${fixWords(bad.length)}`,
          boxes: bad,
        }
      : { kind: 'invalid', words: `Type whole dollars. ${fixWords(bad.length)}`, boxes: bad }
  }
  // Review Focus 8: a list is written (and sorted) only when its contents changed, so an untouched stored list keeps
  // its order, and a section is sent only when it differs from what is stored.
  const start = (id: number) => byId.get(id)?.startDate ?? ''
  const tuitionOut = Object.fromEntries(tuition)
  if (!same(tuitionOut, cost.tuition ?? {})) cost.tuition = tuitionOut
  const oldRates = new Map(
    (doc.cost.family_rates ?? []).map((r) => [Number(r.session_cm_id), r] as const)
  )
  if (rates.size !== oldRates.size || [...rates].some(([id, r]) => !same(r, oldRates.get(id)))) {
    cost.family_rates = [...rates.values()].sort((a, b) =>
      start(a.session_cm_id).localeCompare(start(b.session_cm_id))
    )
  }
  const oldNotRunning = new Set((doc.cost.not_running_session_cm_ids ?? []).map(Number))
  if (
    notRunning.size !== oldNotRunning.size ||
    [...notRunning].some((id) => !oldNotRunning.has(id))
  ) {
    cost.not_running_session_cm_ids = [...notRunning].sort(
      (a, b) => start(a).localeCompare(start(b)) || a - b
    )
  }
  const contents: Partial<Record<CardSection, Record<string, unknown>>> = {}
  if (!same(programs, doc.programs)) contents.programs = programs
  if (!same(cost, doc.cost)) contents.cost = cost as Record<string, unknown>
  return { kind: 'ok', contents }
}

export interface ChangeLine {
  readonly lead: string
  readonly was: string | null
  readonly now: string
  /** A price: the card says it on the row itself, so Changed since lists only moves and Not running flips. */
  readonly price?: true
}

/** A price as a change words it, old → new: "$6,695", or "No price yet" when none is stored. */
export const priceWords = (value: string | null) =>
  value === null ? 'No price yet' : `$${moneyText(value)}`

/** The group header's AG line: AG sessions are never drawn, only counted. */
export const agWords = (n: number) =>
  n === 1
    ? "1 AG session uses its parent session's price"
    : `${String(n)} AG sessions use their parent session's price`

const NOT_OPEN_WORDS = 'Not open to aid'

/** What changed since the approved rules, in session words (spec §5.2 D): prices, then groups, then Not running.
 * Price lines carry `price: true`: the card draws them under their rows, and Changed since lists only the rest. */
export function changesSince(
  approved: ProgramsCostsDoc,
  draft: ProgramsCostsDoc,
  groups: readonly ApiAidGroup[],
  sessions: readonly CatalogSession[]
): ChangeLine[] {
  const none: ReadonlySet<number> = new Set()
  const before = cardView(approved, groups, sessions, none)
  const after = cardView(draft, groups, sessions, none)
  const order = [...after.groups.flatMap((g) => [...g.running, ...g.notRunning]), ...after.notOpen]
  const was = new Map(
    [...before.groups.flatMap((g) => [...g.running, ...g.notRunning]), ...before.notOpen].map(
      (r) => [r.session.cmId, r] as const
    )
  )
  const groupWords = (row: CardRow) =>
    row.group === NOT_OPEN
      ? NOT_OPEN_WORDS
      : (groups.find((g) => g.pool === row.group)?.label ?? row.group)
  const lines: ChangeLine[] = []
  for (const row of order) {
    const old = was.get(row.session.cmId)
    const name = row.session.name
    if (old === undefined) continue
    // A row the card draws says its own price change; one it doesn't (not running, not open to aid) leaves the
    // line to Changed since, so the pill never counts a change shown nowhere.
    const drawn: { price?: true } = row.group !== NOT_OPEN && !row.notRunning ? { price: true } : {}
    // A program priced on the request draws no tuition, so a stored one changing is no change staff can see.
    if (old.tuition !== row.tuition && row.kind !== 'typed')
      lines.push({
        lead: name,
        was: priceWords(old.tuition),
        now: priceWords(row.tuition),
        ...drawn,
      })
    if (old.standard !== row.standard)
      lines.push({
        lead: `${name} standard`,
        was: priceWords(old.standard),
        now: priceWords(row.standard),
        ...drawn,
      })
    if (old.infant !== row.infant)
      lines.push({
        lead: `${name} infant`,
        was: priceWords(old.infant),
        now: priceWords(row.infant),
        ...drawn,
      })
  }
  for (const row of order) {
    const old = was.get(row.session.cmId)
    if (old !== undefined && old.group !== row.group) {
      lines.push({ lead: row.session.name, was: groupWords(old), now: groupWords(row) })
    }
  }
  // One status-independent order, as programs-costs-v3's changes() walks: the card's group, then its sub-section,
  // then date. A walk of the draft's card order would put every running row before the not-running fold.
  const groupIndex = (row: CardRow) => {
    const i = after.groups.findIndex((g) => g.pool === row.group)
    return i === -1 ? after.groups.length : i // Not open to aid is drawn last
  }
  const flips = order
    .filter((row) => {
      const old = was.get(row.session.cmId)
      return old !== undefined && old.notRunning !== row.notRunning
    })
    .sort(
      (a, b) =>
        groupIndex(a) - groupIndex(b) ||
        SUB_ORDER.indexOf(a.sub) - SUB_ORDER.indexOf(b.sub) ||
        bySessionOrder(a, b)
    )
  for (const row of flips) {
    lines.push({
      lead: row.session.name,
      was: null,
      now: row.notRunning ? 'not running' : 'running again',
    })
  }
  return lines
}

const PRICE_CODES: ReadonlySet<string> = new Set([
  'price_missing',
  'tuition_missing',
  'family_rate_missing',
])
const idsOf = (
  issues: readonly ApiAidValidationIssue[],
  match: (code: string) => boolean
): ReadonlySet<number> =>
  new Set(issues.filter((i) => match(i.code)).flatMap((i) => i.session_cm_ids ?? []))

/** The sessions a cost warning is about (§5.2 C): their rows carry the grey mark. */
export const pricePins = (issues: readonly ApiAidValidationIssue[]): ReadonlySet<number> =>
  idsOf(issues, (code) => PRICE_CODES.has(code))

/** The sessions the server's "in no group" error names (§5.2 G). */
export const noGroupPins = (issues: readonly ApiAidValidationIssue[]): ReadonlySet<number> =>
  idsOf(issues, (code) => code === 'unmapped_session')

/** The group header's pill: "No prices yet" when every priced row lacks one, else "n with no price" (§5.2 I). */
export function groupPill(group: CardGroup, pins: ReadonlySet<number>): string | null {
  const priceable = group.running.filter((r) => r.kind !== 'typed')
  const missing = priceable.filter((r) => pins.has(r.session.cmId))
  if (missing.length === 0) return null
  return missing.length === priceable.length
    ? 'No prices yet'
    : `${String(missing.length)} with no price`
}

/** Drawn Not open to aid rows the server pinned: an AG session is never drawn, so it never counts (review M7). */
export const noGroupCount = (view: CardView, pins: ReadonlySet<number>): number =>
  view.notOpen.filter((r) => pins.has(r.session.cmId)).length
