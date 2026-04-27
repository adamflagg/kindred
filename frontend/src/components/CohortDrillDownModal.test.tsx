/**
 * Tests for CohortDrillDownModal — the modal that opens when a user clicks
 * a cohort row in CamperCohortsSection. Renders the matched campers
 * (already gender-scoped + same-session by the hook).
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '../test/testUtils'
import { CohortDrillDownModal } from './CohortDrillDownModal'
import type { CohortMatchedAttendee } from '../hooks/useCamperCohorts'

function makeMatch(overrides: Partial<CohortMatchedAttendee> = {}): CohortMatchedAttendee {
  return {
    attendeeId: 'a1',
    personCmId: 1000002,
    firstName: 'Liam',
    lastName: 'Garcia',
    preferredName: null,
    grade: 7,
    gender: 'M',
    ...overrides,
  }
}

describe('CohortDrillDownModal', () => {
  it('renders the cohort label and count in the header', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch(), makeMatch({ attendeeId: 'a2', personCmId: 1000003 })]}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Riverside Elementary/)).toBeInTheDocument()
    expect(screen.getByText(/2 campers/i)).toBeInTheDocument()
  })

  it('lists each matched camper by display name', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[
          makeMatch({ firstName: 'Liam', lastName: 'Garcia', preferredName: null }),
          makeMatch({
            attendeeId: 'a2',
            personCmId: 1000003,
            firstName: 'Samuel',
            lastName: 'Johnson',
            preferredName: 'Sam',
          }),
        ]}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    // Preferred name takes precedence
    expect(screen.getByText(/Sam Johnson/)).toBeInTheDocument()
  })

  it('renders camper names as links to /camper/{personCmId} that open in a new tab', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch({ personCmId: 1000002 })]}
        onClose={() => {}}
      />
    )
    const link = screen.getByRole('link', { name: /Liam Garcia/ })
    expect(link).toHaveAttribute('href', '/camper/1000002')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('header copy says "same gender" for non-AG sessions', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch()]}
        sessionType="main"
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/same gender/i)).toBeInTheDocument()
    expect(screen.queryByText(/all genders/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/valid bunkmates only/i)).not.toBeInTheDocument()
  })

  it('header copy says "all genders" for AG sessions', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch()]}
        sessionType="ag"
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/all genders/i)).toBeInTheDocument()
    expect(screen.queryByText(/same gender/i)).not.toBeInTheDocument()
  })

  it('shows grade and gender icon for each camper', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="city"
        label="Springfield"
        attendees={[makeMatch({ grade: 8, gender: 'M' })]}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/8th/i)).toBeInTheDocument()
    const genderIcon = screen.getByTestId('cohort-modal-gender')
    expect(genderIcon).toHaveAttribute('data-gender', 'M')
    expect(genderIcon).toHaveAttribute('aria-label', 'Boy')
  })

  it('shows an empty-state message when no campers match', () => {
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="congregation"
        label="Beth Shalom"
        attendees={[]}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/no other campers/i)).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch()]}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows "Requested to bunk with {self}" for incoming bunk_with relations', () => {
    render(
      <CohortDrillDownModal
        open
        kind="school"
        label="Riverside Elementary"
        selfDisplayName="Emma"
        attendees={[
          makeMatch({ personCmId: 1000002, firstName: 'Riley' }),
          makeMatch({ attendeeId: 'a2', personCmId: 1000003, firstName: 'Olivia' }),
        ]}
        requestRelations={new Map([[1000002, { type: 'bunk_with', mutual: false }]])}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Requested to bunk with Emma/)).toBeInTheDocument()
    // Olivia (no relation) row contains no badge text
    const oliviaRow = screen.getByText(/Olivia Garcia/).closest('[data-testid="cohort-modal-row"]')
    expect(oliviaRow?.textContent).not.toMatch(/Requested to bunk with/)
  })

  it('shows "Not to bunk with {self}" for incoming not_bunk_with relations', () => {
    render(
      <CohortDrillDownModal
        open
        kind="school"
        label="Riverside Elementary"
        selfDisplayName="Emma"
        attendees={[makeMatch({ personCmId: 1000004, firstName: 'Riley' })]}
        requestRelations={new Map([[1000004, { type: 'not_bunk_with', mutual: false }]])}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Not to bunk with Emma/)).toBeInTheDocument()
  })

  it('renders an M mutual marker when mutual=true', () => {
    render(
      <CohortDrillDownModal
        open
        kind="school"
        label="Riverside Elementary"
        selfDisplayName="Emma"
        attendees={[makeMatch({ personCmId: 1000005, firstName: 'Riley' })]}
        requestRelations={new Map([[1000005, { type: 'bunk_with', mutual: true }]])}
        onClose={() => {}}
      />
    )
    // Mutual marker has its own testid for unambiguous lookup
    expect(screen.getByTestId('cohort-modal-mutual')).toBeInTheDocument()
    expect(screen.getByTestId('cohort-modal-mutual').textContent).toMatch(/^Mutual$/)
  })

  it('renders no mutual marker when mutual=false', () => {
    render(
      <CohortDrillDownModal
        open
        kind="school"
        label="Riverside Elementary"
        selfDisplayName="Emma"
        attendees={[makeMatch({ personCmId: 1000005, firstName: 'Riley' })]}
        requestRelations={new Map([[1000005, { type: 'bunk_with', mutual: false }]])}
        onClose={() => {}}
      />
    )
    expect(screen.queryByTestId('cohort-modal-mutual')).not.toBeInTheDocument()
  })

  it('renders no relation badges when requestRelations prop is omitted', () => {
    render(
      <CohortDrillDownModal
        open
        kind="school"
        label="Riverside Elementary"
        selfDisplayName="Emma"
        attendees={[makeMatch()]}
        onClose={() => {}}
      />
    )
    expect(screen.queryByText(/Requested to bunk with/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Not to bunk with/)).not.toBeInTheDocument()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <CohortDrillDownModal
        selfDisplayName="Emma"
        open={false}
        kind="school"
        label="Riverside Elementary"
        attendees={[makeMatch()]}
        onClose={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
