import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { GeoManagementPage } from '../GeoManagementPage'

// Mock hooks
vi.mock('../../../../hooks/useGeoData', () => ({
  useGeoGaps: vi.fn(() => ({
    data: {
      canonical_no_coords: [],
      non_canonical_grouped: [{ name: 'Test', count: 5, percentage: 10, source_count: 1 }],
      non_canonical_ungrouped: [],
      total_gaps: 1,
    },
    isLoading: false,
  })),
  useAllCanonicals: vi.fn(() => ({
    data: { results: [] },
    isLoading: false,
  })),
  useGeoOverrides: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateOverride: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCanonicalSearch: vi.fn(() => ({ data: null, isLoading: false })),
  useCanonicalSources: vi.fn(() => ({ data: null, isLoading: false })),
  useBatchResolveCoords: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({
  useYear: vi.fn(() => 2025),
}))

function renderPage(initialPath = '/admin/geo/cities') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <GeoManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GeoManagementPage', () => {
  it('renders sidebar with three category items', () => {
    renderPage()
    expect(screen.getByText('Cities')).toBeInTheDocument()
    expect(screen.getByText('Schools')).toBeInTheDocument()
    expect(screen.getByText('Congregations')).toBeInTheDocument()
  })

  it('renders split-screen with left and right panels', () => {
    renderPage()
    expect(screen.getByTestId('left-panel')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()
  })

  it('renders active enrollees toggle', () => {
    renderPage()
    expect(screen.getByLabelText(/active enrollees/i)).toBeInTheDocument()
  })

  it('shows total gaps count', () => {
    renderPage()
    expect(screen.getByText(/1 gap/i)).toBeInTheDocument()
  })

  it('switches category on sidebar click', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByText('Schools'))
    // Verify the Schools sidebar item is active
    expect(screen.getByText('Schools').closest('[data-active]')).toHaveAttribute(
      'data-active',
      'true',
    )
  })
})
