/**
 * Registration › Geographic: the busy cue (D-UNCOVERED, #3207) covers the compare query too, so a
 * newly picked compare year's label never sits over the previous compare year's numbers unmarked.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GeoAnalysis from './GeoAnalysis'

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

vi.mock('../../../components/metrics/geo', () => ({
  GeoMap: () => null,
  GeoSummaryCards: () => null,
  GeoDetailList: () => null,
  GeoLayerToggles: () => null,
  GeoComparisonDetailList: () => null,
}))

describe('GeoAnalysis — busy cue (D-UNCOVERED)', () => {
  it('dims the page under "Loading 2024…" while a newly picked compare year loads', () => {
    render(<GeoAnalysis />)
    expect(screen.getByText('Loading 2024…')).toBeInTheDocument()
    expect(screen.getByText('No Geographic Data').closest('[inert]')).not.toBeNull()
  })
})
