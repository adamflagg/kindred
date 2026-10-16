/**
 * The words Analytics puts beside a gender identity split (#2898). Owner ruling 58 (b): a camper with no identity
 * answer counts by the Gender field, and every split that does so says how many campers, in a visible line under
 * the chart or table (#72 a), never at 0 (#73 a), with the page-foot note defining Gender.
 */

import {
  ANOTHER_IDENTITY,
  NO_ANSWER,
  genderDisplayName,
  identityGroup,
  sortByIdentityOrder,
} from '../camperships/kit/genderIdentity'
import { formatCount } from '../../utils/numberFormat'
import { WHAT, campers, needsReadWithCare, seasonsText, type SeasonFallback } from './genderNotes'

export type { SeasonFallback } from './genderNotes'

const LINE = 'text-muted-foreground border-border mt-3 border-t pt-2 text-xs leading-[17px]'
const STRONG = 'text-foreground font-semibold'

function Sup({ n }: { n: number }) {
  return <sup className="text-[0.8em]">{n}</sup>
}

/** "² 762 campers with no gender identity answer are counted by the Gender field." Nothing at 0. */
export function GenderFallbackLine({
  n,
  count,
  season,
}: {
  n: number
  count: number
  /** Which campers, when the chart reads a season other than the page's ("2017 campers"). */
  season?: string | undefined
}) {
  if (count <= 0) return null
  return (
    <p className={LINE}>
      <Sup n={n} /> <b className={STRONG}>{formatCount(count)}</b> {campers(count)} {WHAT}{' '}
      {count === 1 ? 'is' : 'are'} counted by the Gender field{season ? ` (${season})` : ''}.
    </p>
  )
}

/** A comparison table's line: "² 762 in 2018 and 798 in 2017: campers … counted by the Gender field." */
export function GenderFallbackPairLine({
  n,
  seasons,
}: {
  n: number
  seasons: readonly SeasonFallback[]
}) {
  const shown = seasons.filter((s) => s.count > 0)
  if (shown.length === 0) return null
  return (
    <p className={LINE}>
      <Sup n={n} />{' '}
      {shown.map((s, i) => (
        <span key={s.season}>
          {i > 0 && ' and '}
          <b className={STRONG}>{formatCount(s.count)}</b> in {s.season}
        </span>
      ))}
      : campers {WHAT}, counted by the Gender field.
    </p>
  )
}

/** Trends' line (#74 a): every season above 0, "2017: 798 of 1,139 · 2023: 1". */
export function GenderFallbackSeasonsLine({
  n,
  seasons,
}: {
  n: number
  seasons: readonly SeasonFallback[]
}) {
  const shown = seasonsText(seasons)
  if (shown.length === 0) return null
  return (
    <p className={LINE}>
      <Sup n={n} /> Campers {WHAT}, counted by the Gender field:{' '}
      {shown.map((s, i) => (
        <span key={s.season}>
          {i > 0 && ' · '}
          <b className={STRONG}>{s.season}</b>: {formatCount(s.count)}
          {s.count > 1 && s.of !== undefined ? ` of ${formatCount(s.of)}` : ''}
        </span>
      ))}
      .
    </p>
  )
}

/** Under a grouped chart (#75 a): what Another identity and No answer hold, with counts. */
export function AnotherIdentityLine({
  counts,
}: {
  counts: ReadonlyArray<Readonly<Record<string, number>>>
}) {
  const totals: Record<string, number> = {}
  for (const by of counts) {
    for (const [label, count] of Object.entries(by)) {
      if (identityGroup(label) === ANOTHER_IDENTITY) totals[label] = (totals[label] ?? 0) + count
    }
  }
  const list = sortByIdentityOrder(
    Object.keys(totals).filter((label) => (totals[label] ?? 0) > 0),
    (label) => label
  )
    .map((label) => `${genderDisplayName(label)} ${formatCount(totals[label])}`)
    .join(', ')
  return (
    <p className={LINE}>
      <b className={STRONG}>{ANOTHER_IDENTITY}</b> = {list || 'none this season'}.{' '}
      <b className={STRONG}>{NO_ANSWER}</b> = Prefer not to answer + Not given. Every label stays
      separate in the drill-down and the CSV.
    </p>
  )
}

function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—'
}

export function ReadWithCareLine({
  season,
  base,
  returned,
  fallback,
  fallbackReturned,
}: {
  season: number
  base: number
  returned: number
  fallback: number
  fallbackReturned: number
}) {
  if (!needsReadWithCare(fallback, base)) return null
  const answered = base - fallback
  const answeredReturned = returned - fallbackReturned
  return (
    <p className={`${LINE} text-amber-800 dark:text-amber-300`}>
      <b className="font-semibold">Read with care:</b> {formatCount(fallback)} of{' '}
      {formatCount(base)} {season} campers have no identity answer. CampMinder holds an answer
      mostly for campers who came back in later summers, so the identity rows here look more likely
      to return than they were ({season}: {rate(answeredReturned, answered)} of campers with an
      answer returned, {rate(fallbackReturned, fallback)} of those without).
    </p>
  )
}
