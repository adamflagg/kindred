/**
 * Regression test for #1881: SyncTab's generic sync card computed its Run button's `disabled`
 * state from a hand-maintained list — `isRunning || isPending || runIndividualSync.isPending ||
 * runOnDemandSync.isPending` — that never referenced any of the ten type-specific mutation
 * hooks (family_camp_derived, lodging_assignments, staff_skills,
 * financial_aid_applications, household_demographics, camper_dietary, camper_transportation,
 * quest_registrations, staff_applications, staff_vehicle_info). A double-click on one of those
 * cards could submit a second request before status polling flipped the card to "running".
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncTab } from './SyncTab'
import { hasManualTrigger, YEAR_SYNC_TYPES } from './syncTypes'

vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2027,
}))

const idleStatus = { status: 'idle' } as const

// Mutable per-test override for the stranded_assignment_cleanup status, read at call time so a
// single test (#2161's lodging⚠ badge) can inject a status without re-declaring the whole mock.
// Reset in `beforeEach` so tests stay isolated.
let strandedAssignmentCleanupStatus: unknown = idleStatus

// #2295 needs two more injectable statuses, one per card path: `persons` is a
// year sync (renderSyncCard) and `staff_lookups` is a global one (the second,
// inlined card block further down SyncTab). Both are reset in afterEach.
let personsStatus: unknown = idleStatus
let staffLookupsStatus: unknown = idleStatus

// #2267 needs its own injectable status: `staff` is a year sync (renderSyncCard) and is not
// covered by any existing entry above. Reset in afterEach.
let staffStatus: unknown = idleStatus

// kindred#2356: `camper_transportation` is a year sync (renderSyncCard) and needs its own
// injectable status to pin the skipped_values badge. Reset in afterEach.
let camperTransportationStatus: unknown = idleStatus

vi.mock('../../hooks/useSyncCompletionToasts', () => ({
  useSyncCompletionToasts: () => ({
    family_camp_derived: idleStatus,
    lodging_assignments: idleStatus,
    staff_skills: idleStatus,
    financial_aid_applications: idleStatus,
    household_demographics: idleStatus,
    camper_dietary: idleStatus,
    quest_registrations: idleStatus,
    staff_applications: idleStatus,
    staff_vehicle_info: idleStatus,
    get stranded_assignment_cleanup() {
      return strandedAssignmentCleanupStatus
    },
    get persons() {
      return personsStatus
    },
    get staff_lookups() {
      return staffLookupsStatus
    },
    get staff() {
      return staffStatus
    },
    get camper_transportation() {
      return camperTransportationStatus
    },
  }),
}))

const notPending = { mutate: vi.fn(), isPending: false }

vi.mock('../../hooks/useRunIndividualSync', () => ({ useRunIndividualSync: () => notPending }))
vi.mock('../../hooks/useRunOnDemandSync', () => ({ useRunOnDemandSync: () => notPending }))
// kindred#2593's year-change reset needs its own spy: `syncService` is React state, and a
// controlled <select> whose value matches no <option> reports the FIRST option ("all") in the
// DOM either way -- so reading select.value cannot tell a reset apart from a stale selection.
// What the stale selection actually costs is the request, so assert the request.
const unifiedSyncMutate = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useUnifiedSync', () => ({
  useUnifiedSync: () => ({ mutate: unifiedSyncMutate, isPending: false }),
}))
vi.mock('../../hooks/useProcessRequests', () => ({ useProcessRequests: () => notPending }))
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
// The mutation under test: camper_dietary was one of the ten hooks missing from the disabled
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

// #2600: the phase header's "(N jobs)" count and the Run Phase button's own count are
// deliberately different facts (membership vs. what a phase run actually starts), so the
// button's count comes from this separate query hook rather than `types.length`. Most tests
// don't care about it, so the default mock reports no data -- the button falls back to plain
// "Run Phase" text, same as the pre-#2600 behavior -- and the one test that does care
// (below) overrides it per-call.
let syncPhasesData: unknown = undefined
vi.mock('../../hooks/useSyncPhasesAPI', () => ({
  useSyncPhasesAPI: () => ({ data: syncPhasesData }),
}))

function renderSyncTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SyncTab />
    </QueryClientProvider>
  )
}

function getCard(cardName: string) {
  // The sync-year <select> also has an <option> with the same text as some card names
  // (e.g. "Lodging Assignments"), so scope to the card's title <div> specifically.
  const heading = screen.getByText(cardName, { selector: 'div' })
  const card = heading.closest('.flex.flex-col')
  if (!card) throw new Error(`could not find card for ${cardName}`)
  return card as HTMLElement
}

function getCardRunButton(cardName: string) {
  return within(getCard(cardName)).getByRole('button', { name: /run/i })
}

// The Full-mode service <select>; identified by its own "All Services" option so it is never
// confused with the sync-year <select> beside it.
function getServiceSelect() {
  const select = screen.getByRole('option', { name: 'All Services' }).closest('select')
  if (!select) throw new Error('could not find the service select')
  return select
}

describe('SyncTab generic card pending guard (#1881)', () => {
  it('disables a card whose own type-specific mutation is pending', () => {
    renderSyncTab()

    expect(getCardRunButton('Dietary')).toBeDisabled()
  })

  it('leaves an unrelated type-specific card enabled', () => {
    renderSyncTab()

    expect(getCardRunButton('Lodging Assignments')).not.toBeDisabled()
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

// Regression test for #2295. Stats.Rejected can exist ONLY inside SubStats: `persons` is a
// combined sync that populates households through its own Stats and reports them as
// sub_stats.households (persons.go GetStats), and the household half is where the
// reclassified reject site lives. Nothing folds that nested count into the parent's, so a
// card that renders summary.rejected alone shows no badge at all for the one service whose
// rejections the campaign actually produces first.
//
// This is the same hole the backend closed in totalInfrastructureErrors, one layer out: the
// count exists, it is warn-only so nothing else surfaces it, and the operator never sees it.
describe('SyncTab nested rejected records (#2295)', () => {
  afterEach(() => {
    personsStatus = idleStatus
    staffLookupsStatus = idleStatus
  })

  function cardByTitle(name: string, selector: 'div' | 'span') {
    const heading = screen.getByText(name, { selector })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error(`could not find card for ${name}`)
    return card as HTMLElement
  }

  it('renders a sub-entity rejected count the parent never counted', () => {
    personsStatus = {
      status: 'success',
      summary: {
        created: 120,
        updated: 0,
        skipped: 0,
        errors: 0,
        rejected: 0,
        sub_stats: {
          households: { created: 40, updated: 0, skipped: 0, errors: 0, rejected: 4 },
        },
      },
    }

    renderSyncTab()

    expect(within(cardByTitle('Persons', 'div')).getByText('4 rejected')).toBeInTheDocument()
  })

  it('adds the parent and sub-entity counts together', () => {
    personsStatus = {
      status: 'success',
      summary: {
        created: 120,
        updated: 0,
        skipped: 0,
        errors: 0,
        rejected: 3,
        sub_stats: {
          households: { created: 40, updated: 0, skipped: 0, errors: 0, rejected: 4 },
        },
      },
    }

    renderSyncTab()

    expect(within(cardByTitle('Persons', 'div')).getByText('7 rejected')).toBeInTheDocument()
  })

  it('renders no badge when the parent and every sub-entity are clean', () => {
    personsStatus = {
      status: 'success',
      summary: {
        created: 120,
        updated: 0,
        skipped: 0,
        errors: 0,
        rejected: 0,
        sub_stats: {
          households: { created: 40, updated: 0, skipped: 0, errors: 0, rejected: 0 },
        },
      },
    }

    renderSyncTab()

    expect(within(cardByTitle('Persons', 'div')).queryByText(/rejected/)).not.toBeInTheDocument()
  })

  // The global-sync-type block is a second, separately written card with its own copy of the
  // badge markup. staff_lookups is one of the services this PR reclassifies, and it sweeps
  // three collections, so leaving the aggregate out of this path would hide exactly the
  // counts #2295 exists to surface.
  it('aggregates on the global sync card path too', () => {
    staffLookupsStatus = {
      status: 'success',
      summary: {
        created: 6,
        updated: 0,
        skipped: 0,
        errors: 0,
        rejected: 2,
        sub_stats: {
          positions: { created: 3, updated: 0, skipped: 0, errors: 0, rejected: 5 },
        },
      },
    }

    renderSyncTab()
    // The global block ships collapsed, so the second card path only mounts once
    // "Global Definitions" is open.
    fireEvent.click(screen.getByText('Global Definitions'))

    expect(within(cardByTitle('Staff Lookups', 'span')).getByText('7 rejected')).toBeInTheDocument()
  })
})

// Regression test for #2267: Stats.DuplicateStaffStatus (pocketbase/sync/orchestrator.go) is
// the new counter for staff records dropped because the same person appeared under more than
// one CampMinder status in one run. Before the fix there was no counter at all and the only
// trace was a slog.Debug line invisible at the default LOG_LEVEL=INFO — a counter nobody can
// see on the Sync tab is the same class of bug #2284's rejected badge fixed, one field over.
describe('SyncTab duplicate staff status badge (#2267)', () => {
  afterEach(() => {
    staffStatus = idleStatus
  })

  function staffCard() {
    const heading = screen.getByText('Staff', { selector: 'div' })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error('could not find Staff card')
    return card as HTMLElement
  }

  it('renders a duplicate-status badge when duplicate_staff_status is positive', () => {
    staffStatus = {
      status: 'success',
      summary: {
        created: 5,
        updated: 0,
        skipped: 0,
        errors: 0,
        duplicate_staff_status: 2,
      },
    }

    renderSyncTab()

    expect(within(staffCard()).getByText('2 dup status')).toBeInTheDocument()
  })

  it('renders no duplicate-status badge when duplicate_staff_status is zero or absent', () => {
    staffStatus = {
      status: 'success',
      summary: { created: 5, updated: 0, skipped: 0, errors: 0 },
    }

    renderSyncTab()

    expect(within(staffCard()).queryByText(/dup status/)).not.toBeInTheDocument()
  })
})

// Regression test for kindred#2356 (review follow-up): the Sync tab's persistent per-service
// badge row rendered every other special counter (rejected, duplicate_staff_status,
// already_processed, prod_audit_warnings, lodging_prod_audit_warnings) but not the new
// skipped_values -- and since the fix moved camper_transportation/staff_applications off
// Stats.Skipped entirely, their "skip" badge went permanently blank with no replacement. An
// operator who doesn't catch the 5-second toast has no on-screen signal at all that field
// values were discarded.
describe('SyncTab skipped-values badge (kindred#2356)', () => {
  afterEach(() => {
    camperTransportationStatus = idleStatus
  })

  function transportationCard() {
    const heading = screen.getByText('Transportation', { selector: 'div' })
    const card = heading.closest('.flex.flex-col')
    if (!card) throw new Error('could not find Transportation card')
    return card as HTMLElement
  }

  it('renders a values-skipped badge when skipped_values is positive', () => {
    camperTransportationStatus = {
      status: 'success',
      summary: { created: 10, updated: 0, skipped: 0, errors: 0, skipped_values: 557 },
    }

    renderSyncTab()

    expect(within(transportationCard()).getByText('557 val skip')).toBeInTheDocument()
  })

  it('renders no values-skipped badge when skipped_values is zero or absent', () => {
    camperTransportationStatus = {
      status: 'success',
      summary: { created: 10, updated: 0, skipped: 0, errors: 0 },
    }

    renderSyncTab()

    expect(within(transportationCard()).queryByText(/val skip/)).not.toBeInTheDocument()
  })
})

// kindred#2593: three jobs the backend runs only via daily cron -- never through any
// individual POST route -- get status-visible cards, but their Run button would throw
// "Unknown sync type" (or, if that check were bypassed, 404 against a route that does not
// exist) the moment it was clicked. Giving them the generic Run button back would be a new
// bug, not a fix, so their cards render without one.
describe('SyncTab jobs with no manual trigger (kindred#2593)', () => {
  it('renders a card for the bounded family-camp person custom-values job with no Run button', () => {
    renderSyncTab()

    const card = getCard('Person CV (FC)')
    expect(within(card).queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
  })

  it('renders a card for the bounded family-camp household custom-values job with no Run button', () => {
    renderSyncTab()

    const card = getCard('Household CV (FC)')
    expect(within(card).queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
  })

  it('renders a card for reconcile_request_lifecycle with no Run button', () => {
    renderSyncTab()

    const card = getCard('Reconcile Lifecycle')
    expect(within(card).queryByRole('button', { name: /run/i })).not.toBeInTheDocument()
  })
})

// kindred#2593: YEAR_SYNC_TYPES had zero entries with `phase: 'export'`, so the Export phase
// section rendered nothing at all -- `getSyncTypesByPhase('export', ...)` always returned []
// and SyncTab's phase loop returns null for an empty phase (`if (types.length === 0) return
// null`). multi_workbook_export had a working POST route and toast/invalidation coverage the
// whole time; it just never got a card. This is the regression test for the section existing
// and its Run button actually working (unlike the three no-manual-trigger jobs above).
describe('SyncTab Export phase now has a card (kindred#2593)', () => {
  it('renders a Sheets Export card with an enabled Run button', () => {
    renderSyncTab()

    expect(getCardRunButton('Sheets Export')).not.toBeDisabled()
  })
})

// kindred#2593: removing the card's Run button is only half a "no manual trigger" -- the same
// page's Full-mode service <select> is the other half, and it POSTs
// /api/custom/sync/run?service=<id>.
//
// When this was written that endpoint had no service whitelist at all, so this filter was the
// only thing stopping it: person_custom_values_family_camp and its household sibling ARE
// registered services (orchestrator.go), and an option for either would really have run the
// bounded family-camp cohort that phaseExecutionJobs deliberately drops from an
// admin-triggered run (#2489/#2491 Face C, ~11.5 min of rate-limited CampMinder quota re-spent
// on values the daily cron refreshed minutes earlier). handleUnifiedSync now rejects a job
// declaring no TriggerIndividualRoute with a 400 (#2608), which makes this defence in depth
// rather than the only defence -- and still worth asserting, because offering a user an option
// that can only fail is its own bug.
describe('SyncTab service dropdown offers only triggerable jobs (kindred#2593)', () => {
  it('omits every job whose card has no Run button', () => {
    renderSyncTab()

    const optionValues = [...getServiceSelect().options].map((o) => o.value)
    const noManualTrigger = YEAR_SYNC_TYPES.filter((t) => !hasManualTrigger(t)).map((t) => t.id)

    expect(noManualTrigger.length).toBeGreaterThan(0)
    for (const id of noManualTrigger) {
      expect(optionValues).not.toContain(id)
    }
  })

  it('still offers the jobs that do have a route, including the newly carded export', () => {
    renderSyncTab()

    const optionValues = [...getServiceSelect().options].map((o) => o.value)
    expect(optionValues).toContain('all')
    expect(optionValues).toContain('multi_workbook_export')
    expect(optionValues).toContain('persons')
  })
})

// kindred#2593: the year-change reset named bunk_requests/process_requests literally, while
// five YEAR_SYNC_TYPES entries now carry currentYearOnly. A selection that survives the switch
// is not merely stale: the option disappears from the <select> while `syncService` still holds
// it, so Run Sync POSTs a current-year-only service against a historical year.
describe('SyncTab clears a current-year-only service on year change (kindred#2593)', () => {
  function selectHistoricalYear() {
    const yearSelect = screen.getByRole('option', { name: '2026' }).closest('select')
    fireEvent.change(yearSelect as HTMLSelectElement, { target: { value: '2026' } })
  }

  it('submits All Services when the selected service was current-year-only', () => {
    unifiedSyncMutate.mockClear()
    renderSyncTab()

    fireEvent.change(getServiceSelect(), { target: { value: 'bunk_requests' } })
    selectHistoricalYear()
    fireEvent.click(screen.getByRole('button', { name: /run sync/i }))

    expect(unifiedSyncMutate).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, service: 'all' })
    )
  })

  it('keeps a service that is valid for historical years', () => {
    unifiedSyncMutate.mockClear()
    renderSyncTab()

    fireEvent.change(getServiceSelect(), { target: { value: 'persons' } })
    selectHistoricalYear()
    fireEvent.click(screen.getByRole('button', { name: /run sync/i }))

    expect(unifiedSyncMutate).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, service: 'persons' })
    )
  })
})

// kindred#2600: the Sync tab's Custom Values phase header read "(4 jobs)" directly above a
// Run Phase button that only starts 2 -- the two bounded family-camp custom-values variants
// are members of the phase (GetJobsForPhase) but are never started by an admin phase run
// (phaseExecutionJobs, kindred#2489). The header keeps counting membership; the button must
// count what it actually starts.
describe('SyncTab phase header counts membership, button counts what it starts (#2600)', () => {
  afterEach(() => {
    syncPhasesData = undefined
  })

  it('counts membership in the header and what it starts on the button', () => {
    syncPhasesData = {
      phases: [
        {
          id: 'expensive',
          name: 'Custom Values',
          description: '1 API call per entity',
          jobs: [
            'person_custom_values',
            'household_custom_values',
            'person_custom_values_family_camp',
            'household_custom_values_family_camp',
          ],
          run_jobs: ['person_custom_values', 'household_custom_values'],
        },
      ],
    }

    renderSyncTab()

    expect(screen.getByText('Custom Values')).toBeInTheDocument()
    expect(screen.getByText('(4 jobs)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run Phase \(2\)/ })).toBeInTheDocument()
  })

  it('falls back to a plain "Run Phase" button before the count arrives', () => {
    syncPhasesData = undefined

    renderSyncTab()

    expect(screen.getByText('(4 jobs)')).toBeInTheDocument()
    // The header row's Run Phase button (not the top quick-action one, which never had a
    // count and is a separate control) has no "(N)" suffix while the count is unknown.
    const headerRow = screen.getByText('Custom Values').closest('div')
    if (!headerRow) throw new Error('could not find Custom Values phase header row')
    expect(
      within(headerRow as HTMLElement).getByRole('button', { name: 'Run Phase' })
    ).toBeInTheDocument()
  })

  it('survives a null run_jobs instead of taking the tab down (#2600 review)', () => {
    // Go marshals a nil slice as JSON null, and inPhaseWithTrigger returns nil for a phase
    // with no TriggerPhaseRun job. The payload is cast, not validated, so an unguarded
    // `phase.run_jobs.length` would throw inside a render-time memo and unmount the whole Sync
    // tab -- a worse failure than the missing count this feature exists to supply.
    syncPhasesData = {
      phases: [
        { id: 'expensive', name: 'Custom Values', description: '', jobs: [], run_jobs: null },
      ],
    }

    renderSyncTab()

    // The tab still renders, and the button degrades to its plain label rather than vanishing.
    expect(screen.getByText('(4 jobs)')).toBeInTheDocument()
    const headerRow = screen.getByText('Custom Values').closest('div')
    if (!headerRow) throw new Error('could not find Custom Values phase header row')
    expect(
      within(headerRow as HTMLElement).getByRole('button', { name: 'Run Phase' })
    ).toBeInTheDocument()
  })
})
