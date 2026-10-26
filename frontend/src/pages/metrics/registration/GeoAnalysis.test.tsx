/**
 * Registration › Geographic: the busy cue (D-UNCOVERED, #3207) covers the compare query too, so a
 * newly picked compare year's label never sits over the previous compare year's numbers unmarked.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GeoAnalysis from './GeoAnalysis'
import { useComparisonRegistrationData } from '../../../hooks/useComparisonRegistrationData'

const emptyGeo = { year: 2026, by_city: [], by_school: [], by_synagogue: [] }

vi.mock('../../../hooks/useComparisonRegistrationData', () => ({
  useComparisonRegistrationData: vi.fn(() => ({
    primary: {
      data: emptyGeo,
      isLoading: false,
      error: null,
      isPlaceholderData: false,
      refetch: vi.fn(),
    },
    // The compare query keeps 2025's result on screen while 2024 loads
    comparison: { data: { ...emptyGeo, year: 2025 }, isPlaceholderData: true },
  })),
}))

vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: vi.fn(() => ({ currentYear: 2026 })),
}))

vi.mock('../../../hooks/useGeoOverrideCoords', () => ({
  useGeoOverrideCoords: vi.fn(() => ({ data: undefined })),
}))

vi.mock('../../../hooks/useDrilldown', () => ({
  useDrilldown: vi.fn(() => ({ setFilter: vi.fn(), DrilldownModal: () => null })),
}))

vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(() => ({
    selectedSessionCmId: null,
    activeSessionTypes: ['main', 'embedded', 'ag'],
    compareYear: 2024,
    isComparing: true,
    durationParam: undefined,
    filterOptions: {},
  })),
}))

const comparisonListProps = vi.hoisted(() => [] as Array<{ category: string; pending?: boolean }>)

vi.mock('../../../components/metrics/geo', () => ({
  GeoMap: () => null,
  GeoSummaryCards: () => null,
  GeoDetailList: () => null,
  GeoLayerToggles: () => null,
  GeoComparisonDetailList: (props: { category: string; pending?: boolean }) => {
    comparisonListProps.push(props)
    return null
  },
}))

describe('GeoAnalysis — busy cue (D-UNCOVERED)', () => {
  it('dims the page under "Loading 2024…" while a newly picked compare year loads', () => {
    render(<GeoAnalysis />)
    expect(screen.getByText('Loading 2024…')).toBeInTheDocument()
    expect(screen.getByText('No Geographic Data').closest('[inert]')).not.toBeNull()
  })
})

describe('GeoAnalysis — same point last year (PM-8 A)', () => {
  it('asks for the compare year at the same point of this season', () => {
    render(<GeoAnalysis />)
    const calls = vi.mocked(useComparisonRegistrationData).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call[3]?.samePoint).toBe(true)
  })

  it("says which, in Overview's grammar", () => {
    const geo = { ...emptyGeo, by_city: [{ city: 'Riverside, CA', count: 12, percentage: 10 }] }
    vi.mocked(useComparisonRegistrationData).mockReturnValue({
      primary: {
        data: geo,
        isLoading: false,
        error: null,
        isPlaceholderData: false,
        refetch: vi.fn(),
      },
      comparison: {
        data: {
          ...geo,
          year: 2024,
          prior_basis: 'same_point',
          day_offset: 110,
          prior_day_offset: 110,
          as_of_date: '2024-03-02',
        },
        isPlaceholderData: false,
      },
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)
    render(<GeoAnalysis />)
    expect(screen.getByText('vs same point')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Compared with 2024 as it stood on Mar 2, 2024, the same registration day as today.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/registered by Mar 2, 2024 and not cancelled by then/)
    ).toBeInTheDocument()
  })
})

// Owner call 2026-10-26 (item 7): on the priority date itself Geo's changes wait a day, exactly as
// Overview's and Cancellations' do (ruling 9, compareBasis.pending).
describe('GeoAnalysis — priority date (ruling 9)', () => {
  const geo = { ...emptyGeo, by_city: [{ city: 'Riverside, CA', count: 12, percentage: 10 }] }
  const withDayOffset = (dayOffset: number) =>
    vi.mocked(useComparisonRegistrationData).mockReturnValue({
      primary: {
        data: geo,
        isLoading: false,
        error: null,
        isPlaceholderData: false,
        refetch: vi.fn(),
      },
      comparison: {
        data: {
          ...geo,
          year: 2024,
          prior_basis: 'same_point',
          day_offset: dayOffset,
          prior_day_offset: dayOffset,
          as_of_date: '2024-03-02',
        },
        isPlaceholderData: false,
      },
    } as unknown as ReturnType<typeof useComparisonRegistrationData>)

  it('marks the comparison tables pending on the priority date', () => {
    comparisonListProps.length = 0
    withDayOffset(0)
    render(<GeoAnalysis />)
    const city = comparisonListProps.filter((p) => p.category === 'city')
    expect(city.length).toBeGreaterThan(0)
    expect(city.every((p) => p.pending === true)).toBe(true)
  })

  it('leaves them live on any other day', () => {
    comparisonListProps.length = 0
    withDayOffset(110)
    render(<GeoAnalysis />)
    const city = comparisonListProps.filter((p) => p.category === 'city')
    expect(city.length).toBeGreaterThan(0)
    expect(city.every((p) => p.pending !== true)).toBe(true)
  })
})
