/**
 * Component-level tests for AllCampersView teen-program support (Task 10).
 *
 * These exercise the composition the utils tests cannot: the wiring between
 * the session/camper fetches, the window-gated dropdownSessions, the
 * FILTER_TEENS scope, and the headline noun.
 *
 * Data is mocked at the hook/fetcher boundary so the component's real
 * filtering + headline logic runs unmocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import type { Camper } from '../types/app-types'
import type { CampSessionsResponse } from '../types/pocketbase-types'

// ── Mock data fixtures ──────────────────────────────────────────────────────
// Sessions: a summer main, a quest, a summer-window teen (scit), and an
// off-season teen (tli) that does NOT overlap the main-session window.
const SESSIONS = {
  main: {
    id: 'pb-main',
    cm_id: 1000001,
    name: 'Session 2',
    session_type: 'main',
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    year: 2025,
    created: '',
    updated: '',
  },
  quest: {
    id: 'pb-quest',
    cm_id: 1000002,
    name: 'Quest: Pacific Crest',
    session_type: 'quest',
    start_date: '2025-07-01',
    end_date: '2025-07-14',
    year: 2025,
    created: '',
    updated: '',
  },
  scit: {
    id: 'pb-scit',
    cm_id: 1000003,
    name: 'SCIT: Rising 12th',
    session_type: 'scit',
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    year: 2025,
    created: '',
    updated: '',
  },
  // Off-season tli — fall dates, no overlap with the June main window.
  offseasonTli: {
    id: 'pb-tli-fall',
    cm_id: 1000004,
    name: 'TLI: Fall Interns',
    session_type: 'tli',
    start_date: '2025-09-01',
    end_date: '2025-09-14',
    year: 2025,
    created: '',
    updated: '',
  },
  // AG session — never appears standalone in the dropdown; grouped under its
  // parent main (parent_id → main.cm_id) via getSessionRelationshipsForCamperView.
  ag: {
    id: 'pb-ag',
    cm_id: 1000005,
    name: 'All-Gender Session 2',
    session_type: 'ag',
    parent_id: 1000001,
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    year: 2025,
    created: '',
    updated: '',
  },
} as const

function camper(overrides: { person_cm_id: number; session_cm_id: number; name: string }): Camper {
  const [first, last] = overrides.name.split(' ')
  return {
    id: `${overrides.person_cm_id}:${overrides.session_cm_id}`,
    name: overrides.name,
    first_name: first ?? '',
    last_name: last ?? '',
    age: 16,
    grade: 11,
    gender: 'M',
    person_cm_id: overrides.person_cm_id,
    session_cm_id: overrides.session_cm_id,
    created: '',
    updated: '',
  }
}

// Mocks are reconfigured per test via these module-level holders.
let sessionsFixture: CampSessionsResponse[] = []
let campersFixture: Camper[] = []

vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getFullList: () => Promise.resolve(sessionsFixture),
    }),
  },
}))

vi.mock('../utils/pocketbaseDataFetchers', () => ({
  // Non-empty so the all-campers query doesn't early-return [].
  fetchAttendeesWithPersons: () => Promise.resolve([{ id: 'att-1' }]),
  fetchAssignmentsWithBunks: () => Promise.resolve([]),
  fetchBunksWithPlansForYear: () => Promise.resolve({ bunks: [], bunkPlans: [] }),
}))

vi.mock('../utils/transforms', () => ({
  buildCampersFromData: () => campersFixture,
  createLookupMaps: () => ({ assignments: new Map(), bunks: new Map() }),
}))

// Render eagerly so the virtual table list mounts; not strictly needed since we
// assert on the header count/noun, but keeps the component path realistic.
import AllCampersView from './AllCampersView'

function setFixtures(sessions: CampSessionsResponse[], campers: Camper[]) {
  sessionsFixture = sessions
  campersFixture = campers
}

/** Open the scope Listbox (by its current label) and return its options popup. */
function openScopePicker(label: RegExp): HTMLElement {
  const button = screen.getByRole('button', { name: label })
  fireEvent.click(button)
  return screen.getByRole('listbox')
}

/**
 * The results header renders "<count><noun>[ of <total>]". Assert the headline
 * noun robustly via the count span's parent, ignoring the optional " of N".
 */
function expectHeadline(count: number, noun: string) {
  // The big bold count span.
  const countEl = screen.getByText(String(count), {
    selector: 'span.font-display',
  })
  // Its sibling noun span starts with the noun text.
  const nounSpan = countEl.nextElementSibling as HTMLElement | null
  expect(nounSpan?.textContent ?? '').toMatch(new RegExp(`^${noun}\\b`))
}

beforeEach(() => {
  sessionsFixture = []
  campersFixture = []
})

