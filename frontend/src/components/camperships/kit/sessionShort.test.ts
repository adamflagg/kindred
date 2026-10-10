/** The one-line session pairing (design-language §14, ruled 10-09): tiny for Family Camp, short for the rest. */
import { describe, expect, it } from 'vitest'

import { aidCellShortName, aidSessionName } from './sessionShort'

describe('aidSessionName', () => {
  it('reads a Family Camp weekend in the tiny form, with no theme', () => {
    expect(aidSessionName('Family Camp 2: Fall Harvest Weekend', 'family')).toBe('FC2')
    expect(aidSessionName('Family Camp 4: Labor Day Weekend', 'family')).toBe('FC4')
  })

  it('knows a Family Camp by its name when the type is missing', () => {
    expect(aidSessionName('Family Camp 3: Spring Weekend', '')).toBe('FC3')
  })

  it('reads every other session in the short form', () => {
    expect(aidSessionName('Session 2', 'main')).toBe('Session 2')
    expect(aidSessionName('All-Gender Cabin-Session 2 (7th & 8th grades)', 'ag')).toBe('AG 2 (7-8)')
    expect(aidSessionName('Rock and River Quest', 'quest')).toBe('Rock and River Quest')
  })

  it('leaves a session with no type as the short form of its name', () => {
    expect(aidSessionName('Quest', '')).toBe('Quest')
    expect(aidSessionName('Session 3', undefined)).toBe('Session 3')
  })

  it('is empty for no session', () => {
    expect(aidSessionName('', 'main')).toBe('')
  })
})

/**
 * The Camperships session cell's short form (ux3 statistics-12; coordinator 10-10: Camperships only, the app-wide
 * `short` keeps #2790's whole un-numbered names): the final mock's NAMED_WEEKENDS rule, a family name that ENDS in
 * a named weekend is that weekend.
 */
describe('aidCellShortName', () => {
  it.each([
    ['JFAM Winter Family Camp', 'Winter Family Camp'],
    ['Young Families Winter Family Camp', 'Winter Family Camp'],
    ['Winter Family Camp', 'Winter Family Camp'],
    ['Weekend of Ready, Set, Camp', 'Ready, Set, Camp'],
    ['Ready, Set, Camp', 'Ready, Set, Camp'],
  ])('a family name ending in a named weekend, %j, is that weekend: %j', (name, expected) => {
    expect(aidCellShortName(name, 'family')).toBe(expected)
  })

  it('leaves every other name to the app-wide short form', () => {
    expect(aidCellShortName('Family Camp 5: Labor Day Weekend', 'family')).toBe('Family Camp 5')
    expect(aidCellShortName('Spring Family Camp', 'family')).toBe('Spring Family Camp')
    expect(aidCellShortName('All-Gender Cabin-Session 2 (7th & 8th grades)', 'ag')).toBe(
      'AG 2 (7-8)'
    )
    // the rule is a family one: a non-family name that happens to end so is not touched
    expect(aidCellShortName('Staff Winter Family Camp', 'other')).toBe('Staff Winter Family Camp')
  })
})
