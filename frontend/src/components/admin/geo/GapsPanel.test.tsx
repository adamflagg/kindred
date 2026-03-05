/**
 * Tests for GapsPanel component.
 *
 * TDD: Tests written first to define expected rendering behavior for
 * three-tier gap display: canonical_no_coords, non_canonical_grouped,
 * non_canonical_ungrouped, plus empty state and onResolve callback.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { GapsPanel } from './GapsPanel'
import type { GapsResponse } from '../../../services/geoService'

// ---------------------------------------------------------------------------
// Test data (fictional names per project conventions)
// ---------------------------------------------------------------------------
const fullGaps: GapsResponse = {
  canonical_no_coords: [
    { name: 'Riverside Elementary', count: 14, percentage: 8.2, source_count: 3 },
    { name: 'Oak Valley Middle', count: 5, percentage: 2.9, source_count: 2 },
  ],
  non_canonical_grouped: [
    { name: 'Hillcrest High', count: 10, percentage: 5.8, source_count: 4 },
    { name: 'Lakewood Academy', count: 3, percentage: 1.7, source_count: 1 },
  ],
  non_canonical_ungrouped: [
    { name: 'Mapleton Prep', count: 7, percentage: 4.1, source_count: 0 },
    { name: 'Cedar Ridge School', count: 2, percentage: 1.2, source_count: 0 },
  ],
  total_gaps: 6,
}

const emptyGaps: GapsResponse = {
  canonical_no_coords: [],
  non_canonical_grouped: [],
  non_canonical_ungrouped: [],
  total_gaps: 0,
}

const onlyCoordsGaps: GapsResponse = {
  canonical_no_coords: [
    { name: 'Riverside Elementary', count: 14, percentage: 8.2, source_count: 3 },
  ],
  non_canonical_grouped: [],
  non_canonical_ungrouped: [],
  total_gaps: 1,
}

const onlyGroupedGaps: GapsResponse = {
  canonical_no_coords: [],
  non_canonical_grouped: [
    { name: 'Hillcrest High', count: 10, percentage: 5.8, source_count: 4 },
  ],
  non_canonical_ungrouped: [],
  total_gaps: 1,
}

const onlyUngroupedGaps: GapsResponse = {
  canonical_no_coords: [],
  non_canonical_grouped: [],
  non_canonical_ungrouped: [
    { name: 'Mapleton Prep', count: 7, percentage: 4.1, source_count: 0 },
  ],
  total_gaps: 1,
}

// ---------------------------------------------------------------------------
// Three sections render separately
// ---------------------------------------------------------------------------
describe('GapsPanel sections', () => {
  it('renders all three gap sections when data is present', () => {
    render(<GapsPanel gaps={fullGaps} category="school" year={2025} />)

    // Each section should have a data-testid distinguishing it
    expect(screen.getByTestId('section-canonical-no-coords')).toBeInTheDocument()
    expect(screen.getByTestId('section-non-canonical-grouped')).toBeInTheDocument()
    expect(screen.getByTestId('section-non-canonical-ungrouped')).toBeInTheDocument()
  })

  it('renders only canonical_no_coords section when others are empty', () => {
    render(<GapsPanel gaps={onlyCoordsGaps} category="school" year={2025} />)

    expect(screen.getByTestId('section-canonical-no-coords')).toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-grouped')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-ungrouped')).not.toBeInTheDocument()
  })

  it('renders only non_canonical_grouped section when others are empty', () => {
    render(<GapsPanel gaps={onlyGroupedGaps} category="school" year={2025} />)

    expect(screen.queryByTestId('section-canonical-no-coords')).not.toBeInTheDocument()
    expect(screen.getByTestId('section-non-canonical-grouped')).toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-ungrouped')).not.toBeInTheDocument()
  })

  it('renders only non_canonical_ungrouped section when others are empty', () => {
    render(<GapsPanel gaps={onlyUngroupedGaps} category="school" year={2025} />)

    expect(screen.queryByTestId('section-canonical-no-coords')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-grouped')).not.toBeInTheDocument()
    expect(screen.getByTestId('section-non-canonical-ungrouped')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section content
// ---------------------------------------------------------------------------
describe('GapsPanel section content', () => {
  it('shows canonical name, camper count, and source variant count for canonical_no_coords items', () => {
    render(<GapsPanel gaps={fullGaps} category="school" year={2025} />)

    // Riverside Elementary: 14 campers, 3 source variants
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows value, camper count, and source count for non_canonical_grouped items', () => {
    render(<GapsPanel gaps={fullGaps} category="school" year={2025} />)

    expect(screen.getByText('Hillcrest High')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Lakewood Academy')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows value and camper count for non_canonical_ungrouped items', () => {
    render(<GapsPanel gaps={fullGaps} category="school" year={2025} />)

    expect(screen.getByText('Mapleton Prep')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Cedar Ridge School')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------
describe('GapsPanel actions', () => {
  it('shows "Add Location" button for canonical_no_coords items', () => {
    render(<GapsPanel gaps={onlyCoordsGaps} category="school" year={2025} />)

    const addButton = screen.getByRole('button', { name: /add location/i })
    expect(addButton).toBeInTheDocument()
  })

  it('shows "Resolve" button for non_canonical_grouped items', () => {
    render(<GapsPanel gaps={onlyGroupedGaps} category="school" year={2025} />)

    const resolveButton = screen.getByRole('button', { name: /resolve/i })
    expect(resolveButton).toBeInTheDocument()
  })

  it('shows "Resolve" button for non_canonical_ungrouped items', () => {
    render(<GapsPanel gaps={onlyUngroupedGaps} category="school" year={2025} />)

    const resolveButton = screen.getByRole('button', { name: /resolve/i })
    expect(resolveButton).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('GapsPanel empty state', () => {
  it('renders empty state when no gaps exist', () => {
    render(<GapsPanel gaps={emptyGaps} category="school" year={2025} />)

    expect(screen.getByText(/no gaps/i)).toBeInTheDocument()
    expect(screen.queryByTestId('section-canonical-no-coords')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-grouped')).not.toBeInTheDocument()
    expect(screen.queryByTestId('section-non-canonical-ungrouped')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// onResolve callback
// ---------------------------------------------------------------------------
describe('GapsPanel onResolve callback', () => {
  it('calls onResolve with correct name and type for canonical_no_coords item', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()

    render(
      <GapsPanel gaps={onlyCoordsGaps} category="school" year={2025} onResolve={onResolve} />
    )

    const addButton = screen.getByRole('button', { name: /add location/i })
    await user.click(addButton)

    expect(onResolve).toHaveBeenCalledWith('Riverside Elementary', 'canonical_no_coords')
  })

  it('calls onResolve with correct name and type for non_canonical_grouped item', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()

    render(
      <GapsPanel gaps={onlyGroupedGaps} category="school" year={2025} onResolve={onResolve} />
    )

    const resolveButton = screen.getByRole('button', { name: /resolve/i })
    await user.click(resolveButton)

    expect(onResolve).toHaveBeenCalledWith('Hillcrest High', 'non_canonical_grouped')
  })

  it('calls onResolve with correct name and type for non_canonical_ungrouped item', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()

    render(
      <GapsPanel gaps={onlyUngroupedGaps} category="school" year={2025} onResolve={onResolve} />
    )

    const resolveButton = screen.getByRole('button', { name: /resolve/i })
    await user.click(resolveButton)

    expect(onResolve).toHaveBeenCalledWith('Mapleton Prep', 'non_canonical_ungrouped')
  })
})

// ---------------------------------------------------------------------------
// Sorting by camper count
// ---------------------------------------------------------------------------
describe('GapsPanel sorting', () => {
  it('sorts canonical_no_coords items by camper count descending', () => {
    const gaps: GapsResponse = {
      canonical_no_coords: [
        { name: 'Oak Valley Middle', count: 5, percentage: 2.9, source_count: 2 },
        { name: 'Riverside Elementary', count: 14, percentage: 8.2, source_count: 3 },
      ],
      non_canonical_grouped: [],
      non_canonical_ungrouped: [],
      total_gaps: 2,
    }
    render(<GapsPanel gaps={gaps} category="school" year={2025} />)

    const section = screen.getByTestId('section-canonical-no-coords')
    const names = within(section as HTMLElement).getAllByTestId('gap-item-name').map((el) => el.textContent)
    expect(names).toEqual(['Riverside Elementary', 'Oak Valley Middle'])
  })

  it('sorts non_canonical_grouped items by camper count descending', () => {
    const gaps: GapsResponse = {
      canonical_no_coords: [],
      non_canonical_grouped: [
        { name: 'Lakewood Academy', count: 3, percentage: 1.7, source_count: 1 },
        { name: 'Hillcrest High', count: 10, percentage: 5.8, source_count: 4 },
      ],
      non_canonical_ungrouped: [],
      total_gaps: 2,
    }
    render(<GapsPanel gaps={gaps} category="school" year={2025} />)

    const section = screen.getByTestId('section-non-canonical-grouped')
    const names = within(section as HTMLElement).getAllByTestId('gap-item-name').map((el) => el.textContent)
    expect(names).toEqual(['Hillcrest High', 'Lakewood Academy'])
  })

  it('sorts non_canonical_ungrouped items by camper count descending', () => {
    const gaps: GapsResponse = {
      canonical_no_coords: [],
      non_canonical_grouped: [],
      non_canonical_ungrouped: [
        { name: 'Cedar Ridge School', count: 2, percentage: 1.2, source_count: 0 },
        { name: 'Mapleton Prep', count: 7, percentage: 4.1, source_count: 0 },
      ],
      total_gaps: 2,
    }
    render(<GapsPanel gaps={gaps} category="school" year={2025} />)

    const section = screen.getByTestId('section-non-canonical-ungrouped')
    const names = within(section as HTMLElement).getAllByTestId('gap-item-name').map((el) => el.textContent)
    expect(names).toEqual(['Mapleton Prep', 'Cedar Ridge School'])
  })
})
