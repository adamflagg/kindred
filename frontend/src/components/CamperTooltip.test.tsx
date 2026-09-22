/**
 * Tests for CamperTooltip — the hover mini-journey. Reads the one shared
 * journey feed (useCamperJourney, adult camper journey spec §5.4), so it shows
 * real attended years incl. no-bunk (teen / gap) rows. TDD: written before
 * implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CamperTooltip from './CamperTooltip'
import type { Camper } from '../types/app-types'
import type { HistoricalRecord } from '../hooks/camper/types'

// The feed's own household/auth/housing plumbing is tested in
// useCamperJourney.test.tsx; here it is a plain source of rows.
const mockUseCamperJourney = vi.fn()
vi.mock('../hooks/camper/useCamperJourney', () => ({
  useCamperJourney: (...args: unknown[]) => mockUseCamperJourney(...args),
}))
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getFullList: vi.fn().mockResolvedValue([]) }) },
}))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

function journeyWith(rows: HistoricalRecord[]) {
  return {
    rows,
    counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
    isLoading: false,
    error: null,
  }
}

const camper = {
  person_cm_id: 12887873,
  name: 'Emma Johnson',
  grade: 11,
  gender: 'F',
} as unknown as Camper

function renderTooltip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CamperTooltip camper={camper} isVisible={true} position={{ x: 100, y: 100 }} />
    </QueryClientProvider>
  )
}

describe('CamperTooltip mini-journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCamperJourney.mockReturnValue(journeyWith([]))
  })

  it('shows a no-bunk teen year and a bunked year from the shared feed', async () => {
    mockUseCamperJourney.mockReturnValue(
      journeyWith([
        { year: 2025, sessionName: 'Counselor In-Training', sessionType: 'scit' }, // no bunk
        { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      ])
    )
    renderTooltip()
    expect(await screen.findByText(/2025:/)).toBeInTheDocument() // teen year now visible
    expect(await screen.findByText(/2023:/)).toBeInTheDocument()
    expect(screen.getByText(/G-8B/)).toBeInTheDocument()
    expect(mockUseCamperJourney).toHaveBeenCalledWith(12887873, 2026)
  })

  it('limits the mini-journey to the 3 most recent prior years', async () => {
    mockUseCamperJourney.mockReturnValue(
      journeyWith([
        { year: 2025, sessionName: 'Session 1', sessionType: 'main' },
        { year: 2024, sessionName: 'Session 2', sessionType: 'main' },
        { year: 2023, sessionName: 'Session 3', sessionType: 'main' },
        { year: 2022, sessionName: 'Session 4', sessionType: 'main' },
      ])
    )
    renderTooltip()
    expect(await screen.findByText(/2023:/)).toBeInTheDocument()
    expect(screen.queryByText(/2022:/)).toBeNull()
  })

  // kindred#2466: a family-camp row shows the household's resolved cabin in
  // the housing slot. The feed resolves it; the tooltip only renders it.
  it("renders a family-camp row's resolved cabin from the feed", async () => {
    mockUseCamperJourney.mockReturnValue(
      journeyWith([
        {
          year: 2024,
          sessionName: 'Family Camp 2',
          sessionType: 'family',
          bunkName: 'Cedar Lodge',
        },
      ])
    )
    renderTooltip()
    expect(await screen.findByText(/Cedar Lodge/)).toBeInTheDocument()
  })
})
