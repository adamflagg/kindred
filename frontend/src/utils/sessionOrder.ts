/**
 * The one order Camperships lists several sessions in (owner Q8, 2026-10-09, then app-wide): "listing them by
 * start date, longer before shorter, just how the summer session dashboard does? AG can be listed below its
 * parent session. Quest next, then TLI, then SCIT (SIT and CIT) and, then FC by number."
 *
 * A mirror of `bunking/session_order.py` (the server's, for tables and CSVs). Both run
 * `sessionOrder.fixture.json`, so a change to one without the other fails a test. Pure.
 *
 *   summer  main, embedded and AG by start date, longer first on a tie (the sync's own priority,
 *           pocketbase/sync/sessions.go sortSessionsByPriority), main before embedded before AG; an AG session with
 *           its parent in the list sits right under it.
 *   then    quest, TLI, SCIT, the teen program (after SCIT), B*Mitzvah, Hebrew, family school, Family Camp by its
 *           number (unnumbered family sessions by date after the numbered), adult weekends, anything else.
 *
 * For a list of anything that names a session, `orderSessions(items, read)`; whatever subset is in play is ordered.
 */

export interface SessionOrderInput {
  readonly cm_id: number
  readonly name: string
  readonly session_type: string
  /** "YYYY-MM-DD…", or '' when unknown (sorts last in its kind). */
  readonly start_date: string
  readonly end_date: string
  /** The main session an AG (or embedded) session sits under; 0 when none. */
  readonly parent_cm_id: number
}

/** The kind groups in listing order; a type none names sits last. */
const KIND_ORDER: ReadonlyArray<readonly string[]> = [
  ['main', 'embedded', 'ag'],
  ['quest'],
  ['tli'],
  ['scit'],
  ['teen'],
  ['bmitzvah'],
  ['hebrew'],
  ['school'],
  ['family'],
  ['adult'],
]
const SUMMER_TYPE_RANK: Readonly<Record<string, number>> = { main: 0, embedded: 1, ag: 2 }
const NO_DATE = '9999-99-99'
const UNNUMBERED = 1_000_000
const FAMILY_NUMBER = /family camp\s+(\d+)/i
const DAY = /^\d{4}-\d{2}-\d{2}/

const typeOf = (s: SessionOrderInput) => s.session_type.trim().toLowerCase()

function kindOf(type: string): number {
  const found = KIND_ORDER.findIndex((types) => types.includes(type))
  return found === -1 ? KIND_ORDER.length : found
}

/** The ISO day of a date string; null when unknown or not a real day. */
function dayOf(value: string): number | null {
  if (!DAY.test(value)) return null
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

function durationDays(s: SessionOrderInput): number {
  const start = dayOf(s.start_date)
  const end = dayOf(s.end_date)
  return start !== null && end !== null ? Math.round((end - start) / 86_400_000) : 0
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

function compare(a: SessionOrderInput, b: SessionOrderInput): number {
  const key = (s: SessionOrderInput) => {
    const type = typeOf(s)
    const numbered = type === 'family' ? FAMILY_NUMBER.exec(s.name) : null
    return [
      kindOf(type),
      numbered?.[1] === undefined ? UNNUMBERED : Number(numbered[1]),
      dayOf(s.start_date) === null ? NO_DATE : s.start_date.slice(0, 10),
      -durationDays(s),
      SUMMER_TYPE_RANK[type] ?? 0,
      s.name,
      s.cm_id,
    ] as const
  }
  const ka = key(a)
  const kb = key(b)
  for (let i = 0; i < ka.length; i += 1) {
    const c = cmp(ka[i] as string | number, kb[i] as string | number)
    if (c !== 0) return c
  }
  return 0
}

/** The CampMinder ids of `sessions` in the Camperships order. */
export function sessionOrderIds(sessions: readonly SessionOrderInput[]): number[] {
  const present = new Set(sessions.map((s) => s.cm_id))
  const under = new Map<number, SessionOrderInput[]>()
  const free: SessionOrderInput[] = []
  for (const s of sessions) {
    if (typeOf(s) === 'ag' && present.has(s.parent_cm_id) && s.parent_cm_id !== s.cm_id) {
      under.set(s.parent_cm_id, [...(under.get(s.parent_cm_id) ?? []), s])
    } else {
      free.push(s)
    }
  }
  const out: number[] = []
  for (const s of free.toSorted(compare)) {
    out.push(s.cm_id)
    out.push(...(under.get(s.cm_id) ?? []).toSorted(compare).map((a) => a.cm_id))
  }
  // keep every session once, whatever the parent links hold (an AG under an AG)
  const seen = new Set(out)
  out.push(
    ...sessions
      .toSorted(compare)
      .filter((s) => !seen.has(s.cm_id))
      .map((s) => s.cm_id)
  )
  return out
}

/** Any list of things that name a session, in the Camperships order (stable for the same session twice). */
export function orderSessions<T>(items: readonly T[], read: (item: T) => SessionOrderInput): T[] {
  const sessions = items.map(read)
  const place = new Map<number, number>()
  sessionOrderIds(sessions).forEach((id, index) => {
    if (!place.has(id)) place.set(id, index)
  })
  return items
    .map((item, index) => ({
      item,
      index,
      at: place.get(read(item).cm_id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .toSorted((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.item)
}
