/**
 * Tests for CamperTooltip — the hover mini-journey. Routes through the shared
 * fetchCamperJourney so it shows real attended years incl. no-bunk (teen / gap)
 * rows. TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CamperTooltip from './CamperTooltip'
import type { Camper } from '../types/app-types'

const mockFetchCamperJourney = vi.fn()
vi.mock('../hooks/camper/fetchCamperJourney', () => ({
  fetchCamperJourney: (...args: unknown[]) => mockFetchCamperJourney(...args),
}))
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getFullList: vi.fn().mockResolvedValue([]) }) },
}))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

// kindred#2466: the tooltip threads the household journey's `years` into
// fetchCamperJourney so a family-camp row shows the household's resolved
// cabin instead of the CampMinder day group. Mocked here rather than
// exercised through real fetchWithAuth/fetch.
const mockUseHouseholdJourney = vi.fn()
vi.mock('../hooks/useWeekendRoster', () => ({
  useHouseholdJourney: (...args: unknown[]) => mockUseHouseholdJourney(...args),
}))

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
    mockUseHouseholdJourney.mockReturnValue({ data: undefined })
  })

  it('shows a no-bunk teen year and a bunked year, both routed through the fetcher', async () => {
    mockFetchCamperJourney.mockResolvedValue([
      { year: 2025, sessionName: 'Counselor In-Training', sessionType: 'scit' }, // no bunk
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
    ])
    renderTooltip()
    expect(await screen.findByText(/2025:/)).toBeInTheDocument() // teen year now visible
    expect(await screen.findByText(/2023:/)).toBeInTheDocument()
    expect(screen.getByText(/G-8B/)).toBeInTheDocument()
    // kindred#2466: a 3rd argument now carries the household journey's
    // years (empty here — this camper fixture has no household_id).
    expect(mockFetchCamperJourney).toHaveBeenCalledWith(12887873, 2026, [])
  })
})

// kindred#2466: the tooltip's mini-journey shows the household's resolved
// family-camp cabin in the housing slot, never the CampMinder day group.
describe('CamperTooltip mini-journey — family-camp housing (kindred#2466)', () => {
  const camperWithHousehold = {
    person_cm_id: 12887873,
    household_id: 1000001,
    name: 'Emma Johnson',
    grade: 11,
    gender: 'F',
  } as unknown as Camper

  function renderTooltipWithHousehold() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <CamperTooltip
          camper={camperWithHousehold}
          isVisible={true}
          position={{ x: 100, y: 100 }}
        />
      </QueryClientProvider>
    )
  }

  beforeEach(() => vi.clearAllMocks())

  it("passes the household's CampMinder id and threads its journey years into the fetcher", async () => {
    const years = [
      { year: 2024, housing: 'placed', cabin_name: 'Cedar Lodge', housing_session_cm_id: 900 },
    ]
    mockUseHouseholdJourney.mockReturnValue({ data: { household_cm_id: 1000001, years } })
    mockFetchCamperJourney.mockResolvedValue([
      { year: 2024, sessionName: 'Family Camp 2', sessionType: 'family', bunkName: 'Cedar Lodge' },
    ])

    renderTooltipWithHousehold()

    expect(await screen.findByText(/Cedar Lodge/)).toBeInTheDocument()
    expect(mockUseHouseholdJourney).toHaveBeenCalledWith(1000001)
    expect(mockFetchCamperJourney).toHaveBeenCalledWith(12887873, 2026, years)
  })
})
