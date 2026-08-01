import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { GeoManagementPage } from '../GeoManagementPage'
import { useGeoPagePrefetch } from '../../../../hooks/useGeoData'

// Mock hooks
const mockApproveMutate = vi.fn()
const mockRejectMutate = vi.fn()
vi.mock('../../../../hooks/useGeoData', () => ({
  useGeoGaps: vi.fn(() => ({
    data: {
      canonical_no_coords: [{ name: 'Nowhere City', count: 2, percentage: 5, source_count: 1 }],
      non_canonical_grouped: [
        { name: 'Test', count: 5, percentage: 10, source_count: 1, state_distribution: {} },
      ],
      non_canonical_ungrouped: [
        { name: 'Other', count: 3, percentage: 6, source_count: 1, state_distribution: {} },
      ],
      total_gaps: 4,
    },
    isLoading: false,
  })),
  useAllCanonicals: vi.fn(() => ({
    data: {
      results: [
        {
          canonical_name: 'Riverside Elementary',
          city: 'Riverside',
          state: 'CA',
          country: 'US',
          source: 'confirmed',
          camper_count: 10,
        },
        {
          canonical_name: 'Oak Valley Middle',
          city: 'Oak Valley',
          state: 'CA',
          country: 'US',
          source: 'suggested',
          camper_count: 5,
        },
      ],
    },
    isLoading: false,
  })),
  useGeoOverrides: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateOverride: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCanonicalSearch: vi.fn(() => ({ data: null, isLoading: false })),
  useCanonicalSources: vi.fn(() => ({ data: null, isLoading: false })),
  useBatchResolveCoords: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useMergeCanonical: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useApproveSuggested: vi.fn(() => ({ mutate: mockApproveMutate, isPending: false })),
  useRejectSuggested: vi.fn(() => ({ mutate: mockRejectMutate, isPending: false })),
  useGeoPagePrefetch: vi.fn(),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({
  useYear: vi.fn(() => 2025),
}))

function renderPage(initialPath = '/manage/geo/cities') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <GeoManagementPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('GeoManagementPage', () => {
  it('renders horizontal tab bar with three category tabs', () => {
    renderPage()
    const tabBar = screen.getByTestId('category-tabs')
    expect(within(tabBar).getByText('Cities')).toBeInTheDocument()
    expect(within(tabBar).getByText('Schools')).toBeInTheDocument()
    expect(within(tabBar).getByText('Congregations')).toBeInTheDocument()
  })

  it('renders split-screen with left and right panels', () => {
    renderPage()
    expect(screen.getByTestId('left-panel')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()
  })

  it('renders stat summary cards showing gap counts', () => {
    renderPage()
    const unresolvedCard = screen.getByTestId('stat-unresolved')
    const missingCoordsCard = screen.getByTestId('stat-missing-coords')
    expect(unresolvedCard).toHaveTextContent('2')
    expect(missingCoordsCard).toHaveTextContent('1')
  })

  it('renders collapsible sections collapsed by default', () => {
    renderPage()
    expect(screen.getByTestId('section-non-canonicals')).toBeInTheDocument()
    expect(screen.getByTestId('section-add-coords')).toBeInTheDocument()
    // Gap items should NOT be visible when sections are collapsed
    expect(screen.queryAllByTestId('gap-name')).toHaveLength(0)
  })

  it('expands a collapsible section on click', async () => {
    renderPage()
    const user = userEvent.setup()
    const section = screen.getByTestId('section-non-canonicals')
    await user.click(within(section).getByRole('button', { name: /resolve non-canonicals/i }))
    // After expanding, gap items should be visible
    expect(screen.queryAllByTestId('gap-name').length).toBeGreaterThan(0)
  })

  it('renders active enrollees toggle', () => {
    renderPage()
    expect(screen.getByLabelText(/active enrollees/i)).toBeInTheDocument()
  })

  it('shows total gaps count', () => {
    renderPage()
    expect(screen.getByText(/4 gap/i)).toBeInTheDocument()
  })

  it('calls useGeoPagePrefetch with current category, year, and activeOnly', () => {
    renderPage()
    expect(useGeoPagePrefetch).toHaveBeenCalledWith('city', 2025, true)
  })

  it('switches category on tab click', async () => {
    renderPage()
    const user = userEvent.setup()
    const tabBar = screen.getByTestId('category-tabs')
    await user.click(within(tabBar).getByText('Schools'))
    // Verify the Schools tab is active
    expect(within(tabBar).getByText('Schools').closest('[data-active]')).toHaveAttribute(
      'data-active',
      'true'
    )
  })

  it('renders merge buttons on canonical entries', () => {
    renderPage()
    const mergeButtons = screen.getAllByRole('button', { name: /merge canonical/i })
    expect(mergeButtons.length).toBeGreaterThan(0)
  })

  it('does not render MergeDialog by default', () => {
    renderPage()
    // MergeDialog title includes "Merge:" -- it should not be visible when dialog is closed
    expect(screen.queryByText(/Merge:/)).not.toBeInTheDocument()
  })
})
