import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResolveDialog } from '../ResolveDialog'
import { useAllCanonicals, useCreateOverride } from '../../../../hooks/useGeoData'

vi.mock('../../../../hooks/useGeoData', () => ({
  useAllCanonicals: vi.fn(),
  useCreateOverride: vi.fn(),
}))

const mockUseAllCanonicals = vi.mocked(useAllCanonicals)
const mockMutateAsync = vi.fn().mockResolvedValue({})
const mockUseCreateOverride = vi.mocked(useCreateOverride)

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  gapName: 'Hillcrest High',
  gapType: 'non_canonical_grouped',
  category: 'school' as const,
  year: 2025,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAllCanonicals.mockReturnValue({
    data: {
      results: [
        {
          canonical_name: 'Oak Valley Middle',
          city: 'Oakland',
          state: 'CA',
          country: '',
          source: 'nces',
          has_coords: true,
          camper_count: 10,
        },
        {
          canonical_name: 'Riverside Elementary',
          city: 'San Francisco',
          state: 'CA',
          country: '',
          source: 'nces',
          has_coords: true,
          camper_count: 5,
        },
        {
          canonical_name: 'Hillcrest Academy',
          city: 'Los Angeles',
          state: 'CA',
          country: '',
          source: 'pss',
          has_coords: true,
          camper_count: 3,
        },
      ],
    },
    isLoading: false,
  } as ReturnType<typeof useAllCanonicals>)
  mockUseCreateOverride.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateOverride>)
})

