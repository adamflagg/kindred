import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergeDialog } from '../MergeDialog'
import { useAllCanonicals, useMergeCanonical } from '../../../../hooks/useGeoData'

vi.mock('../../../../hooks/useGeoData', () => ({
  useAllCanonicals: vi.fn(),
  useMergeCanonical: vi.fn(),
}))

const mockUseAllCanonicals = vi.mocked(useAllCanonicals)
const mockMutateAsync = vi.fn().mockResolvedValue({ merged_count: 3 })
const mockUseMergeCanonical = vi.mocked(useMergeCanonical)

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  sourceCanonical: 'Riverside Elementary',
  category: 'school' as const,
  year: 2025,
}

beforeEach(() => {
  mockUseAllCanonicals.mockReturnValue({
    data: {
      results: [
        {
          canonical_name: 'Riverside Elementary',
          city: 'Oakland',
          state: 'CA',
          country: '',
          source: 'nces',
          has_coords: true,
          camper_count: 12,
        },
        {
          canonical_name: 'Oak Valley Middle',
          city: 'Portland',
          state: 'OR',
          country: '',
          source: 'simplemaps',
          has_coords: true,
          camper_count: 8,
        },
        {
          canonical_name: 'Hillcrest High',
          city: 'Denver',
          state: 'CO',
          country: '',
          source: 'manual',
          has_coords: false,
          camper_count: 5,
        },
        {
          canonical_name: 'Westminster Academy',
          city: 'London',
          state: '',
          country: 'GB',
          source: 'manual',
          has_coords: true,
          camper_count: 3,
        },
      ],
    },
    isLoading: false,
  } as ReturnType<typeof useAllCanonicals>)

  mockUseMergeCanonical.mockReturnValue({
    mutateAsync: mockMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useMergeCanonical>)
})

describe('MergeDialog', () => {
  it('renders dialog with source canonical name in title', () => {
    render(<MergeDialog {...defaultProps} />)
    expect(screen.getByText('Merge: Riverside Elementary')).toBeInTheDocument()
  })

  it('shows description text about reassigning variants', () => {
    render(<MergeDialog {...defaultProps} />)
    expect(
      screen.getByText('All source variants will be reassigned to the target canonical.')
    ).toBeInTheDocument()
  })

  it('filters out source canonical from search results', () => {
    render(<MergeDialog {...defaultProps} />)

    // Source canonical should NOT be in the results list
    // The title has it, but the results list should not
    const resultButtons = screen.getAllByRole('button').filter((btn) => {
      return (
        btn.textContent?.includes('Oak Valley Middle') ||
        btn.textContent?.includes('Hillcrest High')
      )
    })
    expect(resultButtons.length).toBeGreaterThan(0)

    // Riverside Elementary should not be in the selectable results
    // (it appears in the title, but not as a selectable option)
    const allButtons = screen.getAllByRole('button')
    const sourceInResults = allButtons.filter(
      (btn) =>
        btn.textContent?.includes('Riverside Elementary') &&
        !btn.getAttribute('aria-label')?.includes('Close')
    )
    // The only mention of Riverside Elementary should be in the title, not as a selectable row
    expect(sourceInResults).toHaveLength(0)
  })

  it('shows search input with placeholder', () => {
    render(<MergeDialog {...defaultProps} />)
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('enables merge button when target selected', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Merge button should be disabled initially
    const mergeButton = screen.getByRole('button', { name: /^merge$/i })
    expect(mergeButton).toBeDisabled()

    // Select a target
    await user.click(screen.getByText('Oak Valley Middle'))

    // Now merge button should be enabled
    expect(mergeButton).not.toBeDisabled()
  })

  it('calls onClose when cancel clicked', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('typeahead filters canonicals client-side', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oak')

    // Only Oak Valley Middle should remain visible
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.queryByText('Hillcrest High')).not.toBeInTheDocument()
    expect(screen.queryByText('Westminster Academy')).not.toBeInTheDocument()
  })

  it('shows city/state badge, source badge, and camper count for each result', () => {
    render(<MergeDialog {...defaultProps} />)

    // City/state badges
    expect(screen.getByText('Portland, OR')).toBeInTheDocument()
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()

    // Source badges
    expect(screen.getByText('SimpleMaps')).toBeInTheDocument()

    // Camper counts
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('highlights selected entry', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Click on Oak Valley Middle
    const oakButton = screen.getByText('Oak Valley Middle').closest('button')!
    await user.click(oakButton)

    // The button should have highlighting class
    expect(oakButton).toHaveClass('ring-2')
  })

  it('calls useMergeCanonical mutation on save and closes dialog', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    // Select a target
    await user.click(screen.getByText('Oak Valley Middle'))

    // Click merge
    await user.click(screen.getByRole('button', { name: /^merge$/i }))

    expect(mockMutateAsync).toHaveBeenCalledWith({
      canonicalName: 'Riverside Elementary',
      target: 'Oak Valley Middle',
    })

    await vi.waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  it('dialog not rendered when open=false', () => {
    render(<MergeDialog {...defaultProps} open={false} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('onClose called when backdrop clicked', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    const backdrop = screen.getByTestId('modal-backdrop')
    await user.click(backdrop)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})

describe('MergeDialog — Search All toggle', () => {
  it('renders "Search all" checkbox unchecked by default', () => {
    render(<MergeDialog {...defaultProps} />)
    const checkbox = screen.getByRole('checkbox', { name: /search all/i })
    expect(checkbox).not.toBeChecked()
  })

  it('when search-all is on, calls useAllCanonicals with inUse=false', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    expect(mockUseAllCanonicals).toHaveBeenCalledWith('school', 2025, false)
  })

  it('when search-all is on, requires 3+ chars before showing results', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oa')

    expect(screen.queryByText('Oak Valley Middle')).not.toBeInTheDocument()
    expect(screen.getByText(/type 3\+ characters/i)).toBeInTheDocument()
  })

  it('when search-all is on, shows results after 3+ chars', async () => {
    render(<MergeDialog {...defaultProps} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: /search all/i }))

    const input = screen.getByPlaceholderText(/search/i)
    await user.type(input, 'Oak')

    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
  })

  it('when search-all is off, shows all results without min-char restriction', () => {
    render(<MergeDialog {...defaultProps} />)

    // Default state (search-all off): results shown immediately (minus source canonical)
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('Hillcrest High')).toBeInTheDocument()
  })
})
