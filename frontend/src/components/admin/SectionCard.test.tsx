/**
 * Tests for SectionCard render-bug guard.
 * Verifies that object-typed config values are NOT rendered as [object Object].
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SectionCard } from './SectionCard'
import type { ConfigSection, ConfigWithMetadata } from '../../hooks/useSolverConfig'
import type { IsoAutoDateString } from '../../types/pocketbase-types'

const makeItem = (overrides: Partial<ConfigWithMetadata> = {}): ConfigWithMetadata => ({
  id: 'rec123',
  category: 'budget',
  subcategory: '2026',
  config_key: 'session_1344559',
  value: 42,
  description: 'A test config',
  created: '2026-01-01T00:00:00Z' as unknown as IsoAutoDateString,
  updated: '2026-01-01T00:00:00Z' as unknown as IsoAutoDateString,
  metadata: { section: 'session-budget', friendly_name: 'Session Budget' },
  ...overrides,
})

const makeSection = (configs: ConfigWithMetadata[]): ConfigSection => ({
  id: 'sec1',
  section_key: 'session-budget',
  title: 'Session Budget',
  description: undefined,
  display_order: 1,
  expanded_by_default: true,
  configs,
})

describe('SectionCard object-value guard', () => {
  it('does not render [object Object] for object-typed values', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const objectItem = makeItem({
      // Cast to unknown first to work around strict typing — simulates runtime drift
      value: { participant_goal: 200, session_fee: 5800 } as unknown as number,
    })
    const section = makeSection([objectItem])

    render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // Should NOT render the raw object toString representation
    expect(screen.queryByText(/\[object Object\]/i)).toBeNull()

    // Should have warned with the config key (and only the key — no value, to avoid leaking)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('budget.2026.session_1344559'))

    consoleSpy.mockRestore()
  })

  it('renders normally for primitive (number) values', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const numericItem = makeItem({ config_key: 'penalty.soft', value: 10 })
    const section = makeSection([numericItem])

    render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // No warning for valid primitive values
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
