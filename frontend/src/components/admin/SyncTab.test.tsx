/**
 * Regression test for #1881: SyncTab's generic sync card computed its Run button's `disabled`
 * state from a hand-maintained list — `isRunning || isPending || runIndividualSync.isPending ||
 * runOnDemandSync.isPending` — that never referenced any of the eleven type-specific mutation
 * hooks (camper_history, family_camp_derived, lodging_assignments, staff_skills,
 * financial_aid_applications, household_demographics, camper_dietary, camper_transportation,
 * quest_registrations, staff_applications, staff_vehicle_info). A double-click on one of those
 * cards could submit a second request before status polling flipped the card to "running".
 */
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncTab } from './SyncTab'

vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2027,
}))

const idleStatus = { status: 'idle' } as const

// Mutable per-test override for the stranded_assignment_cleanup status, read at call time so a
// single test (#2161's lodging⚠ badge) can inject a status without re-declaring the whole mock.
// Reset in `beforeEach` so tests stay isolated.
let strandedAssignmentCleanupStatus: unknown = idleStatus

vi.mock('../../hooks/useSyncCompletionToasts', () => ({
  useSyncCompletionToasts: () => ({
    camper_history: idleStatus,
    family_camp_derived: idleStatus,
    lodging_assignments: idleStatus,
    staff_skills: idleStatus,
    financial_aid_applications: idleStatus,
    household_demographics: idleStatus,
    camper_dietary: idleStatus,
    camper_transportation: idleStatus,
    quest_registrations: idleStatus,
    staff_applications: idleStatus,
    staff_vehicle_info: idleStatus,
    get stranded_assignment_cleanup() {
      return strandedAssignmentCleanupStatus
    },
  }),
}))

const notPending = { mutate: vi.fn(), isPending: false }

vi.mock('../../hooks/useRunIndividualSync', () => ({ useRunIndividualSync: () => notPending }))
vi.mock('../../hooks/useRunOnDemandSync', () => ({ useRunOnDemandSync: () => notPending }))
vi.mock('../../hooks/useUnifiedSync', () => ({ useUnifiedSync: () => notPending }))
vi.mock('../../hooks/useProcessRequests', () => ({ useProcessRequests: () => notPending }))
vi.mock('../../hooks/useCamperHistorySync', () => ({ useCamperHistorySync: () => notPending }))
vi.mock('../../hooks/useFamilyCampDerivedSync', () => ({
  useFamilyCampDerivedSync: () => notPending,
}))
vi.mock('../../hooks/useLodgingAssignmentsSync', () => ({
  useLodgingAssignmentsSync: () => notPending,
}))
vi.mock('../../hooks/useStaffSkillsSync', () => ({ useStaffSkillsSync: () => notPending }))
vi.mock('../../hooks/useFinancialAidApplicationsSync', () => ({
  useFinancialAidApplicationsSync: () => notPending,
}))
vi.mock('../../hooks/useHouseholdDemographicsSync', () => ({
  useHouseholdDemographicsSync: () => notPending,
}))
// The mutation under test: camper_dietary was one of the eleven hooks missing from the disabled
// condition entirely. Marking it pending must disable ONLY the Dietary card.
vi.mock('../../hooks/useCamperDietarySync', () => ({
  useCamperDietarySync: () => ({ mutate: vi.fn(), isPending: true }),
}))
vi.mock('../../hooks/useCamperTransportationSync', () => ({
  useCamperTransportationSync: () => notPending,
}))
vi.mock('../../hooks/useQuestRegistrationsSync', () => ({
  useQuestRegistrationsSync: () => notPending,
}))
vi.mock('../../hooks/useStaffApplicationsSync', () => ({
  useStaffApplicationsSync: () => notPending,
}))
vi.mock('../../hooks/useStaffVehicleInfoSync', () => ({
  useStaffVehicleInfoSync: () => notPending,
}))
vi.mock('../../hooks/useCancelQueuedSync', () => ({ useCancelQueuedSync: () => notPending }))
vi.mock('../../hooks/useCancelRunningSync', () => ({ useCancelRunningSync: () => notPending }))
vi.mock('../../hooks/useRunPhaseSync', () => ({ useRunPhaseSync: () => notPending }))

function renderSyncTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncTab />
    </QueryClientProvider>
  )
}

function getCardRunButton(cardName: string) {
  // The sync-year <select> also has an <option> with the same text as some card names
  // (e.g. "Camper History"), so scope to the card's title <div> specifically.
  const heading = screen.getByText(cardName, { selector: 'div' })
  const card = heading.closest('.flex.flex-col')
  if (!card) throw new Error(`could not find card for ${cardName}`)
  return within(card as HTMLElement).getByRole('button', { name: /run/i })
}

describe('SyncTab generic card pending guard (#1881)', () => {
  it('disables a card whose own type-specific mutation is pending', () => {
    renderSyncTab()

    expect(getCardRunButton('Dietary')).toBeDisabled()
  })

  it('leaves an unrelated type-specific card enabled', () => {
    renderSyncTab()

    expect(getCardRunButton('Camper History')).not.toBeDisabled()
    expect(getCardRunButton('Staff Skills')).not.toBeDisabled()
  })
})

// Regression test for #2161: Stats.LodgingProdAuditWarnings (pocketbase/sync/orchestrator.go)
// had zero frontend consumers. The bunk-side prod_audit_warnings already renders an amber
// "prod⚠" badge on the Stranded Assignment Cleanup card; the parallel lodging count must render
// its own distinguishable "lodging⚠" badge on the same card.
describe('SyncTab lodging prod audit warnings badge (#2161)', () => {
  afterEach(() => {
    strandedAssignmentCleanupStatus = idleStatus
  })

  it('renders a lodging⚠ badge when lodging_prod_audit_warnings is positive', () => {
    strandedAssignmentCleanupStatus = {
      status: 'success',
      summary: {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        lodging_prod_audit_warnings: 3,
      },
    }

    renderSyncTab()

    const heading = screen.getByText('Stranded Assignment Cleanup', { selector: 'div' })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error('could not find Stranded Assignment Cleanup card')

    expect(within(card as HTMLElement).getByText('3 lodging⚠')).toBeInTheDocument()
  })
})

// Regression test for #2284: Stats.Rejected is the new counter for per-record transform
// failures — one upstream record that could not be turned into a PocketBase row. It is
// warn-only for its first season, so it never fails a run; that makes surfacing it the ONLY
// way an operator learns it is climbing. A counter nobody can see is the bug this campaign
// is about, one level up.
describe('SyncTab rejected-records badge (#2284)', () => {
  afterEach(() => {
    strandedAssignmentCleanupStatus = idleStatus
  })

  it('renders a rejected badge when rejected is positive, on a run that otherwise succeeded', () => {
    strandedAssignmentCleanupStatus = {
      status: 'success',
      summary: {
        created: 12,
        updated: 0,
        skipped: 0,
        errors: 0,
        rejected: 7,
      },
    }

    renderSyncTab()

    const heading = screen.getByText('Stranded Assignment Cleanup', { selector: 'div' })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error('could not find Stranded Assignment Cleanup card')

    expect(within(card as HTMLElement).getByText('7 rejected')).toBeInTheDocument()
  })

  it('renders no rejected badge when rejected is zero', () => {
    strandedAssignmentCleanupStatus = {
      status: 'success',
      summary: { created: 12, updated: 0, skipped: 0, errors: 0, rejected: 0 },
    }

    renderSyncTab()

    const heading = screen.getByText('Stranded Assignment Cleanup', { selector: 'div' })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error('could not find Stranded Assignment Cleanup card')

    expect(within(card as HTMLElement).queryByText(/rejected/)).not.toBeInTheDocument()
  })
})
