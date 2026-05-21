/**
 * Tests for RegistrationDatesConfig component
 * TDD: These tests define the expected behavior for the registration dates config UI
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegistrationDatesConfig } from './RegistrationDatesConfig'
import { CurrentYearContext, type CurrentYearContextType } from '../../hooks/useCurrentYear'

// Mock PocketBase
const mockGetFullList = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getFullList: mockGetFullList,
      create: mockCreate,
      update: mockUpdate,
    }),
    autoCancellation: vi.fn(),
  },
}))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const createWrapper = (year = 2026) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: year,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024],
    isTransitioning: false,
    isYearReady: true,
  }

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CurrentYearContext value={mockYearContext}>{children}</CurrentYearContext>
    </QueryClientProvider>
  )
}

// Helper to build config records matching PocketBase shape
const makeConfigRecord = (year: number, key: string, value: string, id = `rec_${year}_${key}`) => ({
  id,
  category: 'registration',
  subcategory: String(year),
  config_key: key,
  value: value,
  metadata: {
    business_category: 'registration',
    component_type: 'date',
    friendly_name: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    source: 'default_config',
  },
  description: `Registration date for ${key}`,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

describe('RegistrationDatesConfig', () => {
  beforeEach(() => {
    mockGetFullList.mockReset()
    mockCreate.mockReset()
    mockUpdate.mockReset()
  })

  it('renders date inputs for three registration phases', async () => {
    mockGetFullList.mockResolvedValue([])

    render(<RegistrationDatesConfig />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByLabelText(/priority/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/early/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/open/i)).toBeInTheDocument()
    })
  })

  it('loads existing dates from config API for selected year', async () => {
    mockGetFullList.mockResolvedValue([
      makeConfigRecord(2026, 'priority_reg_date', '2025-11-10'),
      makeConfigRecord(2026, 'early_reg_date', '2025-11-13'),
      makeConfigRecord(2026, 'open_reg_date', '2025-11-20'),
    ])

    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2026) })

    await waitFor(() => {
      expect(screen.getByLabelText(/priority/i)).toHaveValue('2025-11-10')
      expect(screen.getByLabelText(/early/i)).toHaveValue('2025-11-13')
      expect(screen.getByLabelText(/open/i)).toHaveValue('2025-11-20')
    })
  })

  it('saves new dates via config API (creates records)', async () => {
    mockGetFullList.mockResolvedValue([])
    mockCreate.mockResolvedValue({ id: 'new_rec' })

    const user = userEvent.setup()
    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2026) })

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByLabelText(/priority/i)).toBeInTheDocument()
    })

    // Fill in dates
    await user.clear(screen.getByLabelText(/priority/i))
    await user.type(screen.getByLabelText(/priority/i), '2025-11-10')

    // Click save
    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled()
    })
  })

  it('updates existing dates via config API', async () => {
    mockGetFullList.mockResolvedValue([
      makeConfigRecord(2026, 'priority_reg_date', '2025-11-10', 'existing_1'),
      makeConfigRecord(2026, 'early_reg_date', '2025-11-13', 'existing_2'),
      makeConfigRecord(2026, 'open_reg_date', '2025-11-20', 'existing_3'),
    ])
    mockUpdate.mockResolvedValue({ id: 'existing_1' })

    const user = userEvent.setup()
    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2026) })

    await waitFor(() => {
      expect(screen.getByLabelText(/priority/i)).toHaveValue('2025-11-10')
    })

    // Change a date
    await user.clear(screen.getByLabelText(/priority/i))
    await user.type(screen.getByLabelText(/priority/i), '2025-11-09')

    // Click save
    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'existing_1',
        expect.objectContaining({
          value: '2025-11-09',
        })
      )
    })
  })

  it('handles empty state (no dates set for year)', async () => {
    mockGetFullList.mockResolvedValue([])

    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2024) })

    await waitFor(() => {
      // All date inputs should be empty
      expect(screen.getByLabelText(/priority/i)).toHaveValue('')
      expect(screen.getByLabelText(/early/i)).toHaveValue('')
      expect(screen.getByLabelText(/open/i)).toHaveValue('')
    })
  })

  it('shows loading state while fetching', () => {
    // Never resolve the promise to keep loading state
    mockGetFullList.mockReturnValue(new Promise(() => {}))

    render(<RegistrationDatesConfig />, { wrapper: createWrapper() })

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows the current year in the heading', async () => {
    mockGetFullList.mockResolvedValue([])

    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2026) })

    await waitFor(() => {
      expect(screen.getByText(/2026/)).toBeInTheDocument()
    })
  })

  it('invalidates server-side metrics cache after saving dates', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    mockGetFullList.mockResolvedValue([
      makeConfigRecord(2026, 'priority_reg_date', '2025-11-10', 'existing_1'),
      makeConfigRecord(2026, 'early_reg_date', '2025-11-13', 'existing_2'),
      makeConfigRecord(2026, 'open_reg_date', '2025-11-20', 'existing_3'),
    ])
    mockUpdate.mockResolvedValue({ id: 'existing_1' })

    const user = userEvent.setup()
    render(<RegistrationDatesConfig />, { wrapper: createWrapper(2026) })

    await waitFor(() => {
      expect(screen.getByLabelText(/priority/i)).toHaveValue('2025-11-10')
    })

    // Change a date and save
    await user.clear(screen.getByLabelText(/priority/i))
    await user.type(screen.getByLabelText(/priority/i), '2025-11-09')

    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/metrics/cache/invalidate',
        expect.objectContaining({ method: 'POST' })
      )
    })

    mockFetch.mockRestore()
  })
})
