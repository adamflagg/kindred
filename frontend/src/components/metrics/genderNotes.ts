/**
 * The words and counts behind Analytics' gender identity notes (#2898); the lines that render them are in
 * genderIdentityNotes.tsx. Owner ruling 58 (b): a camper with no identity answer counts by the Gender field.
 */

import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'
import { identityGroup } from '../camperships/kit/genderIdentity'
import { formatCount } from '../../utils/numberFormat'

export const WHAT = 'with no gender identity answer'

export function campers(n: number): string {
  return n === 1 ? 'camper' : 'campers'
}

/** Every label's count folded into the five groups (#75 a). */
export function groupCounts(by: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [label, count] of Object.entries(by)) {
    const group = identityGroup(label)
    out[group] = (out[group] ?? 0) + count
  }
  return out
}

export interface SeasonFallback {
  readonly season: number
  readonly count: number
  /** The season's campers, for "798 of 1,139". */
  readonly of?: number
}

/** The page's season, and the compare season when Compare is on, with each one's Gender field count. */
export function shownFallbackSeasons(
  currentYear: number,
  data: { gender_fallback_count?: number } | null | undefined,
  compareYear: number | null,
  compData: { gender_fallback_count?: number } | null | undefined
): SeasonFallback[] {
  return [
    { season: currentYear, count: data?.gender_fallback_count ?? 0 },
    ...(compareYear !== null && compData
      ? [{ season: compareYear, count: compData.gender_fallback_count ?? 0 }]
      : []),
  ]
}

export function seasonsText(seasons: readonly SeasonFallback[]): SeasonFallback[] {
  return seasons.filter((s) => s.count > 0)
}

const GENDER_DEFINITION =
  'Gender: gender identity from CampMinder; a write-in counts as Self-described.'

/** The page-foot note defining Gender, with each season's Gender field count above 0. */
export function genderNote(
  n: number,
  seasons: readonly SeasonFallback[],
  after = ''
): DefinitionNote {
  const shown = seasonsText(seasons)
  if (shown.length === 0) return { n, term: 'Gender', text: GENDER_DEFINITION + after }
  const parts = shown.map((s, i) =>
    i === 0
      ? `${formatCount(s.count)} ${campers(s.count)} in ${s.season}`
      : `${formatCount(s.count)} in ${s.season}`
  )
  const total = shown.reduce((sum, s) => sum + s.count, 0)
  return {
    n,
    term: 'Gender',
    text:
      `${GENDER_DEFINITION} ${parts.join(' and ')} ${WHAT} ${total === 1 ? 'is' : 'are'} counted by the ` +
      `Gender field (F as Girl/woman, M as Boy/man).${after}`,
  }
}

// #82 (a), ruled by the owner: Retention says "Read with care" when more than a quarter of the base season has no
// identity answer, because CampMinder holds answers mostly for campers who came back later (survivorship).
export const READ_WITH_CARE_ON = true as boolean
export const READ_WITH_CARE_SHARE = 0.25

export function needsReadWithCare(fallback: number, base: number): boolean {
  return READ_WITH_CARE_ON && base > 0 && fallback / base > READ_WITH_CARE_SHARE
}
