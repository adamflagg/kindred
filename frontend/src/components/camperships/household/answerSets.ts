/**
 * The household page's answer sets, labelled by form (adult aid form design GF-2 B): each form prices its own bucket,
 * so a household where an adult filed the adult aid form shows two sets. Pure words.
 */
import { formatShortDate } from '../kit/dates'
import type { FormSource } from '../kit/words'
import { programLabel } from '../requests/programLabel'

/** One answer set on the household page: which form, who filed it and when, and the requests it prices. */
export interface AnswerSet {
  readonly source: FormSource
  readonly filed_by: string
  readonly filed_on: string
  readonly prices: ReadonlyArray<{ readonly camper_name: string; readonly program_key: string }>
}

const FORM_NAME: Readonly<Record<FormSource, string>> = {
  campminder: 'CampMinder aid form',
  google_form: 'Adult aid form',
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`
}

/**
 * A set's band words (GF-2 B): the form's name, and "Mia Johnson, Nov 5 · prices Mia's Women's Weekend request". Each
 * form prices its own bucket, so the requests it prices say which figures move which award.
 */
export function answerSetHead(
  set: AnswerSet,
  programs: Readonly<Record<string, string>>
): { name: string; meta: string } {
  const byCamper = new Map<string, string[]>()
  for (const p of set.prices) {
    const first = p.camper_name.split(' ')[0] ?? p.camper_name
    const list = byCamper.get(first) ?? []
    const label = programLabel(programs, p.program_key)
    if (!list.includes(label)) list.push(label)
    byCamper.set(first, list)
  }
  const priced = [...byCamper.entries()].map(
    ([first, labels]) =>
      `${first}'s ${andList(labels)} ${labels.length === 1 ? 'request' : 'requests'}`
  )
  const prices = priced.length === 0 ? 'prices no request yet' : `prices ${andList(priced)}`
  return {
    name: FORM_NAME[set.source],
    meta: `${set.filed_by}, ${formatShortDate(set.filed_on)} · ${prices}`,
  }
}
