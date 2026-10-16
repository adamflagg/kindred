/**
 * Analytics' gender colours and stacked-bar segments, read from the kit's gender identity tokens
 * (`camperships/kit/genderIdentity.ts`, design language "Gender identity") so every chart wears the same
 * colour per label.
 */

import {
  ANOTHER_IDENTITY,
  GENDER_IDENTITY_COLOR,
  GENDER_IDENTITY_GROUPS,
  GENDER_IDENTITY_ORDER,
  NO_ANSWER,
  genderDisplayName,
  genderHatched,
  genderIdentityColor,
} from '../camperships/kit/genderIdentity'
import { groupCounts } from './genderNotes'
import type { VerticalStackedSegment } from './CssVerticalStackedBarChart'

/** A label's colour (F and M, the Gender field, wear Girl/woman's and Boy/man's). */
export const getGenderColor = genderIdentityColor

/** Colour by the name a chart displays (`transformGenderData`'s "Self-described", "Not given"). */
export const GENDER_DISPLAY_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  [...GENDER_IDENTITY_ORDER, ANOTHER_IDENTITY, NO_ANSWER].map((label) => [
    genderDisplayName(label),
    GENDER_IDENTITY_COLOR[label] ?? genderIdentityColor(label),
  ])
)

/** A stacked-bar row's group columns from a `by_gender` count (#75 a). */
export const genderGroupRow = groupCounts

/** One segment per group any row counts, in the fixed order (#76 a); Another identity hatched. */
export function genderGroupSegments(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>
): VerticalStackedSegment[] {
  return GENDER_IDENTITY_GROUPS.filter((group) =>
    rows.some((row) => typeof row[group] === 'number' && row[group] > 0)
  ).map((group) => ({
    key: group,
    label: genderDisplayName(group),
    color: genderIdentityColor(group),
    ...(genderHatched(group) ? { hatch: true } : {}),
  }))
}
