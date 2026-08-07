import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalReferenceList } from '../CanonicalReferenceList'
import { useAllCanonicals, useCanonicalSources } from '../../../../hooks/useGeoData'
import type { CanonicalEntry } from '../../../../services/geoService'

vi.mock('../../../../hooks/useGeoData', () => ({
  useAllCanonicals: vi.fn(),
  useCanonicalSources: vi.fn(),
}))

const mockUseAllCanonicals = vi.mocked(useAllCanonicals)
const mockUseCanonicalSources = vi.mocked(useCanonicalSources)

const entries: CanonicalEntry[] = [
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
    camper_count: 0,
  },
  {
    canonical_name: 'Birchwood Academy',
    city: 'Seattle',
    state: 'WA',
    country: '',
    source: 'pss',
    has_coords: true,
    camper_count: 5,
  },
]

function defaultMocks() {
  mockUseAllCanonicals.mockReturnValue({
    data: { results: entries },
    isLoading: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  mockUseCanonicalSources.mockReturnValue({
    data: null,
    isLoading: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('CanonicalReferenceList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    defaultMocks()
  })

  // ---------- Rendering ----------

  it('renders list of canonical entries showing name, city/state, source badge, camper count', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Names visible
    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.getByText('Hillcrest High')).toBeInTheDocument()
    expect(screen.getByText('Birchwood Academy')).toBeInTheDocument()

    // City/state visible
    expect(screen.getByText('Oakland, CA')).toBeInTheDocument()
    expect(screen.getByText('Portland, OR')).toBeInTheDocument()

    // Source badges
    expect(screen.getByText('NCES')).toBeInTheDocument()
    expect(screen.getByText('SimpleMaps')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('PSS')).toBeInTheDocument()

    // Camper counts
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  // ---------- Sort ----------

  it('sorts by Popular (count desc) by default', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const rows = screen.getAllByTestId('canonical-row')
    // Popular sort: 12 > 8 > 5 > 0
    expect(within(rows[0]!).getByTestId('canonical-name')).toHaveTextContent('Riverside Elementary')
    expect(within(rows[1]!).getByTestId('canonical-name')).toHaveTextContent('Oak Valley Middle')
    expect(within(rows[2]!).getByTestId('canonical-name')).toHaveTextContent('Birchwood Academy')
    expect(within(rows[3]!).getByTestId('canonical-name')).toHaveTextContent('Hillcrest High')
  })

  it('toggles to A-Z sort (alphabetical by name)', async () => {
    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /a-z/i }))

    const rows = screen.getAllByTestId('canonical-row')
    // Alpha sort: B, H, O, R
    expect(within(rows[0]!).getByTestId('canonical-name')).toHaveTextContent('Birchwood Academy')
    expect(within(rows[1]!).getByTestId('canonical-name')).toHaveTextContent('Hillcrest High')
    expect(within(rows[2]!).getByTestId('canonical-name')).toHaveTextContent('Oak Valley Middle')
    expect(within(rows[3]!).getByTestId('canonical-name')).toHaveTextContent('Riverside Elementary')
  })

  // ---------- Search ----------

  it('filters entries by name search', async () => {
    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/search/i), 'riverside')

    expect(screen.getByText('Riverside Elementary')).toBeInTheDocument()
    expect(screen.queryByText('Oak Valley Middle')).not.toBeInTheDocument()
    expect(screen.queryByText('Hillcrest High')).not.toBeInTheDocument()
  })

  it('filters entries by city search', async () => {
    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/search/i), 'portland')

    expect(screen.getByText('Oak Valley Middle')).toBeInTheDocument()
    expect(screen.queryByText('Riverside Elementary')).not.toBeInTheDocument()
  })

  it('filters entries by state search', async () => {
    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/search/i), 'WA')

    expect(screen.getByText('Birchwood Academy')).toBeInTheDocument()
    expect(screen.queryByText('Riverside Elementary')).not.toBeInTheDocument()
  })

  // ---------- Expanded row with sources ----------

  it('expands a row to show source variants with confidence %', async () => {
    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          { original_value: 'Riverside Elem', count: 7, confidence: 0.92, state_distribution: {} },
          {
            original_value: 'Riverside Elementary School',
            count: 5,
            confidence: 1.0,
            state_distribution: {},
          },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Click first row to expand
    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    // Source variants shown
    expect(screen.getByText('Riverside Elem')).toBeInTheDocument()
    expect(screen.getByText('Riverside Elementary School')).toBeInTheDocument()

    // Confidence %
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  // Row expansion used to be a click handler on a non-interactive `<div>`
  // (kindred#2063-style gap: no keyboard listener at all). It is now a real
  // <button>, so Tab + Enter reaches and activates it for free.
  it('expands a row via keyboard (Tab + Enter reaches the row toggle button)', async () => {
    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          { original_value: 'Riverside Elem', count: 7, confidence: 0.92, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const rows = screen.getAllByTestId('canonical-row')
    const toggleButton = within(rows[0]!).getByTestId('canonical-name').closest('button')
    expect(toggleButton).not.toBeNull()

    toggleButton!.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByText('Source Variants')).toBeInTheDocument()
  })

  // ---------- [Fix] button ----------

  it('shows Fix button only on fuzzy matches (confidence < 1.0)', async () => {
    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          { original_value: 'Riverside Elem', count: 7, confidence: 0.92, state_distribution: {} },
          {
            original_value: 'Riverside Elementary School',
            count: 5,
            confidence: 1.0,
            state_distribution: {},
          },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Expand the first row
    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    // Only one Fix button (for the 0.92 confidence match)
    const fixButtons = screen.getAllByRole('button', { name: /fix/i })
    expect(fixButtons).toHaveLength(1)
  })

  it('calls onReassignSource with original_value when Fix is clicked', async () => {
    const onReassignSource = vi.fn()

    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          { original_value: 'Riverside Elem', count: 7, confidence: 0.92, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(
      <CanonicalReferenceList category="school" year={2025} onReassignSource={onReassignSource} />
    )

    // Expand the first row
    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    // Click Fix button
    await user.click(screen.getByRole('button', { name: /fix/i }))

    expect(onReassignSource).toHaveBeenCalledWith('Riverside Elem')
  })

  // ---------- 0-camper entries ----------

  it('shows 0-camper entries with opacity-50 class', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const rows = screen.getAllByTestId('canonical-row')
    // Hillcrest High has camper_count=0, should be last in popular sort
    const zeroCamperRow = rows[3]!
    expect(within(zeroCamperRow).getByTestId('canonical-name')).toHaveTextContent('Hillcrest High')
    expect(zeroCamperRow).toHaveClass('opacity-50')
  })

  // ---------- Loading state ----------

  it('shows loading state when data is loading', () => {
    mockUseAllCanonicals.mockReturnValue({
      data: undefined,
      isLoading: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  // ---------- Empty state ----------

  it('shows empty state when no results after search', async () => {
    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/search/i), 'zzzznonexistent')

    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })

  it('shows empty state when data has no entries', () => {
    mockUseAllCanonicals.mockReturnValue({
      data: { results: [] },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    expect(screen.getByText(/no.*entries/i)).toBeInTheDocument()
  })

  // ---------- Header ----------

  it('renders header with Canonical Entries title', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    expect(screen.getByText('Canonical Entries')).toBeInTheDocument()
  })

  // ---------- Source badge colors ----------

  it('applies correct badge colors for different source types', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const ncesBadge = screen.getByText('NCES')
    expect(ncesBadge).toHaveClass('bg-forest-100')

    const pssBadge = screen.getByText('PSS')
    expect(pssBadge).toHaveClass('bg-forest-100')

    const simpleBadge = screen.getByText('SimpleMaps')
    expect(simpleBadge).toHaveClass('bg-blue-100')

    const manualBadge = screen.getByText('Manual')
    expect(manualBadge).toHaveClass('bg-stone-100')
  })

  // ---------- Task 9: State/Country display ----------

  it('shows state distribution tags on source variants', async () => {
    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          {
            original_value: 'Riverside Elem',
            count: 7,
            confidence: 0.92,
            state_distribution: { CA: 5, OR: 2 },
          },
          {
            original_value: 'Riverside Elementary School',
            count: 5,
            confidence: 1.0,
            state_distribution: { CA: 5 },
          },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    // Source variants should appear
    expect(screen.getByText('Source Variants')).toBeInTheDocument()

    // State distribution tags should be visible
    // Uses non-breaking space (\u00a0) in source, but testing-library normalizes to regular space
    expect(screen.getByText(/CA \(5\).*OR \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/^CA \(5\)$/)).toBeInTheDocument()
  })

  it('shows country in location badge for non-US entries', () => {
    mockUseAllCanonicals.mockReturnValue({
      data: {
        results: [
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Should show "London, GB" not "London, "
    expect(screen.getByText('London, GB')).toBeInTheDocument()
  })

  it('shows italic location badge for suggested canonicals', () => {
    mockUseAllCanonicals.mockReturnValue({
      data: {
        results: [
          {
            canonical_name: 'Suggested School',
            city: 'Portland',
            state: 'OR',
            country: 'US',
            source: 'suggested',
            has_coords: false,
            camper_count: 2,
          },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const locationBadge = screen.getByText('Portland, OR')
    expect(locationBadge).toHaveClass('italic')
  })

  // ---------- Task 10: Approve/Reject UI ----------

  it('shows approve and reject buttons on suggested canonicals', async () => {
    const suggestedEntry: CanonicalEntry = {
      canonical_name: 'Suggested School',
      city: 'Portland',
      state: 'OR',
      country: 'US',
      source: 'suggested',
      has_coords: false,
      camper_count: 2,
    }

    mockUseAllCanonicals.mockReturnValue({
      data: { results: [suggestedEntry] },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Suggested School',
        city: 'Portland',
        state: 'OR',
        country: 'US',
        sources: [
          { original_value: 'Suggested Schl', count: 2, confidence: 0.85, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Expand the suggested row
    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
  })

  it('does not show approve/reject on non-suggested canonicals', async () => {
    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Riverside Elementary',
        city: 'Oakland',
        state: 'CA',
        country: '',
        sources: [
          {
            original_value: 'Riverside Elementary School',
            count: 5,
            confidence: 1.0,
            state_distribution: {},
          },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    // Expand an nces entry (first in popular sort)
    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('calls onApprove when approve button clicked', async () => {
    const onApprove = vi.fn()
    const suggestedEntry: CanonicalEntry = {
      canonical_name: 'Suggested School',
      city: 'Portland',
      state: 'OR',
      country: 'US',
      source: 'suggested',
      has_coords: false,
      camper_count: 2,
    }

    mockUseAllCanonicals.mockReturnValue({
      data: { results: [suggestedEntry] },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Suggested School',
        city: 'Portland',
        state: 'OR',
        country: 'US',
        sources: [
          { original_value: 'Suggested Schl', count: 2, confidence: 0.85, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(
      <CanonicalReferenceList
        category="school"
        year={2025}
        onReassignSource={vi.fn()}
        onApprove={onApprove}
      />
    )

    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))
    await user.click(screen.getByRole('button', { name: /approve/i }))

    expect(onApprove).toHaveBeenCalledWith(suggestedEntry)
  })

  it('calls onReject when reject button clicked', async () => {
    const onReject = vi.fn()
    const suggestedEntry: CanonicalEntry = {
      canonical_name: 'Suggested School',
      city: 'Portland',
      state: 'OR',
      country: 'US',
      source: 'suggested',
      has_coords: false,
      camper_count: 2,
    }

    mockUseAllCanonicals.mockReturnValue({
      data: { results: [suggestedEntry] },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Suggested School',
        city: 'Portland',
        state: 'OR',
        country: 'US',
        sources: [
          { original_value: 'Suggested Schl', count: 2, confidence: 0.85, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(
      <CanonicalReferenceList
        category="school"
        year={2025}
        onReassignSource={vi.fn()}
        onReject={onReject}
      />
    )

    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))
    await user.click(screen.getByRole('button', { name: /reject/i }))

    expect(onReject).toHaveBeenCalledWith(suggestedEntry)
  })

  // ---------- Task 11: Merge button ----------

  it('shows merge button on canonical rows', () => {
    render(
      <CanonicalReferenceList
        category="school"
        year={2025}
        onReassignSource={vi.fn()}
        onMerge={vi.fn()}
      />
    )

    const mergeButtons = screen.getAllByRole('button', { name: /merge/i })
    // Should have one merge button per canonical row
    expect(mergeButtons).toHaveLength(entries.length)
  })

  it('calls onMerge callback when merge button clicked', async () => {
    const onMerge = vi.fn()
    const user = userEvent.setup()

    render(
      <CanonicalReferenceList
        category="school"
        year={2025}
        onReassignSource={vi.fn()}
        onMerge={onMerge}
      />
    )

    // Click the merge button on the first row (Riverside Elementary in popular sort)
    const mergeButtons = screen.getAllByRole('button', { name: /merge/i })
    await user.click(mergeButtons[0]!)

    expect(onMerge).toHaveBeenCalledWith(entries[0])
  })

  it('does not show merge button when onMerge is not provided', () => {
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument()
  })

  it('shows inferred location text for suggested canonicals', async () => {
    const suggestedEntry: CanonicalEntry = {
      canonical_name: 'Suggested School',
      city: 'Portland',
      state: 'OR',
      country: 'US',
      source: 'suggested',
      has_coords: false,
      camper_count: 2,
    }

    mockUseAllCanonicals.mockReturnValue({
      data: { results: [suggestedEntry] },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    mockUseCanonicalSources.mockReturnValue({
      data: {
        canonical_name: 'Suggested School',
        city: 'Portland',
        state: 'OR',
        country: 'US',
        sources: [
          { original_value: 'Suggested Schl', count: 2, confidence: 0.85, state_distribution: {} },
        ],
      },
      isLoading: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const user = userEvent.setup()
    render(<CanonicalReferenceList category="school" year={2025} onReassignSource={vi.fn()} />)

    const rows = screen.getAllByTestId('canonical-row')
    // The toggle affordance is a real <button> wrapping the row's name/badges
    // (kindred#2063 pattern) rather than a click handler on the row `<div>`
    // itself, so the click targets the name inside it.
    await user.click(within(rows[0]!).getByTestId('canonical-name'))

    expect(screen.getByText('Inferred: Portland, OR')).toBeInTheDocument()
  })
})
