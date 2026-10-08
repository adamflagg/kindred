/**
 * Split… and Place on Another Request… (spec §8.1; D12): the parts a person types, read and checked
 * the way the server checks them (`PlacePartIn`: each a positive amount to the cent; `_Parts`: one to
 * ten parts; the service: together the whole line), so the editor says what's wrong before anything
 * is asked or sent. The server checks again; its sentence shows if it refuses.
 */
import type { ApiAidPlaceLineIn, ApiAidToPlaceLine } from '../../../types/api-types'
import { parseMoneyInput } from '../kit/editor'
import { formatMoney, toCents } from '../kit/money'
import { candidateLabel, exactAmount } from './toPlaceModel'

/** What is typed for each candidate, by request id. Blank means no part on that request. */
export type SplitInputs = Readonly<Record<string, string>>

export type SplitRead =
  | {
      readonly ok: true
      readonly body: ApiAidPlaceLineIn
      /** "Parts add to $3,620 of $3,620 ✓" (money-v2.html's split editor). */
      readonly words: string
    }
  | { readonly ok: false; readonly problem: string }

/** The server's limit on one placement's parts (`_Parts.parts`, at most ten). */
export const MAX_PARTS = 10

/** "2200", "1420.50": a typed figure as the editor starts it, without a ".00". */
const typed = (amount: number) => exactAmount(amount).replace(/\.00$/, '')

/** The editor's starting values: the suggestion's parts on its candidates, the rest blank. */
export function initialInputs(line: ApiAidToPlaceLine): SplitInputs {
  const parts = line.suggestion?.parts ?? []
  return Object.fromEntries(
    line.candidates.map((c) => {
      const part = parts.find((p) => p.request_id === c.request_id)
      return [c.request_id, part === undefined ? '' : typed(part.amount)]
    })
  )
}

/**
 * The typed parts as a placement, or what is wrong with them. A part is a positive amount on one of
 * the line's candidates (a blank or $0 is no part); together they must equal the whole line to the
 * cent (a placement replaces all of a partly placed line). No `expected_locked` here: the editor adds
 * the lock its preview of these very parts answered (P-4).
 */
export function readSplit(line: ApiAidToPlaceLine, inputs: SplitInputs): SplitRead {
  const parts: Array<{ request_id: string; amount: string }> = []
  let cents = 0
  for (const candidate of line.candidates) {
    const parsed = parseMoneyInput(inputs[candidate.request_id] ?? '')
    if (parsed.kind === 'empty') continue
    if (parsed.kind === 'invalid') {
      return { ok: false, problem: `${candidateLabel(candidate)}: ${parsed.reason}` }
    }
    if (toCents(parsed.amount) === 0) continue
    parts.push({ request_id: candidate.request_id, amount: exactAmount(parsed.amount) })
    cents += toCents(parsed.amount)
  }
  if (parts.length === 0) return { ok: false, problem: 'Type at least one part' }
  if (parts.length > MAX_PARTS) {
    return { ok: false, problem: `At most ${String(MAX_PARTS)} parts` }
  }
  const sum = `Parts add to ${formatMoney(cents / 100)} of ${formatMoney(line.amount)}`
  if (cents !== toCents(line.amount)) return { ok: false, problem: `${sum} · must equal the line` }
  return { ok: true, body: { parts, note: '' }, words: `${sum} ✓` }
}

/** Place on Another Request…: the whole line on one candidate. */
export function wholeLineOn(line: ApiAidToPlaceLine, requestId: string): ApiAidPlaceLineIn {
  return { parts: [{ request_id: requestId, amount: exactAmount(line.amount) }], note: '' }
}