describe('AllCampersView — teen program support', () => {
  it('(a) FILTER_TEENS shows only the summer-teen campers, count + "teens" noun, off-season excluded', async () => {
    setFixtures(
      [
        SESSIONS.main,
        SESSIONS.quest,
        SESSIONS.scit,
        SESSIONS.offseasonTli,
      ] as CampSessionsResponse[],
      [
        camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
        camper({ person_cm_id: 2, session_cm_id: SESSIONS.quest.cm_id, name: 'Liam Garcia' }),
        // two summer scit teens → count 2 → plural "teens"
        camper({ person_cm_id: 3, session_cm_id: SESSIONS.scit.cm_id, name: 'Olivia Chen' }),
        camper({ person_cm_id: 5, session_cm_id: SESSIONS.scit.cm_id, name: 'Samuel Johnson' }),
        // off-season teen — must never appear in any count
        camper({ person_cm_id: 4, session_cm_id: SESSIONS.offseasonTli.cm_id, name: 'Riley Sam' }),
      ]
    )

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    // Select Teen Programs scope.
    const popup = openScopePicker(/All Summer/i)
    fireEvent.click(within(popup).getByRole('option', { name: /^Teen Programs$/ }))

    // Two summer teens; off-season Riley Sam excluded → count 2, noun "teens".
    await waitFor(() => expectHeadline(2, 'teens'))
  })

  it('(b) "All Summer" headline matches cohorts; off-season teen never inflates count', async () => {
    setFixtures(
      [
        SESSIONS.main,
        SESSIONS.quest,
        SESSIONS.scit,
        SESSIONS.offseasonTli,
      ] as CampSessionsResponse[],
      [
        camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
        camper({ person_cm_id: 2, session_cm_id: SESSIONS.quest.cm_id, name: 'Liam Garcia' }),
        camper({ person_cm_id: 3, session_cm_id: SESSIONS.scit.cm_id, name: 'Olivia Chen' }),
        camper({ person_cm_id: 4, session_cm_id: SESSIONS.offseasonTli.cm_id, name: 'Riley Sam' }),
      ]
    )

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    // Window-gated universe = main + quest + scit (NOT off-season tli) → 3 campers,
    // three cohorts. Off-season Riley Sam is dropped from the count entirely.
    await waitFor(() => expectHeadline(3, 'campers, questers, and teens'))
  })

  it('(b2) off-season teen does NOT add a teen noun when no summer teens exist', async () => {
    setFixtures([SESSIONS.main, SESSIONS.quest, SESSIONS.offseasonTli] as CampSessionsResponse[], [
      camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
      camper({ person_cm_id: 2, session_cm_id: SESSIONS.quest.cm_id, name: 'Liam Garcia' }),
      camper({ person_cm_id: 4, session_cm_id: SESSIONS.offseasonTli.cm_id, name: 'Riley Sam' }),
    ])

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    // No summer teen → 2 campers, noun "campers and questers", NOT "...and teens".
    await waitFor(() => expectHeadline(2, 'campers and questers'))
    expect(screen.queryByText(/teens/)).not.toBeInTheDocument()
  })

  it('(c) teen-free fixture renders no Teens option and the old noun', async () => {
    setFixtures([SESSIONS.main, SESSIONS.quest] as CampSessionsResponse[], [
      camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
      camper({ person_cm_id: 2, session_cm_id: SESSIONS.quest.cm_id, name: 'Liam Garcia' }),
    ])

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    // Old noun: campers and questers (no teens).
    await waitFor(() => expectHeadline(2, 'campers and questers'))

    // No "Teen Programs" quick-pick option in the scope picker.
    const popup = openScopePicker(/All Summer/i)
    expect(within(popup).queryByRole('option', { name: /^Teen Programs$/ })).not.toBeInTheDocument()
  })

  it('(d) AG campers survive the window-gate scoping (not dropped by summerCampers)', async () => {
    // AG sessions never appear standalone in dropdownSessions, but each main's
    // relationship entry includes its AG children's PB ids — so an AG-only
    // camper must still be counted. Guards against a refactor silently dropping
    // AG campers via scopedSessionPbIds / summerCampers.
    setFixtures([SESSIONS.main, SESSIONS.ag] as CampSessionsResponse[], [
      camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
      // enrolled ONLY in the AG session
      camper({ person_cm_id: 2, session_cm_id: SESSIONS.ag.cm_id, name: 'Liam Garcia' }),
    ])

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    // All Summer: both campers counted (AG camper not dropped). AG counts as
    // at-camp for the noun → "campers".
    await waitFor(() => expectHeadline(2, 'campers'))

    // Selecting "At Camp" must still include both (AG grouped under its parent main).
    const popup = openScopePicker(/All Summer/i)
    fireEvent.click(within(popup).getByRole('option', { name: /^At Camp$/ }))
    await waitFor(() => expectHeadline(2, 'campers'))
  })
})

/**
 * The header's gear button is the one rendered, ungated link to the admin
 * surface. It pointed at /admin and survived the nav consolidation only
 * because /admin still redirected; once those redirects were retired it would
 * have become a dead link, so it has to name /manage directly.
 */
describe('AllCampersView — settings link target', () => {
  it('points the settings gear at /manage, not the retired /admin', async () => {
    setFixtures([SESSIONS.main] as CampSessionsResponse[], [
      camper({ person_cm_id: 1, session_cm_id: SESSIONS.main.cm_id, name: 'Emma Johnson' }),
    ])

    render(<AllCampersView />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.queryByText('Loading campers...')).not.toBeInTheDocument())

    const settingsLink = screen.getByTitle('Admin Settings')
    expect(settingsLink).toHaveAttribute('href', '/manage')
  })
})
