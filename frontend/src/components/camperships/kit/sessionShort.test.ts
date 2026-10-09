/** The one-line session pairing (design-language §14, ruled 10-09): tiny for Family Camp, short for the rest. */
import { describe, expect, it } from 'vitest'

import { aidSessionName } from './sessionShort'

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
