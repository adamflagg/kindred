/**
 * Velocity's gender lines (#2898 owner answer #78). The split reads the Gender field (Boys and Girls, the field
 * cabins fill by: the default) or gender identity (one line per group, in the fixed order, #75 a / #76 a). The
 * response names the basis it was built on, so the lines follow the data on screen.
 */

import type { GenderBasis, SessionGenderBreakdown, VelocityResponse } from '../../types/velocity'
import type { SeasonFallback } from '../metrics/genderNotes'
import {
  GENDER_FIELD_LABEL,
  GENDER_IDENTITY_GROUPS,
  genderDisplayName,
  genderHatched,
  genderIdentityColor,
} from '../camperships/kit/genderIdentity'

/** The URL param holding the picker (`?gender=identity`); absent = the Gender field. */
export const GENDER_BASIS_PARAM = 'gender'

export function parseGenderBasis(raw: string | null): GenderBasis {
  return raw === 'identity' ? 'identity' : 'field'
}

export interface VelocityGenderSeries {
  /** The chart-row key part: `enrolled_${key}`, `weekly_new_${key}_${year}`. */
  readonly key: string
  /** The curve's `gender`: M / F, or an identity group. */
  readonly gender: string
  readonly label: string
  readonly color: string
  /** Another identity folds several identities: a dashed line, as on Trends. */
  readonly dashed: boolean
}

const FIELD_SERIES: readonly VelocityGenderSeries[] = (['M', 'F'] as const).map((gender) => ({
  key: gender === 'M' ? 'boys' : 'girls',
  gender,
  label: GENDER_FIELD_LABEL[gender] ?? gender,
  color: genderIdentityColor(gender),
  dashed: false,
}))

function groupKey(group: string): string {
  return group
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function velocityGenderSeries(
  data: Pick<VelocityResponse, 'gender_basis' | 'by_gender' | 'prior_year_by_gender'> | undefined
): VelocityGenderSeries[] {
  if (data?.gender_basis !== 'identity') return [...FIELD_SERIES]
  const present = new Set([...data.by_gender, ...data.prior_year_by_gender].map((c) => c.gender))
  return GENDER_IDENTITY_GROUPS.filter((group) => present.has(group)).map((group) => ({
    key: groupKey(group),
    gender: group,
    label: genderDisplayName(group),
    color: genderIdentityColor(group),
    dashed: genderHatched(group),
  }))
}

/** A By Session cell: boys / girls on the Gender field, the group's count on gender identity. */
export function sessionGenderCount(
  row: SessionGenderBreakdown | undefined,
  series: VelocityGenderSeries
): number | undefined {
  if (!row) return undefined
  if (series.gender === 'M') return row.boys_enrolled
  if (series.gender === 'F') return row.girls_enrolled
  return row.by_identity?.[series.gender] ?? 0
}

/** Ruling 58's Gender field count: this season, then each compared prior year above 0 (identity split only). */
export function velocityFallbackSeasons(
  data: Pick<
    VelocityResponse,
    'year' | 'gender_fallback_count' | 'prior_year_gender_fallback_counts'
  >
): SeasonFallback[] {
  const priors = Object.entries(data.prior_year_gender_fallback_counts ?? {})
    .map(([season, count]) => ({ season: Number(season), count }))
    .sort((a, b) => b.season - a.season)
  return [{ season: data.year, count: data.gender_fallback_count ?? 0 }, ...priors]
}
