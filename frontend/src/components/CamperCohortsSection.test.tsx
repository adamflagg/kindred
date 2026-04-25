/**
 * Tests for CamperCohortsSection component.
 *
 * Verifies "Also from [X]: N campers" cohort rows display correctly
 * based on normalized school/congregation/city fields.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../test/testUtils'
import { CamperCohortsSection } from './CamperCohortsSection'
import type { CamperCohorts } from '../hooks/useCamperCohorts'

// Mock the hook — test the component in isolation
const mockUseCamperCohorts = vi.fn()
vi.mock('../hooks/useCamperCohorts', () => ({
  useCamperCohorts: (...args: unknown[]) => mockUseCamperCohorts(...args),
}))

describe('CamperCohortsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    personCmId: 1000001,
    sessionCmId: 201,
    year: 2025,
  }

  describe('when cohort data has matches', () => {
    it('renders a cohort row for normalized_school with count > 0', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Riverside Elementary', count: 4 },
        congregation: null,
        city: null,
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Riverside Elementary: 4 campers/)).toBeInTheDocument()
      })
    })

    it('renders a cohort row for normalized_congregation with count > 0', async () => {
      const cohorts: CamperCohorts = {
        school: null,
        congregation: { label: 'Oak Valley Synagogue', count: 2 },
        city: null,
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Oak Valley Synagogue: 2 campers/)).toBeInTheDocument()
      })
    })

    it('renders a cohort row for normalized_city with count > 0', async () => {
      const cohorts: CamperCohorts = {
        school: null,
        congregation: null,
        city: { label: 'Springfield', count: 7 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Springfield: 7 campers/)).toBeInTheDocument()
      })
    })

    it('renders all three cohort rows when all three fields have matches', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Hillcrest High', count: 3 },
        congregation: { label: 'Temple Shalom', count: 1 },
        city: { label: 'Riverside', count: 12 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Hillcrest High: 3 campers/)).toBeInTheDocument()
        expect(screen.getByText(/Also from Temple Shalom: 1 campers/)).toBeInTheDocument()
        expect(screen.getByText(/Also from Riverside: 12 campers/)).toBeInTheDocument()
      })
    })

    it('renders only rows with count > 0, hides rows with count = 0', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Oak Valley Middle', count: 0 },
        congregation: null,
        city: { label: 'Lakewood', count: 5 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        // city row should show
        expect(screen.getByText(/Also from Lakewood: 5 campers/)).toBeInTheDocument()
        // school with count=0 should NOT show
        expect(screen.queryByText(/Oak Valley Middle/)).not.toBeInTheDocument()
      })
    })
  })

  describe('when no cohort data matches', () => {
    it('renders nothing when all normalized fields are null (all empty)', async () => {
      const cohorts: CamperCohorts = {
        school: null,
        congregation: null,
        city: null,
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      const { container } = render(<CamperCohortsSection {...defaultProps} />)

      // Section should not render any content
      expect(container.firstChild).toBeNull()
    })

    it('renders nothing when all counts are 0', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Riverside Elementary', count: 0 },
        congregation: { label: 'Beth Shalom', count: 0 },
        city: { label: 'Springfield', count: 0 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      const { container } = render(<CamperCohortsSection {...defaultProps} />)

      expect(container.firstChild).toBeNull()
    })

    it('renders nothing while loading', async () => {
      mockUseCamperCohorts.mockReturnValue({ cohorts: null, isLoading: true })

      const { container } = render(<CamperCohortsSection {...defaultProps} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('exclusion guards', () => {
    it('passes correct personCmId and sessionCmId to the hook (current camper excluded)', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Hillcrest High', count: 3 },
        congregation: null,
        city: null,
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection personCmId={1000042} sessionCmId={301} year={2025} />)

      // Verify hook was called with the correct arguments (hook is responsible for exclusion)
      expect(mockUseCamperCohorts).toHaveBeenCalledWith(1000042, 301, 2025)
    })
  })

  describe('key collision guard', () => {
    it('renders both rows distinctly when school and city share the same normalized label', async () => {
      // "Springfield" appears as both school and city label — key={row.label} would collide
      const cohorts: CamperCohorts = {
        school: { label: 'Springfield', count: 3 },
        congregation: null,
        city: { label: 'Springfield', count: 7 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        // Both rows must render — getByText would throw if there were a collision
        // causing only one to render
        const rows = screen.getAllByTestId('cohort-row')
        expect(rows).toHaveLength(2)

        // Each row has its distinct count visible
        expect(screen.getByText(/Also from Springfield: 3 campers/)).toBeInTheDocument()
        expect(screen.getByText(/Also from Springfield: 7 campers/)).toBeInTheDocument()
      })
    })

    it('each row element carries a composite data-cohort-kind attribute for distinct identity', async () => {
      const cohorts: CamperCohorts = {
        school: { label: 'Springfield', count: 3 },
        congregation: null,
        city: { label: 'Springfield', count: 7 },
      }
      mockUseCamperCohorts.mockReturnValue({ cohorts, isLoading: false })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        const rows = screen.getAllByTestId('cohort-row')
        const kinds = rows.map((r) => r.getAttribute('data-cohort-kind'))
        expect(kinds).toContain('school')
        expect(kinds).toContain('city')
      })
    })
  })
})
