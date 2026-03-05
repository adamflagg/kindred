/**
 * Tests for CanonicalBrowser and CanonicalCard components.
 *
 * TDD: Tests written first to define expected behavior for searchable
 * canonical list with expandable cards, source badges, and actions.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalBrowser } from './CanonicalBrowser'
import { CanonicalCard } from './CanonicalCard'
import type { CanonicalEntry, SourcesResponse } from '../../../services/geoService'
import { useCanonicalSearch, useCanonicalSources } from '../../../hooks/useGeoData'

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------
vi.mock('../../../hooks/useGeoData', () => ({
  useCanonicalSearch: vi.fn(),
  useCanonicalSources: vi.fn(),
  useCreateOverride: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Test data (fictional names per project conventions)
// ---------------------------------------------------------------------------
const schoolEntries: CanonicalEntry[] = [
  {
    canonical_name: 'Riverside Elementary',
    city: 'Maplewood',
    state: 'CA',
    source: 'nces',
    has_coords: true,
    camper_count: 12,
  },
  {
    canonical_name: 'Oak Valley Middle',
    city: 'Cedarville',
    state: 'OR',
    source: 'pss',
    has_coords: true,
    camper_count: 8,
  },
  {
    canonical_name: 'Hillcrest High',
    city: 'Pinegrove',
    state: 'WA',
    source: 'manual',
    has_coords: false,
    camper_count: 0,
  },
]

const cityEntries: CanonicalEntry[] = [
  {
    canonical_name: 'Maplewood',
    city: 'Maplewood',
    state: 'CA',
    source: 'simplemaps',
    has_coords: true,
    camper_count: 25,
  },
]

const riversideSources: SourcesResponse = {
  canonical_name: 'Riverside Elementary',
  city: 'Maplewood',
  state: 'CA',
  sources: [
    { original_value: 'Riverside Elementary School', count: 8, confidence: 0.95 },
    { original_value: 'Riverside Elem', count: 3, confidence: 0.88 },
    { original_value: 'Riverside Elem.', count: 1, confidence: 0.85 },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupSearchMock(entries: CanonicalEntry[]) {
  vi.mocked(useCanonicalSearch).mockReturnValue({
    data: { results: entries },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCanonicalSearch>)
}

function setupEmptySearchMock() {
  vi.mocked(useCanonicalSearch).mockReturnValue({
    data: { results: [] as CanonicalEntry[] },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCanonicalSearch>)
}

function setupSourcesMock(sources: SourcesResponse) {
  vi.mocked(useCanonicalSources).mockReturnValue({
    data: sources,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCanonicalSources>)
}

// ---------------------------------------------------------------------------
// CanonicalBrowser — Search input
// ---------------------------------------------------------------------------
describe('CanonicalBrowser search', () => {
  beforeEach(() => {
    setupSearchMock(schoolEntries)
    setupSourcesMock(riversideSources)
  })

  it('renders a search input', () => {
    render(<CanonicalBrowser category="school" year={2025} />)

    const input = screen.getByRole('searchbox')
    expect(input).toBeInTheDocument()
  })

  it('renders canonical cards for search results', () => {
    render(<CanonicalBrowser category="school" year={2025} />)

    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('Hillcrest High')).toBeInTheDocument()
  })

  it('shows empty state when search returns no results', () => {
    setupEmptySearchMock()

    render(<CanonicalBrowser category="school" year={2025} />)

    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// CanonicalCard — Header content
// ---------------------------------------------------------------------------
describe('CanonicalCard header', () => {
  it('shows canonical name', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
  })

  it('shows city/state badge', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByText('Maplewood, CA')).toBeInTheDocument()
  })

  it('shows source badge with correct text for NCES', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByTestId('source-badge')).toHaveTextContent(/nces/i)
  })

  it('shows source badge with correct text for PSS', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[1]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByTestId('source-badge')).toHaveTextContent(/pss/i)
  })

  it('shows source badge with correct text for SimpleMaps', () => {
    render(
      <CanonicalCard
        entry={cityEntries[0]!}
        category="city"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByTestId('source-badge')).toHaveTextContent(/simplemaps/i)
  })

  it('shows source badge with correct text for Manual', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[2]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByTestId('source-badge')).toHaveTextContent(/manual/i)
  })

  it('shows "in use" indicator when camper_count > 0', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByTestId('in-use-indicator')).toBeInTheDocument()
  })

  it('does not show "in use" indicator when camper_count is 0', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[2]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.queryByTestId('in-use-indicator')).not.toBeInTheDocument()
  })

  it('calls onToggleExpand when header is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={onToggle}
      />
    )

    await user.click(screen.getByText('Riverside Elementary'))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// CanonicalCard — Expanded body
// ---------------------------------------------------------------------------
describe('CanonicalCard expanded body', () => {
  beforeEach(() => {
    setupSourcesMock(riversideSources)
  })

  it('shows source list when expanded', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByText('Riverside Elementary School')).toBeInTheDocument()
    expect(screen.getByText('Riverside Elem')).toBeInTheDocument()
    expect(screen.getByText('Riverside Elem.')).toBeInTheDocument()
  })

  it('shows count and confidence for each source item', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
      />
    )

    // Count 8 with 95% confidence
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/95%/)).toBeInTheDocument()
    // Count 3 with 88% confidence
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/88%/)).toBeInTheDocument()
  })

  it('does not show source list when collapsed', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.queryByText('Riverside Elementary School')).not.toBeInTheDocument()
    expect(screen.queryByText('Riverside Elem')).not.toBeInTheDocument()
  })

  it('shows Reassign button for each source item', () => {
    const onReassign = vi.fn()

    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        onReassignSource={onReassign}
      />
    )

    const reassignButtons = screen.getAllByRole('button', { name: /reassign/i })
    expect(reassignButtons).toHaveLength(3)
  })

  it('calls onReassignSource with original value when Reassign is clicked', async () => {
    const user = userEvent.setup()
    const onReassign = vi.fn()

    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        onReassignSource={onReassign}
      />
    )

    const reassignButtons = screen.getAllByRole('button', { name: /reassign/i })
    await user.click(reassignButtons[0]!)

    expect(onReassign).toHaveBeenCalledWith('Riverside Elementary School')
  })

  it('shows Merge button when expanded', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        onMerge={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /merge/i })).toBeInTheDocument()
  })

  it('calls onMerge with canonical name when Merge is clicked', async () => {
    const user = userEvent.setup()
    const onMerge = vi.fn()

    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        onMerge={onMerge}
      />
    )

    await user.click(screen.getByRole('button', { name: /merge/i }))
    expect(onMerge).toHaveBeenCalledWith('Riverside Elementary')
  })

  it('shows Edit button only for manual source entries', () => {
    setupSourcesMock({
      canonical_name: 'Hillcrest High',
      city: 'Pinegrove',
      state: 'WA',
      sources: [],
    })

    render(
      <CanonicalCard
        entry={schoolEntries[2]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })

  it('does not show Edit button for non-manual source entries', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={true}
        onToggleExpand={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// CanonicalCard — Source badge colors
// ---------------------------------------------------------------------------
describe('CanonicalCard source badge colors', () => {
  it('uses forest/green classes for NCES source', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[0]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    const badge = screen.getByTestId('source-badge')
    expect(badge.className).toMatch(/forest|green/)
  })

  it('uses forest/green classes for PSS source', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[1]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    const badge = screen.getByTestId('source-badge')
    expect(badge.className).toMatch(/forest|green/)
  })

  it('uses amber classes for SimpleMaps source', () => {
    render(
      <CanonicalCard
        entry={cityEntries[0]!}
        category="city"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    const badge = screen.getByTestId('source-badge')
    expect(badge.className).toMatch(/amber/)
  })

  it('uses brown/stone classes for Manual source', () => {
    render(
      <CanonicalCard
        entry={schoolEntries[2]!}
        category="school"
        year={2025}
        isExpanded={false}
        onToggleExpand={vi.fn()}
      />
    )

    const badge = screen.getByTestId('source-badge')
    expect(badge.className).toMatch(/stone|brown/)
  })
})

// ---------------------------------------------------------------------------
// CanonicalBrowser — Card expansion
// ---------------------------------------------------------------------------
describe('CanonicalBrowser card expansion', () => {
  beforeEach(() => {
    setupSearchMock(schoolEntries)
    setupSourcesMock(riversideSources)
  })

  it('expands a card when clicked and shows source details', async () => {
    const user = userEvent.setup()

    render(<CanonicalBrowser category="school" year={2025} />)

    // Click on a card to expand it
    await user.click(screen.getByText('Riverside Elementary'))

    // Source details should now be visible
    expect(screen.getByText('Riverside Elementary School')).toBeInTheDocument()
  })

  it('collapses an expanded card when clicked again', async () => {
    const user = userEvent.setup()

    render(<CanonicalBrowser category="school" year={2025} />)

    // Expand
    await user.click(screen.getByText('Riverside Elementary'))
    expect(screen.getByText('Riverside Elementary School')).toBeInTheDocument()

    // Collapse
    await user.click(screen.getByText('Riverside Elementary'))
    expect(screen.queryByText('Riverside Elementary School')).not.toBeInTheDocument()
  })
})
