/**
 * The household page's answer sets, labelled by form (adult aid form design GF-2 B): each form prices its own bucket,
 * so a household where an adult filed the adult aid form shows two sets. Pure words.
 */
import type { ApiAidAnswer, ApiAidHouseholdPage } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import type { FormSource } from '../kit/words'
import { programLabel } from '../requests/programLabel'

/** One answer set on the household page: which form, who filed it and when, and the requests it prices. */
export interface AnswerSet {
  readonly source: FormSource
  /** Who filed it and when; CampMinder's household form names neither on the page, so its band leaves them out. */
  readonly filed_by?: string | undefined
  readonly filed_on?: string | undefined
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
  const filed = [set.filed_by ?? '', set.filed_on ? formatShortDate(set.filed_on) : '']
    .filter(Boolean)
    .join(', ')
  return {
    name: FORM_NAME[set.source],
    meta: filed === '' ? prices : `${filed} · ${prices}`,
  }
}

/** One request's own adult aid form answer set (GF-2 B): its band's words and its figures. */
export interface OwnAnswerSet {
  readonly requestId: string
  readonly set: AnswerSet
  readonly answers: readonly ApiAidAnswer[]
}

/**
 * The page's answer sets by form (GF-2 B), or null when only CampMinder's form prices the household's requests, so
 * its Income keeps the one-form table. `campminder` prices every request with no answer set of its own.
 */
export function answerSetsOf(
  page: ApiAidHouseholdPage
): { readonly campminder: AnswerSet; readonly own: readonly OwnAnswerSet[] } | null {
  const own = page.requests.filter((r) => r.answers_source === 'google_form')
  if (own.length === 0) return null
  const priced = (r: ApiAidHouseholdPage['requests'][number]) => ({
    camper_name: r.row.camper_name,
    program_key: r.row.program_key ?? '',
  })
  return {
    campminder: {
      source: 'campminder',
      prices: page.requests.filter((r) => r.answers_source !== 'google_form').map(priced),
    },
    own: own.map((r) => ({
      requestId: r.row.request_id,
      set: {
        source: 'google_form',
        filed_by: r.row.camper_name,
        filed_on: r.form_submitted_at ?? '',
        prices: [priced(r)],
      },
      answers: r.own_answers ?? [],
    })),
  }
}
