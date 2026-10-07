/**
 * Programs and costs (spec §4, §5): one card over the `programs` and `cost` sections, drawn by group (a budget pool,
 * named by its label; A3's `groups`). Pure: the card, its editor and its tests read the season through here. Programs
 * stay in the data (ground rule 1); a group is drawn from its sessions.
 */
import type { CatalogSession } from '../../../../hooks/camperships/useAidSessionCatalog'
import type { ApiAidGroup } from '../../../../types/api-types'

export const NOT_OPEN = 'none'
export type SubSection = 'summer' | 'quest' | 'scit' | 'other'
/** CampMinder session types → the card's sub-sections (§4.4). Vocabulary, never a session (ground rule 4). */
export const SUBSECTION_OF_TYPE: Readonly<Record<string, SubSection>> = {
  main: 'summer',
  embedded: 'summer',
  quest: 'quest',
  teen: 'quest',
  scit: 'scit',
  tli: 'scit',
}
export const SUBSECTION_LABELS: Readonly<Record<SubSection, string>> = {
  summer: 'Summer',
  quest: 'Quest',
  scit: 'SCIT',
  other: 'Other',
}
const SUB_ORDER: readonly SubSection[] = ['summer', 'quest', 'scit', 'other']
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

const byDate = (a: CardRow, b: CardRow) =>
  a.session.startDate.localeCompare(b.session.startDate) ||
  a.session.sortOrder - b.session.sortOrder ||
  a.session.cmId - b.session.cmId

export function cardView(
  doc: ProgramsCostsDoc,
  groups: readonly ApiAidGroup[],
  sessions: readonly CatalogSession[],
  cancelled: ReadonlySet<number>
): CardView {
  const byId = new Map(sessions.map((s) => [s.cmId, s] as const))
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
      .sort((a, b) => SUB_ORDER.indexOf(a.sub) - SUB_ORDER.indexOf(b.sub) || byDate(a, b))
    const perPerson = running.filter((r) => r.kind === 'per_person').sort(byDate)
    const parentRunsHere = (ag: CatalogSession) =>
      running.some((r) => r.session.cmId === ag.parentId)
    return {
      pool: g.pool,
      label: g.label,
      running: [...priced, ...perPerson],
      notRunning: mine.filter((r) => r.notRunning).sort(byDate),
      agCount: ags.filter(parentRunsHere).length,
      subLabels: new Set(priced.map((r) => r.sub)).size >= 2,
    }
  })
  return { groups: view, notOpen: rows.filter((r) => r.group === NOT_OPEN).sort(byDate) }
}