// ============================================================================
// Mode A — non-canonical / reassign source (gapType !== 'canonical_no_coords')
// ============================================================================
describe('ResolveDialog — Mode A (non-canonical)', () => {
  it('renders with title "Resolve: {gapName}"', () => {
    render(<ResolveDialog {...defaultProps} />)
    expect(screen.getByText('Resolve: Hillcrest High')).toBeInTheDocument()
  })

  it('typeahead input filters prefetched canonicals client-side', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Initially all canonicals should be visible (or shown by default)
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()

    // Type to filter
    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oak')

    // Only Oak Valley Middle should match
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.queryByText('Riverside Elementary')).not.toBeInTheDocument()
  })

  it('selecting a canonical and clicking Save calls useCreateOverride with alias override', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Click on the Oak Valley Middle entry
    await user.click(screen.getByText('Oak Valley Middle'))

    // Click Save button
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'school',
        override_type: 'alias',
        raw_value: 'Hillcrest High',
        canonical_name: 'Oak Valley Middle',
        year: 2025,
      })
    )
  })

  it('"Create new" button switches to inline form with name/city/state fields', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create new/i }))

    // Should show name, city, state fields
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/city/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/state/i)).toBeInTheDocument()
  })

  it('focuses the Name field when switching TO the create form (2530 review finding 2)', async () => {
    // A branch switch is a mid-dialog mount: `isOpen` never changes, so
    // Modal's beforeEnter focus never re-fires. This used to work through the
    // input's `autoFocus`, which D20 deleted for its open-time harm — the
    // caller now owns mid-dialog focus, and this pins it.
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create new/i }))

    await waitFor(() => expect(screen.getByLabelText(/name/i)).toHaveFocus())
  })

  it('focuses the search box when switching BACK from the create form', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create new/i }))
    await user.click(screen.getByRole('button', { name: /back/i }))

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/search existing entries/i)).toHaveFocus()
    )
  })

  it('name field pre-fills with gapName in create-new mode', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create new/i }))

    const nameInput: HTMLInputElement = screen.getByLabelText(/name/i)
    expect(nameInput.value).toBe('Hillcrest High')
  })

  it('creating new canonical triggers useCreateOverride with canonical override', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create new/i }))

    const nameInput = screen.getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Hillcrest High School')

    const cityInput = screen.getByLabelText(/city/i)
    await user.type(cityInput, 'Denver')

    const stateInput = screen.getByLabelText(/state/i)
    await user.type(stateInput, 'CO')

    await user.click(screen.getByRole('button', { name: /save|create/i }))

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'school',
        override_type: 'canonical',
        raw_value: 'Hillcrest High',
        canonical_name: 'Hillcrest High School',
        city: 'Denver',
        state: 'CO',
        year: 2025,
      })
    )
  })

  it('dialog closes after successful save', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Select a canonical and save
    await user.click(screen.getByText('Oak Valley Middle'))
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Wait for the async mutation
    await vi.waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  it('Back button returns from create-new to search mode', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Enter create-new mode
    await user.click(screen.getByRole('button', { name: /create new/i }))
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()

    // Click Back
    await user.click(screen.getByRole('button', { name: /back/i }))

    // Should be back in search mode
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/city/i)).not.toBeInTheDocument()
  })

  it('clears selected entry when filter changes and selection is no longer visible', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Select Oak Valley Middle
    await user.click(screen.getByText('Oak Valley Middle'))

    // Verify selection by checking ring-2 class
    const oakButton = screen.getByText('Oak Valley Middle').closest('button')!
    expect(oakButton).toHaveClass('ring-2')

    // Type a query that excludes Oak Valley Middle
    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Riverside')

    // Oak Valley Middle should be gone
    expect(screen.queryByText('Oak Valley Middle')).not.toBeInTheDocument()

    // Clear the search to show all again
    await user.clear(input)

    // Oak Valley Middle should reappear but NOT be selected
    const oakButtonAfter = screen.getByText('Oak Valley Middle').closest('button')!
    expect(oakButtonAfter).not.toHaveClass('ring-2')
  })

  it('shows source badge and city/state for each canonical result', async () => {
    render(<ResolveDialog {...defaultProps} />)

    // Verify city/state text
    expect(screen.getByText('Oakland, CA')).toBeInTheDocument()
    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()

    // Verify source badges exist (NCES label)
    const badges = screen.getAllByText('NCES')
    expect(badges.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// Mode B — canonical_no_coords
// ============================================================================
describe('ResolveDialog — Mode B (canonical_no_coords)', () => {
  const coordsProps = {
    ...defaultProps,
    gapName: 'Riverside Elementary',
    gapType: 'canonical_no_coords',
  }

  it('renders with title "Add Coordinates: {gapName}"', () => {
    render(<ResolveDialog {...coordsProps} />)
    expect(screen.getByText('Add Coordinates: Riverside Elementary')).toBeInTheDocument()
  })

  it('shows lat/lng input fields', () => {
    render(<ResolveDialog {...coordsProps} />)
    expect(screen.getByLabelText(/latitude/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/longitude/i)).toBeInTheDocument()
  })

  it('Save button calls useCreateOverride with canonical override type including lat/lng', async () => {
    render(<ResolveDialog {...coordsProps} />)
    const user = userEvent.setup()

    const latInput = screen.getByLabelText(/latitude/i)
    const lngInput = screen.getByLabelText(/longitude/i)

    await user.type(latInput, '37.7749')
    await user.type(lngInput, '-122.4194')

    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'school',
        override_type: 'canonical',
        canonical_name: 'Riverside Elementary',
        lat: 37.7749,
        lng: -122.4194,
        year: 2025,
      })
    )
  })

  it('Save disabled when lat/lng are empty', () => {
    render(<ResolveDialog {...coordsProps} />)
    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()
  })

  it('dialog closes after successful save', async () => {
    render(<ResolveDialog {...coordsProps} />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/latitude/i), '37.7749')
    await user.type(screen.getByLabelText(/longitude/i), '-122.4194')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await vi.waitFor(() => {
      expect(coordsProps.onClose).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Both modes — shared behavior
// ============================================================================
describe('ResolveDialog — shared behavior', () => {
  it('dialog not rendered when open=false', () => {
    render(<ResolveDialog {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('onClose called when backdrop clicked', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    const backdrop = screen.getByTestId('modal-backdrop')
    await user.click(backdrop)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('onClose called when close button clicked', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByLabelText(/close/i))

    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})

// ============================================================================
// Search All toggle
// ============================================================================
describe('ResolveDialog — Search All toggle', () => {
  it('renders "Search all" checkbox unchecked by default', () => {
    render(<ResolveDialog {...defaultProps} />)
    const checkbox = screen.getByRole('checkbox', { name: /search all/i })
    expect(checkbox).not.toBeChecked()
  })

  it('when search-all is on, calls useAllCanonicals with inUse=false', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    expect(mockUseAllCanonicals).toHaveBeenCalledWith('school', 2025, false)
  })

  it('when search-all is on, requires 3+ chars before showing results', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    // With < 3 chars, results should be hidden and hint shown
    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oa')

    expect(screen.queryByText('Oak Valley Middle')).not.toBeInTheDocument()
    expect(screen.getByText(/type 3\+ characters/i)).toBeInTheDocument()
  })

  it('when search-all is on, shows results after 3+ chars', async () => {
    render(<ResolveDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oak')

    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
  })

  it('when search-all is off, shows all results without min-char restriction', () => {
    render(<ResolveDialog {...defaultProps} />)

    // Default state (search-all off): all results shown immediately
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
  })
})
