import { describe, it, expect } from 'vitest'
import { PROGRAM_BUTTONS, type ProgramButtonConfig } from './programButtons'

describe('PROGRAM_BUTTONS config', () => {
  it('has exactly 3 entries', () => {
    expect(PROGRAM_BUTTONS).toHaveLength(3)
  })

  it('contains summer, weekend, and analytics programs in order', () => {
    expect(PROGRAM_BUTTONS.map((b) => b.program)).toEqual(['summer', 'weekend', 'analytics'])
  })

  it('each entry has all required keys with correct types', () => {
    const stringKeys = [
      'program',
      'label',
      'dropdownLabel',
      'triggerColorClass',
      'activeClass',
      'inactiveClass',
    ] as const

    for (const btn of PROGRAM_BUTTONS) {
      for (const key of stringKeys) {
        expect(typeof btn[key]).toBe('string')
      }
      // Lucide icons are React ForwardRef components (objects with $$typeof)
      expect(btn.icon).toBeDefined()
      expect(typeof btn.icon === 'function' || typeof btn.icon === 'object').toBe(true)
    }
  })

  it('summer has correct labels', () => {
    const summer = PROGRAM_BUTTONS.find((b) => b.program === 'summer') as ProgramButtonConfig
    expect(summer.label).toBe('Summer')
    expect(summer.dropdownLabel).toBe('Summer Bunking')
  })

  it('weekend has correct labels', () => {
    const weekend = PROGRAM_BUTTONS.find((b) => b.program === 'weekend') as ProgramButtonConfig
    expect(weekend.label).toBe('Weekend')
    expect(weekend.dropdownLabel).toBe('Weekend Housing')
  })

  it('analytics has correct labels', () => {
    const analytics = PROGRAM_BUTTONS.find((b) => b.program === 'analytics') as ProgramButtonConfig
    expect(analytics.label).toBe('Analytics')
    expect(analytics.dropdownLabel).toBe('Camp Analytics')
  })
})
