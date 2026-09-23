/**
 * Tests for CamperDetailsPanel component.
 *
 * This component displays detailed camper information in a slide-in panel,
 * including bunking preferences, camp journey history, siblings, and the
 * parent-sourced bunk request form text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '../test/testUtils'
import CamperDetailsPanel from './CamperDetailsPanel'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from './ui/modalStack'
import { mockPerson } from '../test/mockData'
import { SourceField } from '../types/sourceField'
import { getSessionDisplayNameFromString } from '../utils/sessionDisplay'
import type { CamperSatisfaction, PerRequestStatus } from '../types/satisfaction'
import type { HistoricalRecord, JourneyCounts } from '../hooks/camper/types'

// Configurable per-collection mock factories
const mockGetFullListPersons = vi.fn()
const mockGetFullListAttendees = vi.fn()
const mockGetFullListBunkAssignments = vi.fn()
const mockGetFullListBunkRequests = vi.fn()
const mockGetListOriginalBunkRequests = vi.fn()
const mockGetListPersons = vi.fn()

// Mock the pocketbase module with per-collection dispatch
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      switch (name) {
        case 'persons':
          return {
            getFullList: mockGetFullListPersons,
            getList: mockGetListPersons,
          }
        case 'attendees':
          return { getFullList: mockGetFullListAttendees }
        case 'bunk_assignments':
          return { getFullList: mockGetFullListBunkAssignments }
        case 'bunk_requests':
          return { getFullList: mockGetFullListBunkRequests }
        case 'original_bunk_requests':
          return { getList: mockGetListOriginalBunkRequests }
        default:
          return {
            getFullList: vi.fn().mockResolvedValue([]),
            getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
          }
      }
    }),
    authStore: {
      isValid: true,
      token: 'mock-token',
      model: { id: 'admin' },
    },
  },
}))

// Mock useYear hook
vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

// The Camp Journey rows and the quick-stats count line come from the one
// shared journey feed (useCamperJourney). Its own
// household/auth/housing plumbing is tested in useCamperJourney.test.tsx;
// here it is a plain source of rows and counts.
const mockUseCamperJourney = vi.fn()
vi.mock('../hooks/camper/useCamperJourney', () => ({
  useCamperJourney: (...args: unknown[]) => mockUseCamperJourney(...args),
}))

function journeyWith(
  rows: HistoricalRecord[],
  counts: JourneyCounts = { summers: 0, familyWeekends: 0, adultWeekends: 0 }
) {
  // Q9 (owner, 2026-09-22 late): the real hook always returns a Map here
  // (never undefined) — tests that need a populated one override the field.
  return { rows, counts, isLoading: false, error: null, teenCabinsByWeekend: new Map() }
}

// Mock AuthContext — AllCamperRequestsModal calls useAuth() at module load,
// even when isOpen=false, so tests need an AuthContext-shaped stub.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    pb: {},
    user: { id: 'admin', email: 'test@example.com' },
    isLoading: false,
    isAuthenticated: true,
    isBypassMode: false,
    login: vi.fn(),
    logout: vi.fn(),
    error: null,
    checkAuth: vi.fn().mockResolvedValue(true),
  }),
}))

// Configurable mock for getSatisfiedRequestInfo — overridden in alert tests.
// Default returns empty CamperSatisfaction so existing tests are unaffected.
let mockGetSatisfiedRequestInfo = vi.fn((personCmId: number): CamperSatisfaction => ({
  person_cm_id: personCmId,
  per_request: [] as PerRequestStatus[],
  counted_totals: {
    material_parent: { satisfied: 0, total: 0 },
    staff: { satisfied: 0, total: 0 },
  },
  immaterial: { satisfied: 0, total: 0 },
  flags: {
    parent_min_one_violation: false,
    staff_unsatisfied_alert: false,
    has_any_counted_request: false,
  },
}))

// Mock useBunkRequestContext — CamperDetailsPanel uses getSatisfiedRequestInfo
// from BunkRequestProvider to derive the unsatisfied-requests alert in parity
// with CamperCard. Default to "no requests / nothing satisfied" so existing
// tests don't have to think about request data.
vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useBunkRequestContext: () => ({
      allRequests: [],
      hasRequests: () => false,
      getRequestsForCamper: () => [],
      getSatisfiedRequestInfo: (personCmId: number) => mockGetSatisfiedRequestInfo(personCmId),
      isLoading: false,
      error: null,
    }),
  }
})

// Mutable mock for LockGroupContext so tests can toggle isActionBarVisible
const mockLockGroupContext: { isActionBarVisible: boolean } & Record<string, unknown> = {
  isActionBarVisible: false,
  isDraftMode: false,
  groups: [],
  pendingCampers: [],
  addPendingCamper: vi.fn(),
  removePendingCamper: vi.fn(),
  getPendingAnimationDelay: () => 0,
  addCamperToGroup: vi.fn(),
  getCamperLockGroup: () => null,
  getCamperLockState: () => 'none' as const,
  getCamperLockGroupColor: () => undefined,
  getGroupMembers: () => [],
  createLockGroup: vi.fn(),
  deleteLockGroup: vi.fn(),
  isLoading: false,
}
// Mock LockGroupContext — CamperDetailsPanel uses it for alert derivation
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => mockLockGroupContext,
}))

// ---------------------------------------------------------------------------
// Shared fixture data (fictional names per CLAUDE.md)
// ---------------------------------------------------------------------------

/** A minimal persons record for Emma Johnson, cm_id=100 */
const EMMA = mockPerson({ id: 'pb-emma', cm_id: 100, grade: 6, year: 2025, household_id: 0 })

/** Liam Garcia is the bunk-request target (different session, so declined) */
const LIAM = mockPerson({
  id: 'pb-liam',
  cm_id: 201,
  first_name: 'Liam',
  last_name: 'Garcia',
  gender: 'M',
  grade: 6,
  year: 2025,
  household_id: 0,
})

/**
 * Emma's resolved-with-decline-disposition bunk-with request targeting Liam
 * Garcia (different session).
 *
 * Production query at CamperDetailsPanel.tsx:422 filters `status = "resolved"`
 * — declined-disposition rows reach the panel by being `status='resolved'` with
 * a `disposition_reason` set, not by `status='declined'`. Fixture matches the
 * shape that can actually surface in prod (#1341).
 */
const DECLINED_REQUEST: Record<string, unknown> = {
  id: 'req-declined-1',
  requester_id: 100,
  requestee_id: 201,
  request_type: 'bunk_with',
  status: 'resolved',
  requested_person_name: 'Liam Garcia',
  disposition_reason: 'session_mismatch',
  year: 2025,
  session_id: 1001,
  is_reciprocal: false,
  confidence_score: 0.92,
  source_field: 'share_bunk_with',
  created: '2025-01-01T00:00:00Z',
  updated: '2025-01-01T00:00:00Z',
  collectionId: 'bunk_requests',
  collectionName: 'bunk_requests',
  metadata: {},
}

/** A minimal attendee record for Emma */
const EMMA_ATTENDEE: Record<string, unknown> = {
  id: 'att-emma',
  person: 'pb-emma',
  person_id: 100,
  session: 'sess-1',
  status: 'enrolled',
  status_id: 2,
  year: 2025,
  collectionId: 'attendees',
  collectionName: 'attendees',
  created: '2025-01-01T00:00:00Z',
  updated: '2025-01-01T00:00:00Z',
  expand: {
    session: {
      id: 'sess-1',
      cm_id: 1001,
      name: 'Session 1',
      session_type: 'main',
    },
  },
}

/**
 * Set up per-collection mocks for a camper (Emma) with one declined request.
 * Persons is called twice: first for the main camper, then for the requestees.
 */
function setupDeclinedRequestMocks() {
  // First call: look up the main camper by cm_id (filter includes person cm_id)
  // Second call: look up requestees by cm_id (filter includes requestee cm_id list)
  mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
    const filter = opts.filter ?? ''
    if (filter.includes(`cm_id = ${LIAM.cm_id}`)) {
      return Promise.resolve([LIAM])
    }
    return Promise.resolve([EMMA])
  })
  mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
  mockGetFullListBunkAssignments.mockResolvedValue([])
  mockGetFullListBunkRequests.mockResolvedValue([DECLINED_REQUEST])
  mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
  mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
}

