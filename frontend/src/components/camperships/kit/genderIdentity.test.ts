import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ANOTHER_IDENTITY,
  GENDER_FIELD_LABEL,
  GENDER_HATCH_IMAGE,
  genderHatched,
  GENDER_IDENTITY_COLOR,
  GENDER_IDENTITY_GROUPS,
  GENDER_IDENTITY_ORDER,
  NO_ANSWER,
  genderDisplayName,
  genderIdentityColor,
  identityGroup,
  identityOrderIndex,
  sortByIdentityOrder,
} from './genderIdentity'

describe('gender identity tokens (#2898; owner answers #75, #76, #77)', () => {
  it('lists every label in the fixed order, as the backend does (bunking/gender_identity.py)', () => {
    expect(GENDER_IDENTITY_ORDER).toEqual([
      'Girl/woman',
      'Boy/man',
      'Non-binary',
      'Transgender girl/woman',
      'Transgender boy/man',
      'Agender',
      'Not listed above',
      'self-described',
      'Prefer not to answer',
      'not given',
    ])
    const backend = readFileSync(
      join(__dirname, '../../../../../bunking/gender_identity.py'),
      'utf8'
    )
    for (const label of ['Girl/woman', 'Non-binary', 'Agender', 'Not listed above']) {
      expect(backend).toContain(`"${label}"`)
    }
  })

  it('folds labels into five fixed groups; transgender campers sit under Another identity (#75 a)', () => {
    expect(GENDER_IDENTITY_GROUPS).toEqual([
      'Girl/woman',
      'Boy/man',
      'Non-binary',
      ANOTHER_IDENTITY,
      NO_ANSWER,
    ])
    expect(identityGroup('Girl/woman')).toBe('Girl/woman')
    expect(identityGroup('Non-binary')).toBe('Non-binary')
    for (const label of [
      'Transgender girl/woman',
      'Transgender boy/man',
      'Agender',
      'Not listed above',
      'self-described',
      'Two-spirit',
    ]) {
      expect(identityGroup(label)).toBe(ANOTHER_IDENTITY)
    }
    expect(identityGroup('Prefer not to answer')).toBe(NO_ANSWER)
    expect(identityGroup('not given')).toBe(NO_ANSWER)
  })

  it('names one distinct colour per label and group, the greys theme-aware (#77 a)', () => {
    const named = [...GENDER_IDENTITY_ORDER, ANOTHER_IDENTITY, NO_ANSWER]
    for (const label of named) expect(GENDER_IDENTITY_COLOR[label]).toBeTruthy()
    const hues = named
      .filter((l) => l !== NO_ANSWER) // No answer wears Not given's grey
      .map((l) => GENDER_IDENTITY_COLOR[l])
    expect(new Set(hues).size).toBe(hues.length)
    expect(GENDER_IDENTITY_COLOR['Girl/woman']).toBe('#d9266b')
    expect(GENDER_IDENTITY_COLOR['Boy/man']).toBe('#1f8fc4')
    expect(GENDER_IDENTITY_COLOR['Prefer not to answer']).toBe('var(--gender-prefer-not)')
    expect(GENDER_IDENTITY_COLOR['not given']).toBe('var(--gender-not-given)')
    const css = readFileSync(join(__dirname, '../../../index.css'), 'utf8')
    expect(css.match(/--gender-prefer-not:/g)).toHaveLength(2) // light and dark
    expect(css.match(/--gender-not-given:/g)).toHaveLength(2)
  })

  it('the Gender field wears the Girl/woman and Boy/man hues', () => {
    expect(genderIdentityColor('F')).toBe(GENDER_IDENTITY_COLOR['Girl/woman'])
    expect(genderIdentityColor('M')).toBe(GENDER_IDENTITY_COLOR['Boy/man'])
    expect(GENDER_FIELD_LABEL).toEqual({ F: 'Girls', M: 'Boys' })
  })

  it('an unknown label gets Another identity’s colour, never a blank', () => {
    expect(genderIdentityColor('Two-spirit')).toBe(GENDER_IDENTITY_COLOR[ANOTHER_IDENTITY])
  })

  it('capitalises the two lower-case labels for display only', () => {
    expect(genderDisplayName('self-described')).toBe('Self-described')
    expect(genderDisplayName('not given')).toBe('Not given')
    expect(genderDisplayName('Non-binary')).toBe('Non-binary')
  })

  it('sorts by the fixed order, unknown labels after the known identities and before the non-answers', () => {
    const sorted = sortByIdentityOrder(
      [
        'not given',
        'Two-spirit',
        'Boy/man',
        'self-described',
        'Girl/woman',
        NO_ANSWER,
        ANOTHER_IDENTITY,
      ],
      (l) => l
    )
    expect(sorted).toEqual([
      'Girl/woman',
      'Boy/man',
      'Two-spirit',
      'self-described',
      ANOTHER_IDENTITY,
      'not given',
      NO_ANSWER,
    ])
    expect(identityOrderIndex('Girl/woman')).toBeLessThan(identityOrderIndex('Boy/man'))
  })

  it('hatches the one group that folds several identities, as the mock draws it', () => {
    expect(genderHatched(ANOTHER_IDENTITY)).toBe(true)
    expect(genderHatched('Non-binary')).toBe(false)
    expect(genderHatched(NO_ANSWER)).toBe(false)
    expect(GENDER_HATCH_IMAGE).toContain('repeating-linear-gradient(45deg')
  })
})
