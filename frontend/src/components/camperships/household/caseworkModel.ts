/**
 * The casework forms' reading of what staff type, and what each form offers (§6.3; main spec §8,
 * §9.1–§9.3; Decisions 28, 37). Strict, like the kit's money input: no "Number(text)".
 */
import type {
  ApiAidAnswer,
  ApiAidApplication,
  ApiAidGridRow,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
} from '../../../types/api-types'
import { parseMoneyInput } from '../kit/editor'

export type FieldKind = 'money' | 'count' | 'flag' | 'override'

export type Parsed<T> =
  { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'invalid'; readonly reason: string }

const ok = <T>(value: T): Parsed<T> => ({ kind: 'ok', value })
const invalid = <T>(reason: string): Parsed<T> => ({ kind: 'invalid', reason })

const COUNT_FIELDS = new Set(['num_children'])

/** An answer's kind, as api/services/financial_aid_corrections.py keeps it. */
export function fieldKind(answer: ApiAidAnswer): FieldKind {
  if (answer.field === 'income_override') return 'override'
  if (COUNT_FIELDS.has(answer.field)) return 'count'
  const flag = (value: string) => value === 'true' || value === 'false'
  return flag(answer.synced) || flag(answer.effective) ? 'flag' : 'money'
}

export function parseCount(raw: string, max: number): Parsed<number> {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return invalid('A whole number')
  const n = Number(text)
  return n > max ? invalid(`At most ${String(max)}`) : ok(n)
}

/** "40", "62.5", "62.5%" → the text the server stores; above 0, at most 100, two places. */
export function parsePercent(raw: string): Parsed<string> {
  const text = raw.trim().replace(/%$/, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return invalid('A percentage, like 40 or 62.5')
  const pct = Number(text)
  if (pct > 100) return invalid('At most 100%')
  // The server's `gt=0`: a share of nothing is a 422, so say so before sending.
  return pct <= 0 ? invalid('More than 0%') : ok(text)
}

/**
 * The corrected value as the server takes it: money and counts as plain numbers, flags as true/false.
 * `null` is the way back to the form's figure, and the only one: the server reads an empty string as
 * a 422 for every field kind, and `null` (or a missing key) as "revert".
 */
export function correctionValue(kind: FieldKind, raw: string | null): Parsed<string | null> {
  if (kind === 'override') return invalid('The income override is set elsewhere')
  if (raw === null) return ok(null)
  if (kind === 'flag') return raw === 'true' || raw === 'false' ? ok(raw) : invalid('Yes or no')
  if (kind === 'count') {
    const count = parseCount(raw, 50)
    return count.kind === 'ok' ? ok(String(count.value)) : count
  }
  const money = parseMoneyInput(raw)
  if (money.kind === 'ok') return ok(String(money.amount))
  return invalid(money.kind === 'invalid' ? money.reason : 'Enter the figure')
}

/** The session candidates intake recorded on the request's `unmatched_session` flag (Decision 28). */
export function sessionCandidates(
  application: ApiAidApplication | undefined,
  requestId: string
): number[] {
  const flag = application?.requests
    .find((r) => r.id === requestId)
    ?.flags.find((f) => f.code === 'unmatched_session')
  const candidates = flag?.detail?.['candidates']
  return Array.isArray(candidates)
    ? candidates.filter((c): c is number => typeof c === 'number')
    : []
}

/**
 * A session's name: the season's sessions first (Decision 28's default; M6), then a row on the page,
 * else its id.
 */
export function sessionName(
  page: ApiAidHouseholdPage,
  sessionCmId: number,
  names?: ReadonlyMap<number, string> | undefined
): string {
  const named = names?.get(sessionCmId)
  if (named !== undefined && named !== '') return named
  const row = page.requests.find((r) => r.row.session_cm_id === sessionCmId)?.row
  return row && row.session_name !== '' ? row.session_name : `Session ${String(sessionCmId)}`
}

/**
 * The requests that could be kept, by the server's `_mark_duplicate`: active, the same program, the
 * same camper (a household request pairs by household), and the same session, a session still
 * unnamed (0) matching any.
 */
export function duplicateSurvivors(
  page: ApiAidHouseholdPage,
  request: ApiAidHouseholdRequest
): ApiAidHouseholdRequest[] {
  const row = request.row
  return page.requests.filter((other) => {
    const kept = other.row
    if (kept.request_id === row.request_id || kept.request_status !== 'active') return false
    const sameSubject =
      row.person_cm_id !== 0
        ? kept.person_cm_id === row.person_cm_id
        : kept.person_cm_id === 0 && kept.household_cm_id === row.household_cm_id
    return (
      sameSubject &&
      kept.program_key === row.program_key &&
      (row.session_cm_id === 0 || kept.session_cm_id === row.session_cm_id)
    )
  })
}

export function headcountOf(
  application: ApiAidApplication | undefined,
  requestId: string
): { readonly nonInfant: number; readonly infant: number } | null {
  const request = application?.requests.find((r) => r.id === requestId)
  return request
    ? { nonInfant: request.headcount_non_infant, infant: request.headcount_infant }
    : null
}

export interface CaseworkOffers {
  readonly shares: boolean
  readonly session: boolean
  readonly duplicate: boolean
  readonly headcount: boolean
}

/**
 * Which casework buttons a request takes, gated as the server gates each write
 * (api/services/financial_aid_casework_service.py): payer shares and headcount refuse a duplicate or
 * withdrawn request (`_CLOSED`); a headcount also belongs to a Family Camp household request; Settle
 * session and Keep the other request are for the two statuses intake sets.
 */
export function caseworkOffers(row: ApiAidGridRow): CaseworkOffers {
  const closed = row.request_status === 'duplicate' || row.request_status === 'withdrawn'
  return {
    shares: !closed,
    session: row.request_status === 'unmatched_session',
    duplicate: row.request_status === 'duplicate_pending',
    headcount: !closed && row.person_cm_id === 0 && row.program_key === 'family_camp',
  }
}
