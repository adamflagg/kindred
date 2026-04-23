import { describe, it, expect } from 'vitest'
import { savedScenarioToScenario } from './scenarioTransform'
import type { SavedScenario } from '../types/app-types'

describe('savedScenarioToScenario', () => {
  it('handles a record with no expand property', () => {
    // This simulates the record PocketBase returns from create() when no expand is requested
    const recordWithoutExpand = {
      id: 'scenario-xyz',
      name: 'Empty',
      session: 'pb-session-1',
      year: 2025,
      is_active: true,
      created: '2026-04-23T00:00:00Z',
      updated: '2026-04-23T00:00:00Z',
      description: '',
      // no expand field at all
    } as unknown as SavedScenario

    // Must not throw "Cannot read properties of undefined (reading 'session')"
    expect(() => savedScenarioToScenario(recordWithoutExpand)).not.toThrow()
    const scenario = savedScenarioToScenario(recordWithoutExpand)
    expect(scenario.id).toBe('scenario-xyz')
    expect(scenario.session_cm_id).toBe(0) // fallback when expand missing
    expect(scenario.name).toBe('Empty')
  })

  it('extracts session_cm_id when expand.session is present', () => {
    const record = {
      id: 'scenario-2',
      name: 'With Expand',
      session: 'pb-session-1',
      year: 2025,
      is_active: true,
      created: '2026-04-23T00:00:00Z',
      updated: '2026-04-23T00:00:00Z',
      description: '',
      expand: { session: { cm_id: 1000042 } },
    } as unknown as SavedScenario

    const scenario = savedScenarioToScenario(record)
    expect(scenario.session_cm_id).toBe(1000042)
  })
})
