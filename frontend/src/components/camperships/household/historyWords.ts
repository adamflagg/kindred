/**
 * The household page's History in words (O4; N10; history.html B, as the Season history words its
 * rows): "<who> <did what>", dated, with the reason apart. No record ids and no emails on screen;
 * they stay in the Download History CSV (householdModel `historyCsv`, unchanged). Pure.
 *
 * Who: the system's runs by their job ("Intake", "Matched in CampMinder"); staff by first name. The log
 * records a sign-in (an email), and the page carries no user list, so the name is learnt from the
 * page's own receipts: a round's Posted tick names who ticked it (`ticked_by_name`) and a Round 3
 * amount who decided it (`decided_by_name`), so the sign-in that logged that tick or amount is that
 * person. A sign-in the receipts never name reads as its email's first word, capitalised.
 *
 * The ledger's overnight tick has no person to name, so its lines read "Matched in CampMinder ·
 * <what happened>" (ruled 2026-10-05), the event said of the round rather than done by someone.
 */
import type { ApiAidHistoryEntry, ApiAidHouseholdPage } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { codeWords } from '../requests/attention'
import { formOwner } from './formsModel'
import {
  answerValue,
  answerWords,
  holdWords,
  householdName,
  multiHousehold,
} from './householdModel'

export interface LinePart {
  readonly text: string
  readonly strong?: boolean
}

export interface HistoryLine {
  readonly key: string
  readonly date: string
  readonly parts: readonly LinePart[]
  readonly reason: string | null
}

export const lineText = (line: HistoryLine): string => line.parts.map((p) => p.text).join('')

const SYSTEM_ACTORS: Readonly<Record<string, string>> = {
  'system:intake': 'Intake',
  'system:ledger': 'Matched in CampMinder',
  'system:grant-placement': 'Grant placement',
}

const firstWord = (text: string) => text.trim().split(/\s+/)[0] ?? ''
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

type Detail = Readonly<Record<string, unknown>> | null

