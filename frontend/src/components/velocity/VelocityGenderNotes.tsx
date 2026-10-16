/**
 * The visible lines under a Velocity chart split by gender (#2898 owner answer #78). On the Gender field: that
 * Boys and Girls are the Gender field. On gender identity: how the lines are built, what Another identity and No
 * answer hold, and ruling 58's Gender field count (numbered; nothing at 0).
 */

import type { GenderBasis } from '../../types/velocity'
import {
  ANOTHER_IDENTITY,
  ANOTHER_IDENTITY_MEMBERS,
  NO_ANSWER,
  genderDisplayName,
} from '../camperships/kit/genderIdentity'
import { GenderFallbackPairLine } from '../metrics/genderIdentityNotes'
import { LINE, STRONG, type SeasonFallback } from '../metrics/genderNotes'

function list(words: readonly string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
    : (words[0] ?? '')
}

export function VelocityGenderNotes({
  basis,
  metric,
  noteN,
  seasons,
}: {
  basis: GenderBasis
  metric: 'enrollment' | 'cancellation'
  /** The Gender note's number; undefined when no season shown counted anyone by the Gender field. */
  noteN: number | undefined
  seasons: readonly SeasonFallback[]
}) {
  if (basis === 'field') {
    return (
      <p className={LINE}>
        <b className={STRONG}>Boys and Girls here are the Gender field</b>, the one cabins are
        filled by, so this split matches cabin space. The rest of Analytics counts gender identity.
      </p>
    )
  }
  return (
    <>
      {metric === 'enrollment' ? (
        <p className={LINE}>
          <b className={STRONG}>The gender identity lines are rebuilt from registration records</b>{' '}
          (campers registered by that day and not cancelled by it). The count stored each night
          keeps only the Gender field, so these lines can differ a little from the total line, and
          from the Gender field lines on nights the stored count is read.
        </p>
      ) : (
        <p className={LINE}>
          The gender identity lines read each cancellation’s camper, the same records the Gender
          field lines read.
        </p>
      )}
      <p className={LINE}>
        <b className={STRONG}>{ANOTHER_IDENTITY}</b> ={' '}
        {list(ANOTHER_IDENTITY_MEMBERS.map(genderDisplayName))}.{' '}
        <b className={STRONG}>{NO_ANSWER}</b> = Prefer not to answer + Not given.
      </p>
      {noteN !== undefined && <GenderFallbackPairLine n={noteN} seasons={seasons} />}
    </>
  )
}
