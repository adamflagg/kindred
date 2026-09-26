import { describe, expect, it } from 'vitest'

import { scenarioForWeekend } from './weekendScenario'

describe('scenarioForWeekend', () => {
  it('reads as the CampMinder mirror with no selection', () => {
    expect(scenarioForWeekend(null, 5001)).toBe('')
  })

  it('reads as the mirror when the selection belongs to a different session', () => {
    expect(scenarioForWeekend({ id: 'scenario-a', session_cm_id: 5001 }, 5002)).toBe('')
  })

  it('passes the scenario id through when the selection matches this session', () => {
    expect(scenarioForWeekend({ id: 'scenario-a', session_cm_id: 5001 }, 5001)).toBe('scenario-a')
  })
})
