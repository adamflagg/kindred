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

    const { container } = render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // Should NOT render the raw object toString representation
    expect(screen.queryByText(/\[object Object\]/i)).toBeNull()

    // All-object section returns null before any row renders — nothing in the DOM
    expect(container.firstChild).toBeNull()

    consoleSpy.mockRestore()
  })

  it('returns null when every config in the section has an object-typed value', () => {
    // Finding #2: all-objects section must not render a ghost card
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const obj1 = makeItem({
      id: 'rec1',
      config_key: 'a',
      description: 'row a',
      value: { x: 1 } as unknown as number,
    })
    const obj2 = makeItem({
      id: 'rec2',
      config_key: 'b',
      description: 'row b',
      value: { y: 2 } as unknown as number,
    })
    const section = makeSection([obj1, obj2])

    const { container } = render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // Component should return null — nothing rendered
    expect(container.firstChild).toBeNull()

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

    // Positive assertion: the row description is visible to users (row-specific text)
    expect(screen.getByText('A test config')).toBeVisible()
    consoleSpy.mockRestore()
  })

  it('count badge reflects only displayable (non-object) configs', () => {
    // Finding #1: badge must not overcount when object-typed configs are filtered
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const numericItem = makeItem({ id: 'rec-n', config_key: 'penalty.soft', value: 10 })
    const objectItem = makeItem({
      id: 'rec-o',
      config_key: 'budget.obj',
      value: { x: 1 } as unknown as number,
    })
    // section has 2 configs, but only 1 is displayable
    const section = makeSection([numericItem, objectItem])

    render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // The badge should show "1", not "2"
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('2')).toBeNull()

    // renderConfigRow is still called for the object item and should warn
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('budget.2026.budget.obj'))

    consoleSpy.mockRestore()
  })

  it('renders null value as empty string, not the literal text "null"', () => {
    // Finding #4: String(null) === "null"; must coalesce to empty string
    const nullItem = makeItem({
      config_key: 'optional.field',
      value: null as unknown as number,
    })
    const section = makeSection([nullItem])

    render(
      <SectionCard
        section={section}
        editedValues={{}}
        onValueChange={() => {}}
        defaultExpanded={true}
      />
    )

    // The literal text "null" must not appear in any input
    expect(screen.queryByDisplayValue('null')).toBeNull()
  })
})