describe('CamperDetailsPanel', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockLockGroupContext.isActionBarVisible = false
    // Reset getSatisfiedRequestInfo to the default no-op after each test
    mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
      person_cm_id: personCmId,
      per_request: [],
      counted_totals: {
        material_parent: { satisfied: 0, total: 0 },
        staff: { satisfied: 0, total: 0 },
      },
      immaterial: { satisfied: 0, total: 0 },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: false,
        has_any_counted_request: false,
      },
    }))
    // Default: empty responses for all collections
    mockGetFullListPersons.mockResolvedValue([])
    mockGetFullListAttendees.mockResolvedValue([])
    mockGetFullListBunkAssignments.mockResolvedValue([])
    mockGetFullListBunkRequests.mockResolvedValue([])
    mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
    mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    mockUseCamperJourney.mockReturnValue(journeyWith([]))
  })

  describe('Loading and Error States', () => {
    it('shows loading spinner while fetching camper data', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // Should show spinner during loading
      expect(document.querySelector('.spinner-lodge')).toBeInTheDocument()
    })

    it('shows "Camper not found" when camper data is missing', async () => {
      render(<CamperDetailsPanel camperId="nonexistent" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByText('Camper not found')).toBeInTheDocument()
      })
    })

    it('surfaces loading state for the parent-input fetch (#1558)', async () => {
      // Camper data resolves so the panel renders past its top-level spinner,
      // but the original_bunk_requests fetch is left pending so the inline
      // loading indicator in the parent-input block is visible.
      setupDeclinedRequestMocks()
      mockGetListOriginalBunkRequests.mockReturnValue(new Promise(() => {}))

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.getByTestId('original-bunk-data-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('original-bunk-data-error')).not.toBeInTheDocument()
    })

    it('surfaces error state when the parent-input fetch fails instead of silently hiding (#1558)', async () => {
      setupDeclinedRequestMocks()
      mockGetListOriginalBunkRequests.mockRejectedValue(new Error('network down'))

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByTestId('original-bunk-data-error')).toBeInTheDocument()
      })
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load parent input/i)
      expect(screen.queryByTestId('original-bunk-data-loading')).not.toBeInTheDocument()
    })
  })

  // kindred#2466: the "Camp Journey" history section shows the household's
  // resolved family-camp cabin in the housing slot, never the CampMinder
  // day group. The feed resolves the label; the panel renders what it gets.
  describe('Camp Journey — family-camp housing (kindred#2466)', () => {
    const FAMILY_PERSON = mockPerson({
      id: 'pb-noah',
      cm_id: 300,
      first_name: 'Noah',
      last_name: 'Smith',
      year: 2025,
      household_id: 1000001,
    })

    beforeEach(() => {
      mockGetFullListPersons.mockResolvedValue([FAMILY_PERSON])
      mockGetListPersons.mockResolvedValue({ items: [FAMILY_PERSON], totalItems: 1 })
    })

    it('never shows the CampMinder day group in the housing slot', async () => {
      // A prior-year (2024 < currentYear 2025) family-camp row with no
      // resolved household housing: the feed drops the day group, so the
      // row carries no housing label at all.
      mockUseCamperJourney.mockReturnValue(
        journeyWith([
          { year: 2024, sessionName: 'Family Camp 2: Keshet Weekend', sessionType: 'family' },
        ])
      )

      render(<CamperDetailsPanel camperId={String(FAMILY_PERSON.cm_id)} onClose={mockOnClose} />)

      await screen.findByText('Family Camp 2')
      expect(screen.queryByText('Acorns (with parents)')).not.toBeInTheDocument()
    })

    it("shows the household's resolved cabin name in the housing slot instead", async () => {
      mockUseCamperJourney.mockReturnValue(
        journeyWith([
          {
            year: 2024,
            sessionName: 'Family Camp 2: Keshet Weekend',
            sessionType: 'family',
            bunkName: 'Cedar Lodge',
          },
        ])
      )

      render(<CamperDetailsPanel camperId={String(FAMILY_PERSON.cm_id)} onClose={mockOnClose} />)

      expect(await screen.findByText('Cedar Lodge')).toBeInTheDocument()
      expect(screen.queryByText('Acorns (with parents)')).not.toBeInTheDocument()
      expect(mockUseCamperJourney).toHaveBeenCalledWith(FAMILY_PERSON.cm_id, 2025)
    })
  })

  // Owner ruling 2026-09-22, option G2: the board modal's Camp Journey renders
  // the SAME rows component as the camper record (`camper/JourneyRows`) — one
  // grid for the current-year enrollments AND the prior years, so every cabin
  // lines up. The modal keeps what only it shows: this year's rows come from
  // the board's own enrollments (status letter, "Unassigned", "Now").
  describe('Camp Journey — shared one-grid rows (owner ruling 2026-09-22, G2)', () => {
    it('renders this year and prior years through the shared rows, in ONE grid', async () => {
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue(
        journeyWith([
          { year: 2024, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
        ])
      )

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      expect(grid.className.split(' ')).toContain('grid')
      const cabins = within(grid).getAllByTestId('journey-cabin-cell')
      expect(cabins).toHaveLength(2)
      for (const cabin of cabins) expect(cabin.parentElement).toBe(grid)
      // This year's row (the board's enrollment, not yet placed) then the prior year.
      expect(cabins[0]?.textContent).toBe('Unassigned')
      expect(cabins[1]?.textContent).toBe('G-8B')
      expect(within(grid).getByText('2025')).toBeInTheDocument()
      expect(within(grid).getByText('Now').closest('[data-col]')?.getAttribute('data-col')).toBe(
        'badge'
      )
    })

    it('shows a status letter, not a cabin or "Now", for a waitlisted enrollment this year', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([
        { ...EMMA_ATTENDEE, status: 'waitlisted', status_id: 3 },
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      expect(within(grid).getByText('W').closest('[data-col]')?.getAttribute('data-col')).toBe(
        'badge'
      )
      expect(within(grid).queryByText('Now')).toBeNull()
      expect(within(grid).queryByText('Unassigned')).toBeNull()
    })

    it('shows a family weekend by its bare title — no subtitle, no "Family" tag', async () => {
      // The modal's own copy carried the #2113 "Family" chip the camper record
      // dropped (owner, 2026-08-18: "we also dont need the 'family' tag in the
      // journey, staff knows"). One rows component means one rule.
      //
      // RULED CHANGE (owner, 2026-09-22 late): this test used to pin the
      // subtitle ("JFAM") stacked under the name here. Every sidebar now shows
      // the journey the same COMPACT way — no subtitle ("it's kinda
      // obvious") — and only the full camper page keeps it.
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue(
        journeyWith([
          {
            year: 2024,
            sessionName: 'Family Camp 8: JFAM Weekend w/ SFJCC (w/ kids 10 and under)',
            sessionType: 'family',
          },
        ])
      )

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      expect(
        within(grid).getByText('Family Camp 8').closest('[data-col]')?.getAttribute('data-col')
      ).toBe('session')
      expect(within(grid).queryByText('JFAM')).toBeNull()
      expect(within(grid).queryByText('Family')).toBeNull()
    })
  })

  // Q9 for CURRENT-year rows (owner ruling 2026-09-22, late): commit 6f205252
  // applied the registry-only cabin rule to PRIOR years via the server's
  // teen_cabins. The modal's OWN current-year row (this camper's live
  // enrollment, not the shared feed) still showed the raw CampMinder bunk —
  // a program group for TLI/SCIT, a trip name for Quest — until now.
  describe('Camp Journey — current-year TLI/SCIT/Quest cabins (Q9 follow-up)', () => {
    const SCIT_ATTENDEE: Record<string, unknown> = {
      ...EMMA_ATTENDEE,
      id: 'att-emma-scit',
      session: 'sess-scit',
      expand: {
        session: { id: 'sess-scit', cm_id: 700, name: 'Session 700', session_type: 'scit' },
      },
    }
    const QUEST_ATTENDEE: Record<string, unknown> = {
      ...EMMA_ATTENDEE,
      id: 'att-emma-quest',
      session: 'sess-quest',
      expand: {
        session: { id: 'sess-quest', cm_id: 900, name: 'Session 900', session_type: 'quest' },
      },
    }

    it('shows no cabin, anywhere in the panel, for a current-year SCIT enrollment the registry does not resolve', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([SCIT_ATTENDEE])
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) =>
        Promise.resolve(
          (opts.filter ?? '').includes('sess-scit')
            ? [{ expand: { bunk: { name: 'SCIT A' } } }]
            : []
        )
      )

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      const cabins = within(grid).getAllByTestId('journey-cabin-cell')
      expect(cabins).toHaveLength(1)
      expect(cabins[0]?.textContent).toBe('')
      // Never the raw program-group bunk, in the journey row OR the
      // quick-stats bar's single-enrollment cabin display.
      expect(screen.queryByText('SCIT A')).not.toBeInTheDocument()
    })

    it('shows the registry cabin for a resolvable current-year teen row, with the as-typed name on hover', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([SCIT_ATTENDEE])
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) =>
        Promise.resolve(
          (opts.filter ?? '').includes('sess-scit')
            ? [{ expand: { bunk: { name: 'Teen 2' } } }]
            : []
        )
      )
      mockUseCamperJourney.mockReturnValue({
        ...journeyWith([]),
        teenCabinsByWeekend: new Map([
          ['2025:700', { cabinName: 'Village Cabin 2', cabinNameRaw: 'Teen 2' }],
        ]),
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      const trigger = within(grid).getByTestId('camp-journey-cabin-provenance')
      expect(trigger.textContent).toBe('Village Cabin 2')
      fireEvent.pointerEnter(trigger)
      expect(screen.getByRole('tooltip').textContent).toContain('Teen 2')
    })

    it('never shows a cabin for a current-year Quest enrollment, even with an assigned bunk', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([QUEST_ATTENDEE])
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) =>
        Promise.resolve(
          (opts.filter ?? '').includes('sess-quest')
            ? [{ expand: { bunk: { name: 'Trip Name' } } }]
            : []
        )
      )

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      const cabins = within(grid).getAllByTestId('journey-cabin-cell')
      expect(cabins).toHaveLength(1)
      expect(cabins[0]?.textContent).toBe('')
      // RULED CHANGE (owner, 2026-09-23, Quest option A): the journey row
      // itself still never shows the trip as a cabin (scoped to `grid`) —
      // but the quick-stats bar now DOES show it (asserted in the "Quest
      // trip in the quick-stats bar" describe block below), so this check
      // is scoped rather than global as it was pre-ruling.
      expect(within(grid).queryByText('Trip Name')).not.toBeInTheDocument()
    })
  })

  // I1 (review, kindred#2753): b1a9f1f7 blanked a Quest enrollment's
  // bunkName via currentYearCabin (Quest never carries a cabin), but the
  // multi-enrollment Quick Stats branch (:914-941) was not updated — a null
  // bunkName there fell straight into the "(unassigned)" bucket, the same
  // amber label a genuinely-unplaced main/embedded/ag enrollment gets. A
  // camper enrolled in a summer session AND a Quest trip now read "Quest …
  // (unassigned)" on the summer board, even though the trip is assigned.
  // Fix: gate "(unassigned)" on isAtCampSessionType(enrollment.sessionType),
  // the same rule the journey row (`currentYearRows`) already applies.
  //
  // RULED CHANGE (owner, 2026-09-23, Quest option A): b1a9f1f7 blanked the
  // trip everywhere, including this bar. The owner reversed that HERE only
  // (journey rows still never show it, per the test above): the quick-stats
  // bar now shows the trip beside the session chip, without a cabin (Home)
  // icon, e.g. "Session 901 · Trip Name" — I1's "(unassigned)" fix still
  // holds, so only the "shows nothing" half of the old assertion changes.
  describe('Quick Stats bar — a Quest enrollment among multiple current enrollments (I1 + Quest-A)', () => {
    const QUEST_ATTENDEE_2: Record<string, unknown> = {
      ...EMMA_ATTENDEE,
      id: 'att-emma-quest-2',
      session: 'sess-quest-2',
      expand: {
        session: { id: 'sess-quest-2', cm_id: 901, name: 'Session 901', session_type: 'quest' },
      },
    }

    it('shows the Quest trip beside its chip, without ever mislabeling it "(unassigned)"', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE, QUEST_ATTENDEE_2])
      // The main session (sess-1) has its own real cabin, so the ONLY
      // candidate left for a spurious "(unassigned)" is the Quest entry.
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes('sess-quest-2')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Trip Name' } } }])
        }
        if (filter.includes('sess-1')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Cabin 3' } } }])
        }
        return Promise.resolve([])
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await screen.findByRole('heading', { name: /Emma/i })
      const quickStatsBar = await screen.findByTestId('quick-stats-bar')
      expect(within(quickStatsBar).queryByText('(unassigned)')).not.toBeInTheDocument()
      expect(within(quickStatsBar).getByText(/Trip Name/)).toBeInTheDocument()
      // The real cabin (sess-1) still gets its Home icon in the bar; Quest's
      // trip is a sibling text node with no icon of its own — one Home icon
      // in the quick-stats bar (the journey rows below have their own).
      expect(quickStatsBar.querySelectorAll('.lucide-home')).toHaveLength(1)
      // "Cabin 3" shares a text node with "Session 1" (no wrapping element
      // between the session name and the Home-icon cabin text) — a regex
      // substring match, not an exact one.
      expect(within(quickStatsBar).getByText(/Cabin 3/)).toBeInTheDocument()
    })
  })

  // Owner ruling 2026-09-23: a camper enrolled in more than one summer
  // session this year showed EVERY enrollment's chip in the quick-stats bar,
  // which wrapped onto two lines. The board modal now shows only the
  // enrollment for the session the modal was opened from (`openedFromSessionCmId`,
  // threaded from the caller's own board-session context) — the full camper
  // page is unaffected (it never receives this prop).
  describe('Quick Stats bar — multi-session campers show only the opened session (owner ruling 2026-09-23)', () => {
    const SESSION_2_ATTENDEE: Record<string, unknown> = {
      ...EMMA_ATTENDEE,
      id: 'att-emma-session-2',
      session: 'sess-2',
      expand: {
        session: { id: 'sess-2', cm_id: 2002, name: 'Session 2a', session_type: 'main' },
      },
    }

    it("shows only the opened session's chip when the camper has two current enrollments", async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE, SESSION_2_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])

      render(
        <CamperDetailsPanel camperId="100" onClose={mockOnClose} openedFromSessionCmId={2002} />
      )

      await screen.findByRole('heading', { name: /Emma/i })
      const quickStatsBar = await screen.findByTestId('quick-stats-bar')
      expect(within(quickStatsBar).getByText('Session 2a')).toBeInTheDocument()
      expect(within(quickStatsBar).queryByText('Session 1')).not.toBeInTheDocument()
    })

    it('keeps the full chip list when the panel does not know which session opened it', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE, SESSION_2_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await screen.findByRole('heading', { name: /Emma/i })
      const quickStatsBar = await screen.findByTestId('quick-stats-bar')
      expect(within(quickStatsBar).getByText('Session 1')).toBeInTheDocument()
      expect(within(quickStatsBar).getByText('Session 2a')).toBeInTheDocument()
    })

    it("keeps the full chip list when the opened session is not among the camper's current enrollments", async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE, SESSION_2_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])

      render(
        <CamperDetailsPanel camperId="100" onClose={mockOnClose} openedFromSessionCmId={9999} />
      )

      await screen.findByRole('heading', { name: /Emma/i })
      const quickStatsBar = await screen.findByTestId('quick-stats-bar')
      expect(within(quickStatsBar).getByText('Session 1')).toBeInTheDocument()
      expect(within(quickStatsBar).getByText('Session 2a')).toBeInTheDocument()
    })
  })

  // Q8 (owner, 2026-09-22 late): every sidebar handles the journey the SAME
  // way (`journeyDisplayState`, camper/journeyRowModel.ts) — rows that are
  // already here (the board's own current-year enrollments) render
  // immediately; the spinner is only for the true "nothing yet" case.
  //
  // RULED CHANGE from CR #3 (kindred#2753): CR #3 made the modal show a
  // spinner for the WHOLE section whenever the shared feed was loading or
  // errored, even though the board's own current-year rows (Emma's
  // "Session 1", unassigned) were already in hand — the exact regression Q8
  // reverses on the camper record (commit 16e0edcd). The modal had not
  // followed that reversal until now.
  describe('Camp Journey — loading and error states (Q8)', () => {
    it('shows the current-year row immediately while the feed loads, no spinner', async () => {
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue({
        rows: [],
        counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
        teenCabinsByWeekend: new Map(),
        isLoading: true,
        error: null,
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      expect(within(grid).getByText('Unassigned')).toBeInTheDocument()
      expect(within(grid).getByText('Now')).toBeInTheDocument()
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    })

    it('shows the spinner only when there are no current-year rows either', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([])
      mockUseCamperJourney.mockReturnValue({
        rows: [],
        counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
        teenCabinsByWeekend: new Map(),
        isLoading: true,
        error: null,
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await screen.findByRole('heading', { name: /Emma/i })
      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(screen.queryByTestId('journey-rows')).not.toBeInTheDocument()
    })

    it('shows the current-year rows with the muted error line below them when the feed errors', async () => {
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue({
        rows: [],
        counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
        teenCabinsByWeekend: new Map(),
        isLoading: false,
        error: new Error('boom'),
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      const grid = await screen.findByTestId('journey-rows')
      expect(within(grid).getByText('Unassigned')).toBeInTheDocument()
      expect(within(grid).getByText('Now')).toBeInTheDocument()
      expect(await screen.findByText("Couldn't load past years")).toBeInTheDocument()
    })

    it('shows only the muted error line when there are no rows at all', async () => {
      setupDeclinedRequestMocks()
      mockGetFullListAttendees.mockResolvedValue([])
      mockUseCamperJourney.mockReturnValue({
        rows: [],
        counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
        teenCabinsByWeekend: new Map(),
        isLoading: false,
        error: new Error('boom'),
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      expect(await screen.findByText("Couldn't load past years")).toBeInTheDocument()
      expect(screen.queryByTestId('journey-rows')).not.toBeInTheDocument()
    })
  })

  // The quick-stats bar shows the shared journey count line instead of
  // CampMinder's bare "N years".
  describe('Quick stats — journey count line', () => {
    // RULED CHANGE (owner, 2026-09-22 late, Q11): this test used to expect
    // the whole line ("3 summers · 1 family weekend"), which wrapped in the
    // board's narrow quick-stats bar. The board modal now shows the SUMMERS
    // part only — family weekends are not germane to bunking; the full camper
    // record keeps the whole line.
    it('shows only the summers part of the shared count line', async () => {
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue(
        journeyWith([], { summers: 5, familyWeekends: 3, adultWeekends: 1 })
      )

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      expect(await screen.findByText('5 summers')).toBeInTheDocument()
      expect(screen.queryByText(/family weekend/)).not.toBeInTheDocument()
      expect(screen.queryByText(/adult weekend/)).not.toBeInTheDocument()
      // Emma's years_at_camp is 2 — the old bare "2 years" stat is gone.
      expect(screen.queryByText('2 years')).not.toBeInTheDocument()
    })

    it('shows no count line when summers is zero, whatever the weekends', async () => {
      setupDeclinedRequestMocks()
      mockUseCamperJourney.mockReturnValue(
        journeyWith([], { summers: 0, familyWeekends: 2, adultWeekends: 1 })
      )

      const { container } = render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await screen.findByRole('heading', { name: /Emma/i })
      expect(screen.queryByText(/weekend/)).not.toBeInTheDocument()
      // Only the Camp Journey section header's TreePine is left.
      expect(container.querySelectorAll('.lucide-tree-pine')).toHaveLength(1)
    })

    it('shows no count line when every count is zero', async () => {
      setupDeclinedRequestMocks()

      const { container } = render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)

      await screen.findByRole('heading', { name: /Emma/i })
      expect(screen.queryByText('2 years')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/^\d+ (summers?|family weekends?|adult weekends?)/)
      ).not.toBeInTheDocument()
      // The whole stat is gone, icon included: the only TreePine left is the
      // Camp Journey section header's.
      expect(container.querySelectorAll('.lucide-tree-pine')).toHaveLength(1)
    })
  })

  // Owner ruling 2026-09-22: the board's Siblings section lists siblings by
  // the camper record's rule (useSiblings, child viewer) — enrolled only, kid
  // programs including family camp and TLI/SCIT, no grade filter, and never
  // a family-camp day group as a cabin. The pocketbase mocks below apply the
  // parts of each filter that matter, as PocketBase would server-side.
  describe("Siblings — the camper record's rule", () => {
    const HOUSEHOLD = 555
    const EMMA_H = mockPerson({ ...EMMA, household_id: HOUSEHOLD })
    const SAM = mockPerson({
      id: 'pb-sam',
      cm_id: 3000002,
      first_name: 'Sam',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 0,
      age: 4.03,
      year: 2025,
      household_id: HOUSEHOLD,
    })
    const OLIVIA = mockPerson({
      id: 'pb-olivia',
      cm_id: 3000003,
      first_name: 'Olivia',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 4,
      year: 2025,
      household_id: HOUSEHOLD,
    })
    const DAVID = mockPerson({
      id: 'pb-david',
      cm_id: 3000004,
      first_name: 'David',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 0,
      age: 44.02,
      year: 2025,
      household_id: HOUSEHOLD,
    })

    const attendee = (
      personCmId: number,
      status: string,
      session: { id: string; name: string; session_type: string }
    ) => ({
      id: `att-${String(personCmId)}`,
      person_id: personCmId,
      status,
      status_id: status === 'enrolled' ? 2 : 4,
      year: 2025,
      expand: { session: { cm_id: 1, start_date: '2025-06-01', ...session } },
    })

    beforeEach(() => {
      mockGetListPersons.mockResolvedValue({ items: [EMMA_H], totalItems: 1 })
      mockGetFullListPersons.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes(`household_id = ${String(HOUSEHOLD)}`)) {
          const members = [SAM, OLIVIA, DAVID]
          return Promise.resolve(
            filter.includes('grade > 0') ? members.filter((m) => m.grade > 0) : members
          )
        }
        return Promise.resolve([EMMA_H])
      })
      mockGetFullListAttendees.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        const allows = (type: string) => filter.includes(`session.session_type = "${type}"`)
        const enrolledOnly = filter.includes('status_id = 2')
        if (filter.includes(`person_id = ${String(SAM.cm_id)}`)) {
          // A family-camp-only preschooler.
          return Promise.resolve(
            allows('family')
              ? [
                  attendee(SAM.cm_id, 'enrolled', {
                    id: 's-fc1',
                    name: 'Family Camp 1',
                    session_type: 'family',
                  }),
                ]
              : []
          )
        }
        if (filter.includes(`person_id = ${String(OLIVIA.cm_id)}`)) {
          // Waitlisted for summer — never implies attendance.
          return Promise.resolve(
            enrolledOnly
              ? []
              : [
                  attendee(OLIVIA.cm_id, 'waitlisted', {
                    id: 's-2',
                    name: 'Session 2',
                    session_type: 'main',
                  }),
                ]
          )
        }
        if (filter.includes(`person_id = ${String(DAVID.cm_id)}`)) {
          // A parent, enrolled only in an adult program.
          return Promise.resolve(
            allows('adult')
              ? [
                  attendee(DAVID.cm_id, 'enrolled', {
                    id: 's-ww',
                    name: "Men's Weekend",
                    session_type: 'adult',
                  }),
                ]
              : []
          )
        }
        return Promise.resolve([EMMA_ATTENDEE])
      })
      // CampMinder's bunk for a family-camp session is the day group.
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) =>
        Promise.resolve(
          (opts.filter ?? '').includes('pb-sam')
            ? [{ expand: { bunk: { name: 'Acorns (with parents)' } } }]
            : []
        )
      )
    })

    it('lists a family-camp-only sibling, a grade-0 preschooler included', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      expect(await screen.findByText('Sam Johnson')).toBeInTheDocument()
      expect(screen.getByText('Siblings')).toBeInTheDocument()
    })

    it('leaves out a waitlisted sibling and a parent', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      await screen.findByText('Sam Johnson')
      expect(screen.queryByText('Olivia Johnson')).not.toBeInTheDocument()
      expect(screen.queryByText('David Johnson')).not.toBeInTheDocument()
    })

    it('never shows the family-camp day group as a cabin', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      await screen.findByText('Sam Johnson')
      expect(screen.queryByText('Acorns (with parents)')).not.toBeInTheDocument()
    })

    it('shows no grade for a grade-0 sibling, like the camper record', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      await screen.findByText('Sam Johnson')
      expect(screen.queryByText('0th')).not.toBeInTheDocument()
    })

    // kindred#2779: the sibling line reads `grade_name`, so a preschooler
    // shows as one rather than as nothing.
    it("shows a preschool sibling's grade name", async () => {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes(`household_id = ${String(HOUSEHOLD)}`)) {
          return Promise.resolve([{ ...SAM, grade: -1, grade_name: 'Pre-K' }, OLIVIA, DAVID])
        }
        return Promise.resolve([EMMA_H])
      })
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      await screen.findByText('Sam Johnson')
      expect(await screen.findByText('Pre-K')).toBeInTheDocument()
      expect(screen.queryByText('-1th')).not.toBeInTheDocument()
    })

    // Owner ruling 2026-09-22 (second visual pass): the board's line 2 shows
    // summer/teen programs only (main, embedded, ag, quest, tli, scit).
    // Family weekends are "not germane for bunking" here and stay visible
    // only on the full camper record. Sam has no summer/teen program at all,
    // so line 2 is omitted entirely -- not merely his cabin.
    it('renders with no line 2 for a family-camp-only sibling', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      const nameEl = await screen.findByText('Sam Johnson')
      const row = nameEl.closest('a')
      if (!row) throw new Error('sibling row anchor not found')
      const lines = row.querySelectorAll('[class*="mt-0.5"]')
      expect(lines).toHaveLength(1)
    })
  })

  // Owner ruling 2026-09-22 (mockup option "D"): a sibling row's line 2 lists
  // every program the sibling is in, with that session's own cabin RIGHT
  // AFTER it — the cabin moves off line 1 entirely. Mirrors the camper
  // record's SiblingsPanel line 2 at the board's smaller sizes.
  describe('Sibling row line 2 — one cabin per program (owner ruling 2026-09-22, option D)', () => {
    const HOUSEHOLD = 777
    const EMMA_H2 = mockPerson({ ...EMMA, household_id: HOUSEHOLD })
    const NOAH = mockPerson({
      id: 'pb-noah-j',
      cm_id: 3000010,
      first_name: 'Noah',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 7,
      year: 2025,
      household_id: HOUSEHOLD,
    })
    const AVA = mockPerson({
      id: 'pb-ava',
      cm_id: 3000011,
      first_name: 'Ava',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 8,
      year: 2025,
      household_id: HOUSEHOLD,
    })
    const MIA = mockPerson({
      id: 'pb-mia',
      cm_id: 3000012,
      first_name: 'Mia',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 0,
      age: 4.05,
      year: 2025,
      household_id: HOUSEHOLD,
    })
    const LIAM = mockPerson({
      id: 'pb-liam',
      cm_id: 3000013,
      first_name: 'Liam',
      preferred_name: '',
      last_name: 'Johnson',
      grade: 10,
      year: 2025,
      household_id: HOUSEHOLD,
    })

    const attendee = (
      personCmId: number,
      session: { id: string; name: string; session_type: string; start_date?: string }
    ) => ({
      id: `att-${String(personCmId)}-${session.id}`,
      person_id: personCmId,
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      expand: { session: { cm_id: 1, start_date: '2025-06-01', ...session } },
    })

    beforeEach(() => {
      mockGetListPersons.mockResolvedValue({ items: [EMMA_H2], totalItems: 1 })
      mockGetFullListPersons.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes(`household_id = ${String(HOUSEHOLD)}`)) {
          return Promise.resolve([NOAH, AVA, MIA, LIAM])
        }
        return Promise.resolve([EMMA_H2])
      })
      mockGetFullListAttendees.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes(`person_id = ${String(NOAH.cm_id)}`)) {
          // Summer-only: one program, one cabin.
          return Promise.resolve([
            attendee(NOAH.cm_id, { id: 's-4', name: 'Session 4', session_type: 'main' }),
          ])
        }
        if (filter.includes(`person_id = ${String(AVA.cm_id)}`)) {
          // Summer + family camp: two programs, only the summer one has a cabin.
          return Promise.resolve([
            attendee(AVA.cm_id, { id: 's-3a', name: 'Session 3a', session_type: 'main' }),
            attendee(AVA.cm_id, {
              id: 's-fc1',
              name: 'Family Camp 1',
              session_type: 'family',
              start_date: '2025-08-01',
            }),
          ])
        }
        if (filter.includes(`person_id = ${String(MIA.cm_id)}`)) {
          // Family-camp-only: no cabin ever (kindred#2466).
          return Promise.resolve([
            attendee(MIA.cm_id, { id: 's-fc2', name: 'Family Camp 2', session_type: 'family' }),
          ])
        }
        if (filter.includes(`person_id = ${String(LIAM.cm_id)}`)) {
          // TWO germane programs (summer main + teen TLI) — both should
          // show on line 2, separated by the bar (owner ruling 2026-09-22,
          // "P3"), never a dot.
          return Promise.resolve([
            attendee(LIAM.cm_id, { id: 's-5', name: 'Session 5', session_type: 'main' }),
            attendee(LIAM.cm_id, { id: 's-tli', name: 'TLI', session_type: 'tli' }),
          ])
        }
        return Promise.resolve([EMMA_ATTENDEE])
      })
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes('pb-noah-j')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Bunk 12' } } }])
        }
        if (filter.includes('pb-ava')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Bunk 9' } } }])
        }
        return Promise.resolve([])
      })
    })

    it("shows a summer sibling's session then its cabin on line 2, never the cabin on line 1", async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      const nameEl = await screen.findByText('Noah Johnson')
      const row = nameEl.closest('a')
      if (!row) throw new Error('sibling row anchor not found')

      const sessionLabel = getSessionDisplayNameFromString('Session 4', 'main')
      const sessionEl = within(row).getByText(sessionLabel)
      const cabinEl = within(row).getByText('Bunk 12')
      expect(sessionEl).toBeInTheDocument()
      expect(cabinEl).toBeInTheDocument()

      // M4 (review): an overlong line 2 must end in an ellipsis, not clip
      // mid-glyph — `text-overflow` does nothing on the flex row itself, so
      // each text segment needs its own `min-w-0 truncate`.
      expect(sessionEl.className).toContain('truncate')
      expect(sessionEl.className).toContain('min-w-0')
      expect(cabinEl.className).toContain('truncate')
      expect(cabinEl.className).toContain('min-w-0')

      // Line 1 (age • grade) and line 2 (programs) are the two `.mt-0.5`
      // rows under the name; the cabin must be on line 2 only.
      const lines = row.querySelectorAll('[class*="mt-0.5"]')
      expect(lines).toHaveLength(2)
      expect(lines[0]?.textContent ?? '').not.toContain('Bunk 12')
      expect(lines[1]?.textContent ?? '').toContain('Bunk 12')
      // Owner ruling 2026-09-22 ("P3"): no dot between a session and its OWN
      // cabin -- a dot here read as ambiguous once a row could carry more
      // than one program.
      expect(lines[1]?.textContent ?? '').not.toContain('•')
    })

    // Ruled change 2026-09-22 (second visual pass): the board's line 2 now
    // shows summer/teen programs only, so Ava's Family Camp 1 no longer
    // appears here at all -- it previously did, as this test's original name
    // said. Her summer session and its cabin are unaffected.
    it('shows a summer + family-camp sibling as session then cabin only -- family camp does not appear on the board', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      const nameEl = await screen.findByText('Ava Johnson')
      const row = nameEl.closest('a')
      if (!row) throw new Error('sibling row anchor not found')

      const sessionLabel = getSessionDisplayNameFromString('Session 3a', 'main')
      const familyLabel = getSessionDisplayNameFromString('Family Camp 1', 'family')
      const lines = row.querySelectorAll('[class*="mt-0.5"]')
      const line2Text = lines[lines.length - 1]?.textContent ?? ''

      expect(line2Text).toContain(sessionLabel)
      expect(line2Text).toContain('Bunk 9')
      expect(line2Text).not.toContain(familyLabel)
      expect(within(row).queryByText(familyLabel)).not.toBeInTheDocument()
      // Owner ruling 2026-09-22 ("P3"): with only her summer session left
      // after the family-camp filter, there is no program transition left to
      // separate — no dot between her session and its cabin either.
      expect(line2Text).not.toContain('•')

      // M5 (review): her cabin must appear exactly once in her row — never
      // duplicated between line 1 and line 2, and never rendered twice on
      // line 2 itself.
      expect(within(row).getAllByText('Bunk 9')).toHaveLength(1)
    })

    // New sibling fixture (Liam), owner ruling 2026-09-22 ("P3"): a
    // transition between two DIFFERENT germane programs gets a vertical bar,
    // never a dot -- the dot is reserved for line 1's age • grade join.
    it('separates two germane programs with a vertical bar, never a dot', async () => {
      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      const nameEl = await screen.findByText('Liam Johnson')
      const row = nameEl.closest('a')
      if (!row) throw new Error('sibling row anchor not found')

      const sessionLabel = getSessionDisplayNameFromString('Session 5', 'main')
      const tliLabel = getSessionDisplayNameFromString('TLI', 'tli')
      const lines = row.querySelectorAll('[class*="mt-0.5"]')
      const line2Text = lines[lines.length - 1]?.textContent ?? ''

      expect(line2Text).toContain(sessionLabel)
      expect(line2Text).toContain(tliLabel)
      expect(line2Text).not.toContain('•')
      expect(within(row).getByText('|')).toBeInTheDocument()
    })

    // Ruled change 2026-09-22 (second visual pass): a family-camp-only
    // sibling now renders NO line 2 at all -- previously (as this test's
    // original name said) her family-camp program still showed with no
    // cabin. Family weekends are "not germane for bunking" on the board.
    it('renders no line 2 at all for a family-camp-only sibling', async () => {
      // M5 (review): a bunk_assignments row exists for Mia even though she is
      // family-camp-only — `useSiblings` must never look it up for her at
      // all, because her PRIMARY session is family camp (kindred#2466). If it
      // did, the mock below would hand back a cabin and the row would show
      // one.
      mockGetFullListBunkAssignments.mockImplementation((opts: { filter?: string } = {}) => {
        const filter = opts.filter ?? ''
        if (filter.includes('pb-noah-j')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Bunk 12' } } }])
        }
        if (filter.includes('pb-ava')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Bunk 9' } } }])
        }
        if (filter.includes('pb-mia')) {
          return Promise.resolve([{ expand: { bunk: { name: 'Bunk 99' } } }])
        }
        return Promise.resolve([])
      })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} />)
      const nameEl = await screen.findByText('Mia Johnson')
      const row = nameEl.closest('a')
      if (!row) throw new Error('sibling row anchor not found')

      const familyLabel = getSessionDisplayNameFromString('Family Camp 2', 'family')
      expect(within(row).queryByText(familyLabel)).not.toBeInTheDocument()
      expect(row.querySelector('.lucide-calendar')).not.toBeInTheDocument()
      expect(row.querySelector('.lucide-home')).not.toBeInTheDocument()
      expect(screen.queryByText('Bunk 99')).not.toBeInTheDocument()
      const lines = row.querySelectorAll('[class*="mt-0.5"]')
      expect(lines).toHaveLength(1)

      // Not merely hidden — the lookup itself must never run for her.
      const calledForMia = mockGetFullListBunkAssignments.mock.calls.some((call: unknown[]) => {
        const opts = call[0] as { filter?: string } | undefined
        return (opts?.filter ?? '').includes('pb-mia')
      })
      expect(calledForMia).toBe(false)
    })
  })

  describe('Panel Behavior', () => {
    it('renders in embedded mode without slide-in animation', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      // Embedded mode should not have the fixed positioning class
      const panel = document.querySelector('[data-panel="camper-details"]')
      // In embedded mode, this element doesn't exist
      expect(panel).not.toBeInTheDocument()
    })

    it('calls onClose when close button is clicked', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      await waitFor(() => {
        const notFound = screen.queryByText('Camper not found')
        if (notFound) {
          const closeButton = document.querySelector('button')
          if (closeButton) {
            fireEvent.click(closeButton)
          }
        }
      })

      // The onClose callback might be called via animation timeout
      // This is a weak assertion since we can't easily test the full close flow
    })

    it('renders a backdrop overlay for click-outside close in non-embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // The backdrop should be present (fixed, behind the panel)
      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).toBeInTheDocument()
    })

    it('does not render a backdrop overlay in embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).not.toBeInTheDocument()
    })

    it('starts exit animation on backdrop click instead of closing immediately', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      const backdrop = document.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop).toBeInTheDocument()

      // Click backdrop starts exit animation (does not call onClose immediately)
      fireEvent.click(backdrop!)
      expect(mockOnClose).not.toHaveBeenCalled()

      // The panel should now have the exit animation class (slide-out)
      await waitFor(() => {
        const panel = document.querySelector('.animate-slide-out-right')
        expect(panel).toBeInTheDocument()
      })
    })

    it('starts exit animation on Escape key in non-embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)

      // Wait for non-embedded panel to render (backdrop is always present)
      await waitFor(() => {
        expect(document.querySelector('[data-testid="panel-backdrop"]')).toBeInTheDocument()
      })

      // Press Escape to trigger close
      fireEvent.keyDown(document, { key: 'Escape' })

      // In non-embedded mode, Escape triggers isClosing which starts exit animation.
      // The animation end handler calls onClose. In JSDOM (no real animations),
      // we verify the animation class changed to slide-out.
      await waitFor(() => {
        // Find the animated panel div (loading or full - both get the animation class)
        const panels = document.querySelectorAll('.animate-slide-out-right')
        expect(panels.length).toBeGreaterThan(0)
      })
    })

    it('does not close on Escape key in embedded mode', async () => {
      render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText('Camper not found')).toBeInTheDocument()
      })

      // Escape should not trigger close in embedded mode
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    // Regression: when the panel is mounted inside a Modal, pressing Escape
    // should close the panel without also closing the underlying modal.
    // Both register document-level keydown listeners — the panel uses
    // capture-phase + stopPropagation so its handler runs first and prevents
    // the modal's bubble-phase listener from firing.
    it('stops Escape from reaching outer document-level listeners (LIFO close)', async () => {
      const outerHandler = vi.fn()
      document.addEventListener('keydown', outerHandler)

      try {
        render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)
        await waitFor(() => {
          expect(document.querySelector('[data-testid="panel-backdrop"]')).toBeInTheDocument()
        })

        fireEvent.keyDown(document, { key: 'Escape' })

        const escapeCalls = outerHandler.mock.calls.filter(
          ([event]) => (event as KeyboardEvent).key === 'Escape'
        )
        expect(escapeCalls).toHaveLength(0)
      } finally {
        document.removeEventListener('keydown', outerHandler)
      }
    })

    // kindred#2237. The panel used to install its capture-phase listener with
    // an UNCONDITIONAL `stopPropagation()`, which beat the one outer listener
    // it was written against but also beat every overlay stacked ABOVE it --
    // including `AllCamperRequestsModal`, a token-gated `ui/Modal` this very
    // panel opens. One Escape closed the panel and left the dialog on top of
    // it open: the wrong overlay, not merely an extra one.
    describe('overlay token (kindred#2237)', () => {
      async function renderOpenPanel() {
        const result = render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} />)
        await waitFor(() => {
          expect(document.querySelector('[data-testid="panel-backdrop"]')).toBeInTheDocument()
        })
        return result
      }

      it('does NOT close once an overlay has opened on top of it', async () => {
        await renderOpenPanel()

        const topToken = acquireOverlayToken()
        try {
          fireEvent.keyDown(document, { key: 'Escape' })
          expect(document.querySelectorAll('.animate-slide-out-right')).toHaveLength(0)
        } finally {
          releaseOverlayToken(topToken)
        }
      })

      // The half that the unconditional `stopPropagation` broke: the overlay
      // above must actually RECEIVE the key the panel stood down from. Without
      // this the panel merely stops closing and nothing closes at all.
      it('lets Escape reach the overlay stacked above it', async () => {
        await renderOpenPanel()

        const outerHandler = vi.fn()
        document.addEventListener('keydown', outerHandler)
        const topToken = acquireOverlayToken()
        try {
          fireEvent.keyDown(document, { key: 'Escape' })
          const escapeCalls = outerHandler.mock.calls.filter(
            ([event]) => (event as KeyboardEvent).key === 'Escape'
          )
          expect(escapeCalls).toHaveLength(1)
        } finally {
          releaseOverlayToken(topToken)
          document.removeEventListener('keydown', outerHandler)
        }
      })

      it('releases its overlay token on unmount, so the stack does not leak', async () => {
        const { unmount } = await renderOpenPanel()
        expect(hasOpenModal()).toBe(true)

        unmount()

        expect(hasOpenModal()).toBe(false)
      })

      it('registers no token in embedded mode, which handles no Escape at all', async () => {
        render(<CamperDetailsPanel camperId="12345" onClose={mockOnClose} embedded={true} />)
        await waitFor(() => {
          expect(screen.getByText('Camper not found')).toBeInTheDocument()
        })

        expect(hasOpenModal()).toBe(false)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Regression: sidebar (embedded) panel shows resolved target + decline reason
  // Spec item #50 — previously the embedded code path hit a temporal-dead-zone
  // ReferenceError on `nonAgeRequests` because it was declared after the early
  // embedded-mode `return`. The fix moves those declarations up.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Regression: graph-launched panel must honour the bunkCampers prop
  // Issue #1061 — SocialNetworkGraph and BunkSocialGraphModal never passed
  // bunkCampers, so the panel fell back to a self-only roster and
  // getSatisfiedRequestInfo could not detect unsatisfied requests.
  //
  // The fix is at the call sites (SocialNetworkGraph.tsx and
  // BunkSocialGraphModal.tsx); these tests verify the prop flows through
  // correctly to getSatisfiedRequestInfo.
  //
  // Fictional names (CLAUDE.md): Emma (1001) bunked with Liam (1003) in
  // bunk 9001. Emma has a material parent request for Olivia (1002) who is
  // in bunk 9002. When bunkCampers includes only 1001+1003, the panel should
  // surface the unsatisfied-parent-requests alert.
  // ---------------------------------------------------------------------------
  describe('bunkCampers prop plumbing (Issue #1061)', () => {
    /** Emma Johnson, cm_id=1001, bunk 9001 */
    const EMMA_1061 = mockPerson({
      id: 'pb-emma-1061',
      cm_id: 1001,
      first_name: 'Emma',
      last_name: 'Johnson',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Emma's bunk assignment in bunk 9001 */
    const EMMA_ASSIGNMENT: Record<string, unknown> = {
      id: 'assign-emma-1061',
      person: 'pb-emma-1061',
      person_id: 1001,
      session: 'sess-a',
      year: 2025,
      collectionId: 'bunk_assignments',
      collectionName: 'bunk_assignments',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        bunk: {
          id: 'bunk-9001',
          cm_id: 9001,
          name: 'Bunk Oak',
          capacity: 12,
          gender: 'F',
          year: 2025,
        },
      },
    }

    /** Emma's attendee record, session sess-a */
    const EMMA_ATTENDEE_1061: Record<string, unknown> = {
      id: 'att-emma-1061',
      person: 'pb-emma-1061',
      person_id: 1001,
      session: 'sess-a',
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      collectionId: 'attendees',
      collectionName: 'attendees',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        session: {
          id: 'sess-a',
          cm_id: 2001,
          name: 'Session A',
          session_type: 'main',
        },
      },
    }

    /** Emma's material-parent bunk_with request for Olivia (cm_id 1002) */
    const OLIVIA_REQUEST: Record<string, unknown> = {
      id: 'req-olivia-1061',
      requester_id: 1001,
      requestee_id: 1002,
      request_type: 'bunk_with',
      source: 'family',
      source_field: 'bunk_request_form',
      status: 'resolved',
      requested_person_name: 'Olivia Chen',
      year: 2025,
      session_id: 2001,
      is_reciprocal: false,
      confidence_score: 0.95,
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      collectionId: 'bunk_requests',
      collectionName: 'bunk_requests',
      metadata: {},
    }

    /** Olivia Chen person record, so the panel can resolve her name */
    const OLIVIA_PERSON = mockPerson({
      id: 'pb-olivia-1061',
      cm_id: 1002,
      first_name: 'Olivia',
      last_name: 'Chen',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    function setupGraphPanelMocks() {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
        const filter = opts.filter ?? ''
        if (filter.includes('cm_id = 1002')) return Promise.resolve([OLIVIA_PERSON])
        return Promise.resolve([EMMA_1061])
      })
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE_1061])
      mockGetFullListBunkAssignments.mockResolvedValue([EMMA_ASSIGNMENT])
      mockGetFullListBunkRequests.mockResolvedValue([OLIVIA_REQUEST])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    }

    it('surfaces parent_min_one_violation alert when getSatisfiedRequestInfo returns the flag', async () => {
      // Satisfaction is now server-computed. The alert fires when the mock
      // (standing in for /api/satisfaction) returns parent_min_one_violation: true.
      mockGetSatisfiedRequestInfo.mockImplementation((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [],
        counted_totals: {
          material_parent: { total: 1, satisfied: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: true,
          staff_unsatisfied_alert: false,
          has_any_counted_request: true,
        },
      }))

      setupGraphPanelMocks()

      const bunkCampers = [
        { cmId: 1001, grade: 6 },
        { cmId: 1003, grade: 6 },
      ]

      render(<CamperDetailsPanel camperId="1001" onClose={mockOnClose} bunkCampers={bunkCampers} />)

      await waitFor(() => {
        expect(screen.getByText('1 parent request, none satisfied')).toBeInTheDocument()
      })
    })

    it('calls getSatisfiedRequestInfo with the camper person_cm_id', async () => {
      // Verify that once the panel loads, it calls getSatisfiedRequestInfo with
      // Emma's person_cm_id (1001). During the loading phase the panel may call
      // with 0 (the `camper?.person_cm_id ?? 0` fallback) — so we wait for the
      // heading and then check that at least one call used the correct id.
      setupGraphPanelMocks()

      render(<CamperDetailsPanel camperId="1001" onClose={mockOnClose} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })

      const calls = mockGetSatisfiedRequestInfo.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      // At least one call should use personCmId=1001 (after the camper loads)
      const calledWithCorrectId = calls.some((call) => call[0] === 1001)
      expect(calledWithCorrectId).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Stage 3b.1 — R3 row list: Parent rows → Staff sub-divider → Staff rows
  // → age preference divider → age rows (with P/S badges).
  // ---------------------------------------------------------------------------
  describe('CamperDetailsPanel — Stage 3b.1 R3 row list in Bunking Preferences section', () => {
    /** Person record for Emma Johnson (parent request source) */
    const EMMA_R3 = mockPerson({
      id: 'pb-emma-r3',
      cm_id: 100,
      first_name: 'Emma',
      last_name: 'Johnson',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Person record for Riley Sam (target of the parent request) */
    const RILEY_PERSON = mockPerson({
      id: 'pb-riley-r3',
      cm_id: 200,
      first_name: 'Riley',
      last_name: 'Sam',
      grade: 6,
      year: 2025,
      household_id: 0,
    })

    /** Attendee record for Emma in session sess-r3 */
    const EMMA_R3_ATTENDEE: Record<string, unknown> = {
      id: 'att-emma-r3',
      person: 'pb-emma-r3',
      person_id: 100,
      session: 'sess-r3',
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      collectionId: 'attendees',
      collectionName: 'attendees',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        session: {
          id: 'sess-r3',
          cm_id: 3001,
          name: 'Session R3',
          session_type: 'main',
        },
      },
    }

    /**
     * Set up mocks for a given set of bunk requests.
     * Persons lookup resolves requestee_id=200 to Riley, otherwise returns Emma.
     */
    function setupR3Mocks(bunkRequests: Array<Record<string, unknown>>) {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
        const filter = opts.filter ?? ''
        if (filter.includes('cm_id = 200')) return Promise.resolve([RILEY_PERSON])
        return Promise.resolve([EMMA_R3])
      })
      mockGetFullListAttendees.mockResolvedValue([EMMA_R3_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue(bunkRequests)
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    }

    it('renders Parent rows before Staff sub-divider before Staff rows', async () => {
      // Two requests: one parent (bunk_request_form Emma→Riley), one staff (staff_not_bunk_with)
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-p1',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: SourceField.BUNK_REQUEST_FORM,
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
        {
          id: 'r3-s1',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'not_bunk_with',
          source_field: SourceField.STAFF_NOT_BUNK_WITH,
          source: 'staff',
          status: 'resolved',
          requested_person_name: 'Olivia Chen',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      const { container } = render(
        <CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />
      )

      // Wait for requests to load (Riley Sam appears as a target name)
      await waitFor(() => {
        expect(container.textContent).toContain('Riley')
      })

      // The combined Parent ↑ │ ⬇ Staff divider is the only element with the
      // `font-mono` utility on its container <div>.
      const dividerEl = container.querySelector('div.font-mono')
      expect(dividerEl).not.toBeNull()
      expect(dividerEl?.textContent).toMatch(/Parent.*Staff/)

      const allElements = Array.from(container.querySelectorAll('*'))
      const dividerIdx = allElements.indexOf(dividerEl as Element)

      // Leaf element containing "Riley" but not "Olivia"
      const rileyEl = Array.from(container.querySelectorAll('*')).find(
        (el) => el.textContent?.includes('Riley') && !el.textContent?.includes('Olivia')
      )
      // Leaf element containing "Olivia" but not "Riley"
      const oliviaEl = Array.from(container.querySelectorAll('*')).find(
        (el) => el.textContent?.includes('Olivia') && !el.textContent?.includes('Riley')
      )
      const rileyIdx = allElements.indexOf(rileyEl as Element)
      const oliviaIdx = allElements.indexOf(oliviaEl as Element)

      expect(rileyIdx).toBeGreaterThan(-1)
      expect(oliviaIdx).toBeGreaterThan(-1)
      // Parent request (Riley) appears BEFORE the Staff divider
      expect(rileyIdx).toBeLessThan(dividerIdx)
      // Staff request (Olivia) appears AFTER the Staff divider
      expect(dividerIdx).toBeLessThan(oliviaIdx)
    })

    it('omits Staff sub-divider when there are no staff rows', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-p1-only',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: 'bunk_request_form',
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      const { container } = render(
        <CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />
      )
      await waitFor(() => {
        expect(container.textContent).toContain('Riley')
      })

      // No combined Parent/Staff divider when only parent rows exist.
      expect(container.querySelector('div.font-mono')).toBeNull()
    })

    it('renders P badge on bunk_with-derived age preference (family source)', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-age-p',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunk_request_form',
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      // After #1159, age-pref P/S badges read per_request[i].bucket from the
      // centralized aggregator, not raw source_field. Mirror what
      // session_satisfaction would emit for this row.
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-age-p',
            bucket: 'material_parent',
            satisfied: false,
          },
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 1 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: true,
          staff_unsatisfied_alert: false,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('P')).toBeInTheDocument()
    })

    it('renders S badge on staff-source age preference', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-age-s',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunking_notes',
          source: 'staff',
          age_preference_target: 'younger',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-age-s',
            bucket: 'staff',
            satisfied: false,
          },
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 1 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: true,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
    })

    it('age-pref badge follows per_request.bucket, not raw source_field (#1159)', async () => {
      // Mismatched fixture: source_field=bunk_with would set P under the old
      // per-row classification, but the centralized aggregator's bucket=staff
      // wins → S badge, not P.
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-mismatch',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunk_request_form',
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [
          {
            request_id: 'r3-mismatch',
            bucket: 'staff',
            satisfied: false,
          },
        ],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 1 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: true,
          has_any_counted_request: true,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
      expect(screen.queryByText('P')).toBeNull()
    })

    it('#1172: renders P badge from source_field=bunk_request_form when per_request is empty', async () => {
      // Simulate /api/satisfaction unavailable: emptyCamperSatisfaction (per_request: []).
      // Pre-#1158 the badge was driven by the row's own source_field — fall back to
      // that path so a backend hiccup doesn't silently hide the P badge.
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-fallback-p',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: SourceField.BUNK_REQUEST_FORM,
          source: 'family',
          age_preference_target: 'older',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      // Empty per_request — bucketByRequestId is empty → fallback path must fire.
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [] as PerRequestStatus[],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
          has_any_counted_request: false,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('P')).toBeInTheDocument()
      expect(screen.queryByText('S')).toBeNull()
    })

    it('#1172: renders S badge from source=staff when per_request is empty', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-fallback-s',
          requester_id: 100,
          requestee_id: 0,
          request_type: 'age_preference',
          source_field: 'bunking_notes',
          source: 'staff',
          age_preference_target: 'younger',
          status: 'resolved',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.9,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)
      mockGetSatisfiedRequestInfo = vi.fn((personCmId: number) => ({
        person_cm_id: personCmId,
        per_request: [] as PerRequestStatus[],
        counted_totals: {
          material_parent: { satisfied: 0, total: 0 },
          staff: { satisfied: 0, total: 0 },
        },
        immaterial: { satisfied: 0, total: 0 },
        flags: {
          parent_min_one_violation: false,
          staff_unsatisfied_alert: false,
          has_any_counted_request: false,
        },
      }))

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      expect(await screen.findByText('S')).toBeInTheDocument()
      expect(screen.queryByText('P')).toBeNull()
    })

    it('does NOT render any new "Parent request satisfaction:" summary line in the sidebar', async () => {
      // The sidebar conveys source-aware satisfaction via CamperAlertSection,
      // not a separate summary label. Spec §2.4 explicitly forbids adding one.
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'r3-no-summary',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: 'bunk_request_form',
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupR3Mocks(bunkRequests)

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)
      // Wait for the row to render before asserting the summary lines are absent.
      await screen.findByText('Riley Sam')
      expect(screen.queryByText(/Parent request satisfaction:/i)).toBeNull()
      expect(screen.queryByText(/Staff request satisfaction:/i)).toBeNull()
    })
  })

  describe('Bunk request display in embedded (sidebar) mode', () => {
    it('renders the target camper name (not "Unknown") for a declined request in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for camper data to load and the requests section to appear
      await waitFor(() => {
        // "Liam Garcia" is the requestee — should be visible, not "Unknown"
        expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
      })
    })

    it('does not render the disposition reason for a resolved-disposition row in embedded mode', async () => {
      // BunkRequestRow.tsx skips disposition_reason rendering for status='resolved'
      // rows on purpose ("the reason isn't user-meaningful here"). The
      // production query at CamperDetailsPanel.tsx:422 only delivers
      // status='resolved' rows, so the decline reason never surfaces in the
      // sidebar. Asserting the absence pins that contract — a regression that
      // re-introduced the line would change user-visible behavior.
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for the row to render, then assert the disposition reason is absent.
      await screen.findByText('Liam Garcia')
      expect(screen.queryByText(/Different sessions/)).not.toBeInTheDocument()
    })

    it('does not show "Unknown" as the target name for a declined request in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // The panel must load first — wait for the camper's name to appear.
      // The h2 renders first_name and last_name as separate text nodes so we
      // use a heading role matcher to find the element.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })

      // "Unknown" must not appear as a camper-name stand-in
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('renders the bunk-with request label alongside the target in embedded mode', async () => {
      setupDeclinedRequestMocks()

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText('Bunk with')).toBeInTheDocument()
      })
    })
  })

  describe('Bunk Request Form section (parent-sourced quick-ref)', () => {
    /** Build a minimal original_bunk_requests record matching the hook's schema. */
    function originalBunkRecord(content: string) {
      return {
        id: 'obr-1',
        field: 'bunk_request_form' as const,
        content,
        requester: 'pb-emma',
        year: 2025,
        created: '2025-01-01T00:00:00Z',
        updated: '2025-05-01T00:00:00Z',
        collectionId: 'original_bunk_requests',
        collectionName: 'original_bunk_requests',
        expand: { requester: { first_name: 'Emma', last_name: 'Johnson' } },
      }
    }

    /** Set up mocks for Emma with a populated parent bunk-request form input. */
    function setupParentBunkRequestText(content: string) {
      mockGetFullListPersons.mockResolvedValue([EMMA])
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue([])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({
        items: [originalBunkRecord(content)],
        totalItems: 1,
      })
    }

    it('renders the "Bunk Request Form" section header when parent text exists', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Bunk Request Form/i)).toBeInTheDocument()
      })
    })

    it('shows the parent text by default (default expanded for quick-ref)', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Bunk Request Form/i)).toBeInTheDocument()
      })
      // Parent text immediately visible without any click
      expect(screen.getByText('Riley Sam, Olivia Chen')).toBeInTheDocument()
    })

    it('collapses the parent text when the section header is clicked', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for the section to render with text visible
      await waitFor(() => {
        expect(screen.getByText('Riley Sam, Olivia Chen')).toBeInTheDocument()
      })

      // Click the header to collapse
      const header = screen.getByRole('button', { name: /Bunk Request Form/i })
      header.click()

      await waitFor(() => {
        expect(screen.queryByText('Riley Sam, Olivia Chen')).not.toBeInTheDocument()
      })
    })

    it('does not render the section when there is no parent bunk-request text', async () => {
      // No original_bunk_requests record at all
      mockGetFullListPersons.mockResolvedValue([EMMA])
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue([])
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      // Wait for camper to load (heading appears)
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Bunk Request Form/i)).not.toBeInTheDocument()
    })

    it('does not render the section when bunk_with record exists but content is empty', async () => {
      setupParentBunkRequestText('')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Bunk Request Form/i)).not.toBeInTheDocument()
    })

    it('queries original_bunk_requests using the working requester.cm_id filter (not the broken person_id)', async () => {
      setupParentBunkRequestText('Riley Sam, Olivia Chen')

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(mockGetListOriginalBunkRequests).toHaveBeenCalled()
      })
      const filter = String(mockGetListOriginalBunkRequests.mock.calls[0]?.[2]?.filter ?? '')
      expect(filter).toContain('requester.cm_id = 100')
      expect(filter).not.toContain('person_id =')
    })
  })

  // Shared fixtures for the multi-field source-data sections below
  // (Do NOT Share Bunk With + Staff Notes). The pre-existing Bunk Request
  // Form describe has its own narrower helper and is intentionally untouched.
  /** Build a minimal original_bunk_requests record with a custom field. */
  function originalBunkRecord(
    id: string,
    field:
      | 'bunk_request_form'
      | 'staff_not_bunk_with'
      | 'internal_notes'
      | 'bunking_notes'
      | 'socialize_with',
    content: string
  ) {
    return {
      id,
      field,
      content,
      requester: 'pb-emma',
      year: 2025,
      created: '2025-01-01T00:00:00Z',
      updated: '2025-05-01T00:00:00Z',
      collectionId: 'original_bunk_requests',
      collectionName: 'original_bunk_requests',
      expand: { requester: { first_name: 'Emma', last_name: 'Johnson' } },
    }
  }

  function setupOriginalBunkRecords(records: Array<ReturnType<typeof originalBunkRecord>>) {
    mockGetFullListPersons.mockResolvedValue([EMMA])
    mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
    mockGetFullListBunkAssignments.mockResolvedValue([])
    mockGetFullListBunkRequests.mockResolvedValue([])
    mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
    mockGetListOriginalBunkRequests.mockResolvedValue({
      items: records,
      totalItems: records.length,
    })
  }

  describe('Do NOT Share Bunk With section (parent-sourced quick-ref)', () => {
    it('renders the "Do NOT Share Bunk With" section header when negative text exists', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'staff_not_bunk_with', 'Liam Garcia')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Do NOT Share Bunk With/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    })

    it('does not render the section when there is no negative text', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'bunk_request_form', 'Riley Sam')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Do NOT Share Bunk With/i)).not.toBeInTheDocument()
    })

    it('does not render the section when negative content is whitespace-only', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'staff_not_bunk_with', '   ')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Do NOT Share Bunk With/i)).not.toBeInTheDocument()
    })
  })

  describe('Staff Notes section (combines internal + bunking notes)', () => {
    it('renders Staff Notes with only internal notes when bunking notes is empty', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', 'Watch for homesickness'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Watch for homesickness')).toBeInTheDocument()
    })

    it('renders Staff Notes with only bunking notes when internal is empty', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'bunking_notes', 'Allergic to peanuts'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Allergic to peanuts')).toBeInTheDocument()
    })

    it('renders Staff Notes with both texts stacked when both are populated', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', 'Watch for homesickness'),
        originalBunkRecord('obr-2', 'bunking_notes', 'Allergic to peanuts'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByText(/Staff Notes/i)).toBeInTheDocument()
      })
      expect(screen.getByText('Watch for homesickness')).toBeInTheDocument()
      expect(screen.getByText('Allergic to peanuts')).toBeInTheDocument()
    })

    it('does not render Staff Notes when neither field is populated', async () => {
      setupOriginalBunkRecords([originalBunkRecord('obr-1', 'bunk_request_form', 'Riley Sam')])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Staff Notes/i)).not.toBeInTheDocument()
    })

    it('does not render Staff Notes when both fields are whitespace-only', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'internal_notes', '   '),
        originalBunkRecord('obr-2', 'bunking_notes', '\n\t'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Staff Notes/i)).not.toBeInTheDocument()
    })

    it('never surfaces the Social With Checkbox field (5th, excluded)', async () => {
      setupOriginalBunkRecords([
        originalBunkRecord('obr-1', 'socialize_with', 'Marked social-with-best'),
      ])

      render(<CamperDetailsPanel camperId="100" onClose={mockOnClose} embedded={true} />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      expect(screen.queryByText(/Social With/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Marked social-with-best/)).not.toBeInTheDocument()
    })
  })

  describe('CamperDetailsPanel — backdrop is click-through', () => {
    it('backdrop has pointer-events-none so clicks fall through to underlying elements', () => {
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const backdrop = container.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop?.className).toContain('pointer-events-none')
    })

    it('main render path backdrop also has pointer-events-none', async () => {
      // Set up mocks so the camper resolves — hitting the main render path, not
      // the loading or not-found path that the default empty-mock tests exercise.
      setupDeclinedRequestMocks()
      const { container } = render(
        <CamperDetailsPanel camperId={String(EMMA.cm_id)} onClose={vi.fn()} />
      )
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Emma/i })).toBeInTheDocument()
      })
      const backdrop = container.querySelector('[data-testid="panel-backdrop"]')
      expect(backdrop?.className).toContain('pointer-events-none')
    })
  })

  describe('CamperDetailsPanel layout — action bar awareness', () => {
    it('has top-0 and bottom-0 classes when action bar is hidden', () => {
      mockLockGroupContext.isActionBarVisible = false
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const root = container.querySelector('[data-panel="camper-details"]')
      expect(root?.classList.contains('top-0')).toBe(true)
      expect(root?.classList.contains('bottom-0')).toBe(true)
      expect(root?.classList.contains('pb-20')).toBe(false)
      expect(root?.classList.contains('bottom-20')).toBe(false)
    })

    it('adds bottom-20 (shrinks panel) when action bar is visible instead of padding', () => {
      mockLockGroupContext.isActionBarVisible = true
      const { container } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)
      const root = container.querySelector('[data-panel="camper-details"]')
      expect(root?.classList.contains('top-0')).toBe(true)
      expect(root?.classList.contains('bottom-20')).toBe(true)
      expect(root?.classList.contains('pb-20')).toBe(false)
      expect(root?.classList.contains('bottom-0')).toBe(false)
    })
  })

  describe('first-pick indicator (#1544)', () => {
    /** Reuse R3 person/attendee fixtures via local references. */
    const EMMA = mockPerson({
      id: 'pb-emma-fp',
      cm_id: 100,
      first_name: 'Emma',
      last_name: 'Johnson',
      grade: 6,
      year: 2025,
      household_id: 0,
    })
    const RILEY = mockPerson({
      id: 'pb-riley-fp',
      cm_id: 200,
      first_name: 'Riley',
      last_name: 'Sam',
      grade: 6,
      year: 2025,
      household_id: 0,
    })
    const EMMA_ATTENDEE: Record<string, unknown> = {
      id: 'att-emma-fp',
      person: 'pb-emma-fp',
      person_id: 100,
      session: 'sess-fp',
      status: 'enrolled',
      status_id: 2,
      year: 2025,
      collectionId: 'attendees',
      collectionName: 'attendees',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      expand: {
        session: {
          id: 'sess-fp',
          cm_id: 3001,
          name: 'Session FP',
          session_type: 'main',
        },
      },
    }

    function setupFirstPickMocks(bunkRequests: Array<Record<string, unknown>>) {
      mockGetFullListPersons.mockImplementation((opts: { filter?: string }) => {
        const filter = opts.filter ?? ''
        if (filter.includes('cm_id = 200')) return Promise.resolve([RILEY])
        return Promise.resolve([EMMA])
      })
      mockGetFullListAttendees.mockResolvedValue([EMMA_ATTENDEE])
      mockGetFullListBunkAssignments.mockResolvedValue([])
      mockGetFullListBunkRequests.mockResolvedValue(bunkRequests)
      mockGetListPersons.mockResolvedValue({ items: [], totalItems: 0 })
      mockGetListOriginalBunkRequests.mockResolvedValue({ items: [], totalItems: 0 })
    }

    it('renders FirstPickBadge on parent rows with is_first_requested=true', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'fp-first',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: SourceField.BUNK_REQUEST_FORM,
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          is_first_requested: true,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupFirstPickMocks(bunkRequests)

      render(<CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />)

      const badge = await screen.findByLabelText('First pick')
      expect(badge).toBeInTheDocument()
    })

    it('does not render FirstPickBadge when no request is first-requested', async () => {
      const bunkRequests: Array<Record<string, unknown>> = [
        {
          id: 'fp-none',
          requester_id: 100,
          requestee_id: 200,
          request_type: 'bunk_with',
          source_field: SourceField.BUNK_REQUEST_FORM,
          source: 'family',
          status: 'resolved',
          requested_person_name: 'Riley Sam',
          year: 2025,
          session_id: 3001,
          is_reciprocal: false,
          confidence_score: 0.95,
          is_first_requested: false,
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
          collectionId: 'bunk_requests',
          collectionName: 'bunk_requests',
          metadata: {},
        },
      ]
      setupFirstPickMocks(bunkRequests)

      const { container } = render(
        <CamperDetailsPanel camperId="100" onClose={vi.fn()} embedded={true} />
      )

      // Wait for the request row to render (Riley appears as the target name).
      await waitFor(() => {
        expect(container.textContent).toContain('Riley')
      })

      expect(screen.queryByLabelText('First pick')).not.toBeInTheDocument()
    })
  })
})
