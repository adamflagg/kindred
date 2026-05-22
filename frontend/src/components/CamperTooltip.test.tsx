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
  beforeEach(() => vi.clearAllMocks())

  it('shows a no-bunk teen year and a bunked year, both routed through the fetcher', async () => {
    mockFetchCamperJourney.mockResolvedValue([
      { year: 2025, sessionName: 'Counselor In-Training', sessionType: 'scit' }, // no bunk
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
    ])
    renderTooltip()
    expect(await screen.findByText(/2025:/)).toBeInTheDocument() // teen year now visible
    expect(await screen.findByText(/2023:/)).toBeInTheDocument()
    expect(screen.getByText(/G-8B/)).toBeInTheDocument()
    expect(mockFetchCamperJourney).toHaveBeenCalledWith(12887873, 2026)
  })
})
