/**
 * Tests for GeoGapsList component.
 *
 * TDD: Tests written first to define expected rendering behavior for
 * splitting gaps into "Unmapped" (canonical with no coords) vs
 * "Unresolved" (raw values with no canonical match).
 */
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GeoGapsList } from './GeoGapsList'
import type { GeoDataItem } from './GeoMap'
import type { SourceMapping } from '../../../hooks/useSourceMappings'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const schoolGaps: GeoDataItem[] = [
  { name: 'Riverside Elementary', count: 14, percentage: 8.2 },
  { name: 'Oak Valley Middle', count: 5, percentage: 2.9 },
  { name: 'Hillcrest High', count: 2, percentage: 1.2 },
]

const sourceMappings = new Map<string, SourceMapping[]>([
  [
    'Riverside Elementary',
    [
      { original: 'Riverside Elem', count: 10, confidence: 0.95 },
      { original: 'Riverside Elementary School', count: 4, confidence: 0.9 },
    ],
  ],
  ['Oak Valley Middle', [{ original: 'Oak Valley MS', count: 5, confidence: 0.88 }]],
])

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('GeoGapsList empty state', () => {
  it('renders nothing when gaps is empty', () => {
    const { container } = render(<GeoGapsList gaps={[]} category="school" />)
    expect(container.innerHTML).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Legacy behavior (no sourceMappings prop)
// ---------------------------------------------------------------------------
describe('GeoGapsList legacy behavior (no sourceMappings)', () => {
  it('shows all items as "Unmapped" with plural category', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" />)
    expect(screen.getByText(/3 Unmapped Schools/)).toBeInTheDocument()
  })

  it('shows singular category for a single gap item', () => {
    const singleGap: GeoDataItem[] = [{ name: 'Riverside Elementary', count: 14, percentage: 8.2 }]
    render(<GeoGapsList gaps={singleGap} category="school" />)
    expect(screen.getByText(/1 Unmapped School$/)).toBeInTheDocument()
  })

  it('does not show an "Unresolved" section', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" />)
    expect(screen.queryByText(/Unresolved/)).not.toBeInTheDocument()
  })

  it('sorts items by count descending', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" />)
    const rows = screen.getAllByRole('row')
    const names = rows.map(
      (row) => within(row).getByText(/Elementary|Valley|Hillcrest/).textContent
    )
    expect(names).toEqual(['Riverside Elementary', 'Oak Valley Middle', 'Hillcrest High'])
  })
})

// ---------------------------------------------------------------------------
// With sourceMappings — split into two sections
// ---------------------------------------------------------------------------
describe('GeoGapsList with sourceMappings', () => {
  it('splits items into Unmapped and Unresolved sections', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" sourceMappings={sourceMappings} />)
    // Riverside Elementary and Oak Valley Middle are in sourceMappings = unmapped
    expect(screen.getByText(/2 Unmapped Schools/)).toBeInTheDocument()
    // Hillcrest High is NOT in sourceMappings = unresolved
    expect(screen.getByText(/1 Unresolved School$/)).toBeInTheDocument()
  })

  it('shows singular for single unmapped canonical', () => {
    const singleCanonical: GeoDataItem[] = [
      { name: 'Riverside Elementary', count: 14, percentage: 8.2 },
    ]
    render(<GeoGapsList gaps={singleCanonical} category="school" sourceMappings={sourceMappings} />)
    expect(screen.getByText(/1 Unmapped School$/)).toBeInTheDocument()
    expect(screen.queryByText(/Unresolved/)).not.toBeInTheDocument()
  })

  it('shows singular for single unresolved value', () => {
    const singleUnresolved: GeoDataItem[] = [{ name: 'Unknown Place', count: 1, percentage: 0.5 }]
    render(<GeoGapsList gaps={singleUnresolved} category="city" sourceMappings={sourceMappings} />)
    expect(screen.getByText(/1 Unresolved City$/)).toBeInTheDocument()
    expect(screen.queryByText(/Unmapped/)).not.toBeInTheDocument()
  })

  it('hides Unresolved section when all gaps are unmapped canonicals', () => {
    const allMapped: GeoDataItem[] = [
      { name: 'Riverside Elementary', count: 14, percentage: 8.2 },
      { name: 'Oak Valley Middle', count: 5, percentage: 2.9 },
    ]
    render(<GeoGapsList gaps={allMapped} category="school" sourceMappings={sourceMappings} />)
    expect(screen.getByText(/2 Unmapped Schools/)).toBeInTheDocument()
    expect(screen.queryByText(/Unresolved/)).not.toBeInTheDocument()
  })

  it('hides Unmapped section when all gaps are unresolved', () => {
    const allUnresolved: GeoDataItem[] = [
      { name: 'Unknown School A', count: 3, percentage: 1.5 },
      { name: 'Unknown School B', count: 1, percentage: 0.5 },
    ]
    render(<GeoGapsList gaps={allUnresolved} category="school" sourceMappings={sourceMappings} />)
    expect(screen.queryByText(/Unmapped/)).not.toBeInTheDocument()
    expect(screen.getByText(/2 Unresolved Schools/)).toBeInTheDocument()
  })

  it('sorts items by count descending within each section', () => {
    const gaps: GeoDataItem[] = [
      { name: 'Hillcrest High', count: 2, percentage: 1.2 },
      { name: 'Oak Valley Middle', count: 5, percentage: 2.9 },
      { name: 'Unknown Z', count: 7, percentage: 4.0 },
      { name: 'Riverside Elementary', count: 14, percentage: 8.2 },
      { name: 'Unknown A', count: 1, percentage: 0.5 },
    ]
    render(<GeoGapsList gaps={gaps} category="school" sourceMappings={sourceMappings} />)

    // Get all table bodies - one for unmapped, one for unresolved
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2)

    // Unmapped section (first table): Riverside (14), Oak Valley (5)
    const unmappedRows = within(tables[0]!).getAllByRole('row')
    const unmappedNames = unmappedRows.map(
      (row) => within(row).getAllByRole('cell')[0]!.textContent
    )
    expect(unmappedNames).toEqual(['Riverside Elementary', 'Oak Valley Middle'])

    // Unresolved section (second table): Unknown Z (7), Hillcrest (2), Unknown A (1)
    const unresolvedRows = within(tables[1]!).getAllByRole('row')
    const unresolvedNames = unresolvedRows.map(
      (row) => within(row).getAllByRole('cell')[0]!.textContent
    )
    expect(unresolvedNames).toEqual(['Unknown Z', 'Hillcrest High', 'Unknown A'])
  })

  it('renders count and percentage for each item', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" sourceMappings={sourceMappings} />)
    // Riverside Elementary: 14, 8.2%
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('8.2%')).toBeInTheDocument()
    // Oak Valley Middle: 5, 2.9%
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2.9%')).toBeInTheDocument()
    // Hillcrest High: 2, 1.2%
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1.2%')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Category plural/singular for all categories
// ---------------------------------------------------------------------------
describe('GeoGapsList category labels', () => {
  it('pluralizes city correctly', () => {
    const gaps: GeoDataItem[] = [
      { name: 'Faketown', count: 5, percentage: 3.0 },
      { name: 'Nowhere City', count: 3, percentage: 1.8 },
    ]
    render(<GeoGapsList gaps={gaps} category="city" />)
    expect(screen.getByText(/2 Unmapped Cities/)).toBeInTheDocument()
  })

  it('singularizes city correctly', () => {
    const gaps: GeoDataItem[] = [{ name: 'Faketown', count: 5, percentage: 3.0 }]
    render(<GeoGapsList gaps={gaps} category="city" />)
    expect(screen.getByText(/1 Unmapped City$/)).toBeInTheDocument()
  })

  it('pluralizes synagogue correctly', () => {
    const gaps: GeoDataItem[] = [
      { name: 'Temple A', count: 5, percentage: 3.0 },
      { name: 'Temple B', count: 3, percentage: 1.8 },
    ]
    render(<GeoGapsList gaps={gaps} category="synagogue" />)
    expect(screen.getByText(/2 Unmapped Synagogues/)).toBeInTheDocument()
  })

  it('singularizes synagogue correctly', () => {
    const gaps: GeoDataItem[] = [{ name: 'Temple A', count: 5, percentage: 3.0 }]
    render(<GeoGapsList gaps={gaps} category="synagogue" />)
    expect(screen.getByText(/1 Unmapped Synagogue$/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Visual styling verification
// ---------------------------------------------------------------------------
describe('GeoGapsList styling', () => {
  it('uses amber styling for unmapped section', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" sourceMappings={sourceMappings} />)
    const unmappedHeader = screen.getByText(/Unmapped/).closest('div')
    expect(unmappedHeader?.className).toContain('amber')
  })

  it('uses distinct styling for unresolved section (not amber)', () => {
    render(<GeoGapsList gaps={schoolGaps} category="school" sourceMappings={sourceMappings} />)
    // The unresolved header should NOT use amber — it should be a warmer/red-brown tone
    const unresolvedHeader = screen.getByText(/Unresolved/).closest('div')
    expect(unresolvedHeader?.className).not.toContain('amber')
  })
})