const field = (detail: Detail, key: string): unknown => detail?.[key]

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** The round an entry names: its recorded `round`, else the id's tail ("req…:2"). */
function roundOf(entry: ApiAidHistoryEntry): number | null {
  const recorded = numberOf(field(entry.after, 'round') ?? field(entry.before, 'round'))
  if (recorded !== null) return recorded
  const tail = entry.entity_id.split(':')[1]
  const n = tail === undefined ? NaN : Number(tail)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Sign-in → first name, from the receipts that name who ticked or decided a round. */
export function staffNames(page: ApiAidHouseholdPage): Map<string, string> {
  const names = new Map<string, string>()
  for (const entry of page.history) {
    if (entry.entity !== 'aid_decisions' || entry.actor.startsWith('system:')) continue
    const round = roundOf(entry)
    const receipt = page.requests
      .find((r) => r.row.request_id === entry.request_id)
      ?.receipts.find((r) => r.round === round)
    const name =
      entry.action === 'post' && receipt?.label.lock_source === 'tick'
        ? receipt.label.ticked_by_name
        : entry.action === 'award'
          ? receipt?.label.decided_by_name
          : null
    // The latest tick of a round is the one its receipt names: later entries overwrite.
    if (name !== null && name !== undefined && name.trim() !== '') {
      names.set(entry.actor, firstWord(name))
    }
  }
  return names
}

/** Who did it, as a person reads it: never an email. */
export function whoWords(actor: string, names: ReadonlyMap<string, string>): string {
  const system = SYSTEM_ACTORS[actor]
  if (system !== undefined) return system
  if (actor.startsWith('system:'))
    return codeWords(actor.slice('system:'.length).replaceAll('-', '_'))
  const named = names.get(actor)
  if (named !== undefined) return named
  const local = actor.split('@')[0] ?? ''
  const word = local.split(/[._+-]/)[0] ?? ''
  return word === '' ? 'Someone' : capitalised(word)
}

function camperOf(page: ApiAidHouseholdPage, requestId: string | null): string {
  const row = page.requests.find((r) => r.row.request_id === requestId)?.row
  if (row === undefined) return "a camper's"
  if (row.camper_name === '') return "the household's"
  return `${firstWord(row.camper_name)}'s`
}

const plain = (text: string): LinePart => ({ text })
const strong = (text: string): LinePart => ({ text, strong: true })
const money = (value: unknown): LinePart | null => {
  const n = numberOf(value)
  return n === null ? null : strong(formatMoney(n))
}

/** The decision events' words (decisions `EventKind`); an amount is the basis the action names (D80). */
function decisionParts(page: ApiAidHouseholdPage, entry: ApiAidHistoryEntry): LinePart[] | null {
  const camper = camperOf(page, entry.request_id)
  const round = roundOf(entry)
  const roundWords = `${camper} ${round === null ? 'round' : `Round ${String(round)}`}`
  const amount = money(field(entry.after, 'amount'))
  if (entry.actor === 'system:ledger') {
    const said = ledgerParts(entry, roundWords, amount)
    if (said !== null) return said
  }
  switch (entry.action) {
    case 'post':
      return amount === null
        ? [plain(`marked ${roundWords} posted`)]
        : [plain(`marked ${roundWords} posted at `), amount]
    case 'unpost':
      return [plain(`undid the Posted tick on ${roundWords}`)]
    case 'accept':
      return [plain(`ticked Accepted on ${roundWords}`)]
    case 'unaccept':
      return [plain(`unticked Accepted on ${roundWords}`)]
    case 'ask':
      return amount === null
        ? [plain(`entered ${roundWords} ask`)]
        : [plain(`entered ${roundWords} ask, `), amount]
    case 'award':
      return amount === null
        ? [plain(`entered ${roundWords} amount`)]
        : [plain(`entered ${roundWords} amount, `), amount]
    case 'approve':
      return [plain(`approved ${roundWords}`)]
    case 'refuse':
      return [plain(`refused ${roundWords}`)]
    default:
      return null
  }
}

/** What the ledger's run did, said of the round (the line leads "Matched in CampMinder · "). */
function ledgerParts(entry: ApiAidHistoryEntry, roundWords: string, amount: LinePart | null) {
  switch (entry.action) {
    case 'post':
      return amount === null
        ? [plain(`${roundWords} posted`)]
        : [plain(`${roundWords} posted at `), amount]
    case 'unpost':
      return [plain(`${roundWords} Posted tick undone`)]
    case 'accept':
      return [plain(`${roundWords} accepted`)]
    case 'unaccept':
      return [plain(`${roundWords} acceptance undone`)]
    default:
      return null
  }
}

const REQUEST_WORDS: Readonly<Record<string, (camper: string) => string>> = {
  resolve_session: (camper) => `resolved ${camper} session`,
  mark_duplicate: (camper) => `marked ${camper} request a duplicate`,
  set_headcount: (camper) => `set ${camper} headcount`,
}

/** An entry's "did what", after the who; null when it has no words here (it reads plainly). */
function whatParts(page: ApiAidHouseholdPage, entry: ApiAidHistoryEntry): LinePart[] | null {
  const camper = camperOf(page, entry.request_id)
  switch (entry.entity) {
    case 'aid_applications':
      if (entry.action !== 'create') return null
      if (multiHousehold(page)) {
        const household = numberOf(field(entry.after, 'household_cm_id'))
        if (household !== null) return [plain(`added ${householdName(page, household)} form`)]
      }
      return [plain("added the family's form")]
    case 'aid_requests':
      if (entry.action === 'create') return [plain(`added ${camper} request`)]
      if (entry.action === 'status') {
        const status = textOf(field(entry.after, 'status'))
        return [
          plain(
            status === null
              ? `changed the status of ${camper} request`
              : `set ${camper} request to ${codeWords(status)}`
          ),
        ]
      }
      {
        const words = REQUEST_WORDS[entry.action]
        return words === undefined ? null : [plain(words(camper))]
      }
    case 'aid_decisions':
      return decisionParts(page, entry)
    case 'aid_application_corrections': {
      if (entry.action !== 'correct') return null
      const name = textOf(field(entry.after, 'field'))
      if (name === null) return [plain('corrected an answer')]
      const from = textOf(field(entry.after, 'original_value')) ?? ''
      const to = textOf(field(entry.after, 'new_value')) ?? ''
      return [
        plain(`corrected ${lowerFirst(answerWords(name))}, `),
        strong(answerValue(name, from)),
        plain(' → '),
        strong(answerValue(name, to)),
      ]
    }
    case 'aid_hold_events': {
      const code = textOf(field(entry.after, 'code'))
      if (entry.action === 'place') {
        // A manual hold's word is "On hold" (the grid's), so it adds nothing to "put … on hold".
        const why = code === null || code === 'manual_hold' ? '' : `: ${holdWords(code)}`
        return [plain(`put ${camper} request on hold${why}`)]
      }
      if (entry.action === 'lift') return [plain(`lifted the hold on ${camper} request`)]
      if (entry.action === 'release') return [plain(`released the hold on ${camper} request`)]
      if (entry.action === 'unrelease') return [plain(`undid the release on ${camper} request`)]
      return null
    }
    case 'aid_cancellations':
      if (entry.action === 'cancel') return [plain(`cancelled ${camper} request`)]
      if (entry.action === 'reopen') return [plain(`reopened ${camper} request`)]
      return null
    case 'aid_grants': {
      if (entry.action === 'create') {
        const amount = money(field(entry.after, 'amount'))
        return amount === null
          ? [plain('recorded a grant')]
          : [plain('recorded a '), amount, plain(' grant')]
      }
      if (entry.action === 'withdraw') return [plain('withdrew a grant')]
      return null
    }
    default:
      return null
  }
}

const RECORD_WORDS: Readonly<Record<string, string>> = {
  aid_decisions: 'decision',
  aid_requests: 'request',
  aid_applications: 'form',
  aid_application_corrections: 'correction',
  aid_payer_shares: 'payer share',
  aid_hold_events: 'hold',
  aid_cancellations: 'cancellation',
  aid_grants: 'grant',
  aid_grant_placements: 'grant placement',
  aid_attribution_overrides: 'placement',
  aid_flag_dispositions: 'flag',
  aid_household_links: 'household link',
}

const recordWords = (entity: string) =>
  RECORD_WORDS[entity] ?? entity.replace(/^aid_/, '').replaceAll('_', ' ')

/** "Johnson 60% · Garcia 40%" for one operation's payer-share rows. */
function sharesParts(
  page: ApiAidHouseholdPage,
  first: ApiAidHistoryEntry,
  rows: readonly ApiAidHistoryEntry[]
): LinePart[] {
  const camper = camperOf(page, first.request_id)
  const parts: LinePart[] = [
    plain(`set ${camper} payer ${rows.length > 1 ? 'shares' : 'share'} to `),
  ]
  rows.forEach((row, i) => {
    const household =
      numberOf(field(row.after, 'household_cm_id')) ?? numberOf(row.entity_id.split(':')[1])
    const pct = numberOf(field(row.after, 'share_pct'))
    if (i > 0) parts.push(plain(' · '))
    parts.push(plain(`${household === null ? 'a household' : householdName(page, household)} `))
    parts.push(strong(pct === null ? '—' : `${String(pct)}%`))
  })
  return parts
}

const isShare = (entry: ApiAidHistoryEntry) => entry.entity === 'aid_payer_shares'

/** The form a Use X's Form row used (#3021 logs it in `after.form_person_cm_id`); null on a hand correction. */
function formUsed(entry: ApiAidHistoryEntry): number | null {
  if (entry.entity !== 'aid_application_corrections' || entry.action !== 'correct') return null
  return numberOf(field(entry.after, 'form_person_cm_id'))
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** "used Emma's form for 4 answers: gross income, …" for one operation's Use X's Form rows. */
function formParts(
  page: ApiAidHouseholdPage,
  person: number,
  rows: readonly ApiAidHistoryEntry[]
): LinePart[] {
  const labels = rows.map((row) => {
    const name = textOf(field(row.after, 'field'))
    return name === null ? 'an answer' : lowerFirst(answerWords(name))
  })
  const count = `${String(rows.length)} ${rows.length === 1 ? 'answer' : 'answers'}`
  return [plain(`used ${formOwner(page, person)}'s form for ${count}: ${labels.join(', ')}`)]
}

/** The family's log in words, oldest first, as the server orders it. */
export function historyLines(page: ApiAidHouseholdPage): HistoryLine[] {
  const names = staffNames(page)
  const lines: HistoryLine[] = []
  const history = page.history
  // One operation's payer-share rows for one request read as one line ("Johnson 60% · Garcia 40%").
  const sameShareOp = (a: ApiAidHistoryEntry, b: ApiAidHistoryEntry | undefined) =>
    b !== undefined &&
    isShare(b) &&
    b.operation_id === a.operation_id &&
    b.request_id === a.request_id
  // One Use X's Form operation's rows read as one line too (round 3, section 3).
  const sameFormOp = (a: ApiAidHistoryEntry, b: ApiAidHistoryEntry | undefined) =>
    b?.operation_id === a.operation_id && formUsed(b) === formUsed(a)
  history.forEach((entry, i) => {
    if (isShare(entry) && sameShareOp(entry, history[i - 1])) return
    const person = formUsed(entry)
    if (person !== null && sameFormOp(entry, history[i - 1])) return
    const who = whoWords(entry.actor, names)
    let parts: LinePart[]
    if (person !== null) {
      const rows = [entry]
      for (let next = i + 1; sameFormOp(entry, history[next]); next += 1) {
        const row = history[next]
        if (row !== undefined) rows.push(row)
      }
      parts = formParts(page, person, rows)
    } else if (isShare(entry)) {
      const rows = [entry]
      for (let next = i + 1; sameShareOp(entry, history[next]); next += 1) {
        const row = history[next]
        if (row !== undefined) rows.push(row)
      }
      parts = sharesParts(page, entry, rows)
    } else {
      parts = whatParts(page, entry) ??
        // No words here: the action and the kind of record, plainly, still with no id.
        [plain(`: ${codeWords(entry.action)} · ${recordWords(entry.entity)}`)]
    }
    // The ledger's lines read "Matched in CampMinder · <what happened>", never "who did what".
    const lead =
      entry.actor === 'system:ledger'
        ? `${who} · `
        : parts[0]?.text.startsWith(':') === true
          ? who
          : `${who} `
    if (entry.actor === 'system:ledger' && parts[0]?.text.startsWith(': ') === true) {
      parts = [plain(parts[0].text.slice(2)), ...parts.slice(1)]
    }
    lines.push({
      key: `${entry.operation_id}:${entry.entity}:${entry.entity_id}:${String(i)}`,
      date: formatShortDate(entry.at),
      parts: [plain(lead), ...parts],
      reason: entry.reason.trim() === '' ? null : entry.reason,
    })
  })
  return lines
}

/** The History tab's meta: "6 · latest Mar 14". */
export function historyMeta(lines: readonly HistoryLine[]): string {
  const last = lines[lines.length - 1]
  return last === undefined ? 'none recorded' : `${String(lines.length)} · latest ${last.date}`
}
