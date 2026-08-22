/**
 * Tests for CamperCohortsSection component.
 *
 * Verifies "Also from [X]: N campers" cohort rows display correctly
 * based on normalized school/congregation/city fields.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '../test/testUtils'
import { CamperCohortsSection } from './CamperCohortsSection'
import {
  cohortEntry as entry,
  cohortsFixture as cohorts,
  matchedAttendee,
} from '../test/cohortFixtures'

// Mock the hooks — test the component in isolation
const mockUseCamperCohorts = vi.fn()
vi.mock('../hooks/useCamperCohorts', () => ({
  useCamperCohorts: (...args: unknown[]) => mockUseCamperCohorts(...args),
}))
type Rel = { type: 'bunk_with' | 'not_bunk_with'; mutual: boolean }
const mockUseCohortRequestRelations = vi.fn<
  (...args: unknown[]) => { relations: Map<number, Rel>; isLoading: boolean }
>(() => ({ relations: new Map(), isLoading: false }))
vi.mock('../hooks/useCohortRequestRelations', () => ({
  useCohortRequestRelations: (...args: unknown[]) => mockUseCohortRequestRelations(...args),
}))

describe('CamperCohortsSection accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCohortRequestRelations.mockReturnValue({ relations: new Map(), isLoading: false })
  })

  it('section has an accessible name', async () => {
    mockUseCamperCohorts.mockReturnValue({
      cohorts: cohorts({ school: entry('Riverside Elementary', 4) }),
      isLoading: false,
    })

    render(
      <CamperCohortsSection
        personCmId={1000001}
        sessionCmId={201}
        year={2025}
        selfDisplayName="Emma"
      />
    )

    await waitFor(() => {
      const section = screen.getByTestId('camper-cohorts-section')
      // WCAG 2.1 SC 4.1.2 — section must have aria-label or aria-labelledby
      expect(
        section.getAttribute('aria-label') || section.getAttribute('aria-labelledby')
      ).toBeTruthy()
    })
  })
})

describe('CamperCohortsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCohortRequestRelations.mockReturnValue({ relations: new Map(), isLoading: false })
  })

  const defaultProps = {
    personCmId: 1000001,
    sessionCmId: 201,
    year: 2025,
    selfDisplayName: 'Emma',
  }

  describe('when cohort data has matches', () => {
    it('renders a cohort row for normalized_school with count > 0', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({ school: entry('Riverside Elementary', 4) }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Riverside Elementary: 4 campers/)).toBeInTheDocument()
      })
    })

    it('renders a cohort row for normalized_congregation with count > 0', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({ congregation: entry('Oak Valley Synagogue', 2) }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Oak Valley Synagogue: 2 campers/)).toBeInTheDocument()
      })
    })

    it('renders a cohort row for normalized_city with count > 0', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({ city: entry('Springfield', 7) }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Springfield: 7 campers/)).toBeInTheDocument()
      })
    })

    it('renders all three cohort rows when all three fields have matches', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: entry('Hillcrest High', 3),
          congregation: entry('Temple Shalom', 1),
          city: entry('Riverside', 12),
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/Also from Hillcrest High: 3 campers/)).toBeInTheDocument()
        // Singular form — count of 1 reads "1 camper" not "1 campers"
        expect(screen.getByText(/Also from Temple Shalom: 1 camper$/)).toBeInTheDocument()
        expect(screen.getByText(/Also from Riverside: 12 campers/)).toBeInTheDocument()
      })
    })

    it('uses singular "camper" when count is 1', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({ school: entry('Riverside Elementary', 1) }),
        isLoading: false,
      })
      render(<CamperCohortsSection {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText(/Also from Riverside Elementary: 1 camper$/)).toBeInTheDocument()
      })
    })

    it('renders only rows with count > 0, hides rows with count = 0', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: entry('Oak Valley Middle', 0),
          city: entry('Lakewood', 5),
        }),
        isLoading: false,
      })

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
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({}),
        isLoading: false,
      })

      const { container } = render(<CamperCohortsSection {...defaultProps} />)

      // Section should not render any content
      expect(container.firstChild).toBeNull()
    })

    it('renders nothing when all counts are 0', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: entry('Riverside Elementary', 0),
          congregation: entry('Beth Shalom', 0),
          city: entry('Springfield', 0),
        }),
        isLoading: false,
      })

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
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({ school: entry('Hillcrest High', 3) }),
        isLoading: false,
      })

      render(
        <CamperCohortsSection
          personCmId={1000042}
          sessionCmId={301}
          year={2025}
          selfDisplayName="Emma"
        />
      )

      // Verify hook was called with the correct arguments (hook is responsible for exclusion)
      expect(mockUseCamperCohorts).toHaveBeenCalledWith(1000042, 301, 2025)
    })
  })

  describe('key collision guard', () => {
    it('renders both rows distinctly when school and city share the same normalized label', async () => {
      // "Springfield" appears as both school and city label — key={row.label} would collide
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: entry('Springfield', 3),
          city: entry('Springfield', 7),
        }),
        isLoading: false,
      })

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
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: entry('Springfield', 3),
          city: entry('Springfield', 7),
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      await waitFor(() => {
        const rows = screen.getAllByTestId('cohort-row')
        const kinds = rows.map((r) => r.getAttribute('data-cohort-kind'))
        expect(kinds).toContain('school')
        expect(kinds).toContain('city')
      })
    })
  })

  describe('drilldown click behavior', () => {
    it('clicking a cohort row opens the drilldown modal scoped to that label', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: {
            label: 'Riverside Elementary',
            count: 2,
            attendees: [matchedAttendee(1000002, 'Liam'), matchedAttendee(1000003, 'Olivia')],
          },
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      const row = await screen.findByRole('button', {
        name: /Also from Riverside Elementary: 2 campers/,
      })
      fireEvent.click(row)

      // Modal opens
      expect(await screen.findByText(/Same school: Riverside Elementary/)).toBeInTheDocument()
      // Both campers listed
      expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
      expect(screen.getByText(/Olivia Garcia/)).toBeInTheDocument()
    })

    it('only one modal opens at a time even if a different row is clicked', async () => {
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: {
            label: 'Riverside Elementary',
            count: 1,
            attendees: [matchedAttendee(1000002, 'Liam')],
          },
          city: {
            label: 'Springfield',
            count: 1,
            attendees: [matchedAttendee(1000003, 'Olivia')],
          },
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      fireEvent.click(await screen.findByRole('button', { name: /Also from Riverside Elementary/ }))
      expect(await screen.findByText(/Same school: Riverside Elementary/)).toBeInTheDocument()

      // Close, then open the other
      fireEvent.click(screen.getByRole('button', { name: /close/i }))
      await waitFor(() => {
        expect(screen.queryByText(/Same school: Riverside Elementary/)).not.toBeInTheDocument()
      })

      fireEvent.click(await screen.findByRole('button', { name: /Also from Springfield/ }))
      expect(await screen.findByText(/Same city: Springfield/)).toBeInTheDocument()
    })

    it('keeps the drilldown painted through the exit fade after close (kindred#2529)', async () => {
      // The exit-fade pin. `onClose` used to null `openKind`, which unmounted
      // the modal in the same frame — the Transition #2530 gave Modal never got
      // to play its 150ms leave. The parent now keeps the cohort snapshot and
      // drives a separate open flag, so the DOM must outlive the close, then go.
      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: {
            label: 'Riverside Elementary',
            count: 1,
            attendees: [matchedAttendee(1000002, 'Liam')],
          },
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)

      fireEvent.click(await screen.findByRole('button', { name: /Also from Riverside Elementary/ }))
      expect(await screen.findByText(/Same school: Riverside Elementary/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /close/i }))
      // Still painted on the frame the close fires...
      expect(screen.getByText(/Same school: Riverside Elementary/)).toBeInTheDocument()
      // ...and gone once the leave completes (jsdom runs it on its own frame
      // scheduling — never the declared 150ms; do not assert time).
      await waitFor(() => {
        expect(screen.queryByText(/Same school: Riverside Elementary/)).not.toBeInTheDocument()
      })
    })

    it('passes requestRelations from useCohortRequestRelations into the modal', async () => {
      const relations = new Map<number, Rel>([[1000002, { type: 'bunk_with', mutual: false }]])
      mockUseCohortRequestRelations.mockReturnValue({ relations, isLoading: false })

      mockUseCamperCohorts.mockReturnValue({
        cohorts: cohorts({
          school: {
            label: 'Riverside Elementary',
            count: 1,
            attendees: [matchedAttendee(1000002, 'Liam')],
          },
        }),
        isLoading: false,
      })

      render(<CamperCohortsSection {...defaultProps} />)
      fireEvent.click(await screen.findByRole('button', { name: /Also from Riverside Elementary/ }))

      // Badge text uses selfDisplayName from defaultProps ("Emma")
      expect(await screen.findByText(/Requested to bunk with Emma/)).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// #1044: Multi-session camper annotation
// ---------------------------------------------------------------------------
describe('CamperCohortsSection multi-session annotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCohortRequestRelations.mockReturnValue({ relations: new Map(), isLoading: false })
    mockUseCamperCohorts.mockReturnValue({
      cohorts: cohorts({ school: entry('Riverside Elementary', 3) }),
      isLoading: false,
    })
  })

  it('shows no annotation when hasMultipleEnrollments is false', async () => {
    render(
      <CamperCohortsSection
        personCmId={1000001}
        sessionCmId={201}
        year={2025}
        selfDisplayName="Emma"
        hasMultipleEnrollments={false}
      />
    )

    await screen.findByText(/Also from Riverside Elementary/)
    expect(screen.queryByText('Cohorts from this session only')).not.toBeInTheDocument()
  })

  it('shows primary-session annotation when hasMultipleEnrollments is true', async () => {
    render(
      <CamperCohortsSection
        personCmId={1000001}
        sessionCmId={201}
        year={2025}
        selfDisplayName="Emma"
        hasMultipleEnrollments={true}
      />
    )

    await screen.findByText(/Also from Riverside Elementary/)
    expect(screen.getByText('Cohorts from this session only')).toBeInTheDocument()
  })

  it('shows no annotation when hasMultipleEnrollments is omitted', async () => {
    render(
      <CamperCohortsSection
        personCmId={1000001}
        sessionCmId={201}
        year={2025}
        selfDisplayName="Emma"
      />
    )

    await screen.findByText(/Also from Riverside Elementary/)
    expect(screen.queryByText('Cohorts from this session only')).not.toBeInTheDocument()
  })
})
