/**
 * Tests for CamperAlertSection — the alerts panel mirrored from the bunking-board
 * camper card, rendered above the requests section in CamperDetailsPanel.
 *
 * Alert catalog (from CamperCard.tsx):
 *   1. Orange triangle — "Has N requests, none satisfied"
 *      Severity: yellow (warning) | Request-related: YES → clickable
 *   2. Lock icon — "In friend group (N members)"
 *      Severity: blue (info)     | Request-related: NO  → non-clickable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../test/testUtils'
import { CamperAlertSection } from './CamperAlertSection'
import type { CamperAlert } from './CamperAlertSection'
import { buildCamperAlerts } from '../utils/camperAlertUtils'

describe('CamperAlertSection', () => {
  const mockOnRequestAlertClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── 1. Camper with unsatisfied requests → yellow warning row ────────────────

  describe('unsatisfied-requests alert', () => {
    it('renders a yellow warning row with correct label when camper has unsatisfied requests', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'unsatisfied-requests',
          severity: 'yellow',
          label: 'Has 3 requests, none satisfied',
          requestRelated: true,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      expect(screen.getByText('Has 3 requests, none satisfied')).toBeInTheDocument()
      // Row should exist in the section
      expect(screen.getByRole('region', { name: /alerts/i })).toBeInTheDocument()
    })

    it('request-related alert row is a button (clickable)', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'unsatisfied-requests',
          severity: 'yellow',
          label: 'Has 2 requests, none satisfied',
          requestRelated: true,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      const row = screen.getByRole('button', { name: /has 2 requests/i })
      expect(row).toBeInTheDocument()
    })

    it('clicking a request-related alert calls onRequestAlertClick', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'unsatisfied-requests',
          severity: 'yellow',
          label: 'Has 1 request, none satisfied',
          requestRelated: true,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      const row = screen.getByRole('button', { name: /has 1 request/i })
      fireEvent.click(row)
      expect(mockOnRequestAlertClick).toHaveBeenCalledTimes(1)
    })
  })

  // ─── 2. Non-request alert → plain row, no clickable affordance ───────────────

  describe('non-request alert (lock group)', () => {
    it('renders a blue info row for friend-group lock alert', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'friend-group',
          severity: 'blue',
          label: 'In friend group (4 members)',
          requestRelated: false,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      expect(screen.getByText('In friend group (4 members)')).toBeInTheDocument()
    })

    it('non-request alert row is NOT a button (no clickable affordance)', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'friend-group',
          severity: 'blue',
          label: 'In friend group (2 members)',
          requestRelated: false,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      // Should not be a button
      const buttons = screen.queryAllByRole('button')
      // None of the buttons should say "In friend group"
      const lockButton = buttons.find((b) => String(b.textContent).includes('In friend group'))
      expect(lockButton).toBeUndefined()
    })

    it('clicking non-request alert row does NOT call onRequestAlertClick', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'friend-group',
          severity: 'blue',
          label: 'In friend group (3 members)',
          requestRelated: false,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      const row = screen.getByText('In friend group (3 members)')
      fireEvent.click(row)
      expect(mockOnRequestAlertClick).not.toHaveBeenCalled()
    })
  })

  // ─── 3. Severity ordering: red → yellow → blue ───────────────────────────────

  describe('severity ordering', () => {
    it('orders alerts red → yellow → blue regardless of input order', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'friend-group',
          severity: 'blue',
          label: 'In friend group (2 members)',
          requestRelated: false,
        },
        {
          id: 'unsatisfied-requests',
          severity: 'yellow',
          label: 'Has 2 requests, none satisfied',
          requestRelated: true,
        },
        {
          id: 'critical-test',
          severity: 'red',
          label: 'Critical alert example',
          requestRelated: false,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      const items = screen.getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('Critical alert example')
      expect(items[1]).toHaveTextContent('Has 2 requests, none satisfied')
      expect(items[2]).toHaveTextContent('In friend group (2 members)')
    })
  })

  // ─── 4. No alerts → section does not render ──────────────────────────────────

  describe('empty alerts list', () => {
    it('does not render the section when alerts array is empty', () => {
      render(<CamperAlertSection alerts={[]} onRequestAlertClick={mockOnRequestAlertClick} />)

      expect(screen.queryByRole('region', { name: /alerts/i })).not.toBeInTheDocument()
    })
  })

  // ─── 5. Multiple alerts mix of severities ────────────────────────────────────

  describe('mixed alerts', () => {
    it('renders all alerts when multiple are present', () => {
      const alerts: CamperAlert[] = [
        {
          id: 'unsatisfied-requests',
          severity: 'yellow',
          label: 'Has 5 requests, none satisfied',
          requestRelated: true,
        },
        {
          id: 'friend-group',
          severity: 'blue',
          label: 'In friend group (3 members)',
          requestRelated: false,
        },
      ]

      render(<CamperAlertSection alerts={alerts} onRequestAlertClick={mockOnRequestAlertClick} />)

      expect(screen.getByText('Has 5 requests, none satisfied')).toBeInTheDocument()
      expect(screen.getByText('In friend group (3 members)')).toBeInTheDocument()
    })
  })

  // ─── 6. Materiality rule: immaterial (socialize_with) doesn't trip parent alert ─

  describe('materiality gating in buildCamperAlerts', () => {
    // The materiality gate lives in buildCamperAlerts, not in this renderer.
    // Exercise the gate directly so the test fails if the gate flips.
    const EMPTY_COUNT = { satisfied: 0, total: 0 }
    const baseRequestInfo = {
      person_cm_id: 100,
      per_request: [],
      counted_totals: {
        material_parent: EMPTY_COUNT,
        staff: EMPTY_COUNT,
      },
      immaterial: EMPTY_COUNT,
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: false,
        has_any_counted_request: false,
      },
    }

    it('produces no parent alert when only immaterial requests are unsatisfied', () => {
      const alerts = buildCamperAlerts({
        assignedBunkCmId: 100,
        requestInfo: {
          ...baseRequestInfo,
          immaterial: { total: 1, satisfied: 0 },
        },
        lockState: 'none',
        lockGroupSize: 0,
      })
      const parentAlert = alerts.find((a) => a.id === 'unsatisfied-parent-requests')
      expect(parentAlert).toBeUndefined()
    })

    it('produces a parent alert when material parent requests are unsatisfied', () => {
      const alerts = buildCamperAlerts({
        assignedBunkCmId: 100,
        requestInfo: {
          ...baseRequestInfo,
          counted_totals: {
            ...baseRequestInfo.counted_totals,
            material_parent: { total: 2, satisfied: 0 },
          },
          flags: { ...baseRequestInfo.flags, parent_min_one_violation: true },
        },
        lockState: 'none',
        lockGroupSize: 0,
      })
      const parentAlert = alerts.find((a) => a.id === 'unsatisfied-parent-requests')
      expect(parentAlert).toBeDefined()
      expect(parentAlert?.label).toBe('2 parent requests, none satisfied')
    })

    it('produces no alerts at all for an unassigned camper, regardless of request state', () => {
      const alerts = buildCamperAlerts({
        assignedBunkCmId: null,
        requestInfo: {
          ...baseRequestInfo,
          counted_totals: {
            material_parent: { total: 1, satisfied: 0 },
            staff: { total: 1, satisfied: 0 },
          },
          flags: {
            parent_min_one_violation: true,
            staff_unsatisfied_alert: true,
            has_any_counted_request: true,
          },
        },
        lockState: 'none',
        lockGroupSize: 0,
      })
      expect(alerts.filter((a) => a.requestRelated)).toEqual([])
    })
  })
})

// ─── Integration: CamperDetailsPanel renders alert section ────────────────────
// These tests verify the alert section is integrated into CamperDetailsPanel above
// the requests section, and that the existing sections still render.

import CamperDetailsPanel from './CamperDetailsPanel'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: vi.fn().mockResolvedValue([]),
      getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    })),
    authStore: {
      isValid: true,
      token: 'mock-token',
      model: { id: 'admin' },
    },
  },
}))

// kindred#2466: CamperDetailsPanel now calls useHouseholdJourney (to show a
// family-camp row's resolved cabin instead of the CampMinder day group),
// which needs an AuthProvider via useApiWithAuth — absent here, since these
// tests render CamperDetailsPanel with no AuthContext mock at all. Stubbed
// out; none of these integration tests concern family-camp housing.
vi.mock('../hooks/useWeekendRoster', () => ({
  useHouseholdJourney: () => ({ data: undefined }),
}))

// Same reason, one layer up: CamperDetailsPanel gates that household read on
// `useAuth().isLoading` (frontend/CLAUDE.md: "useAuth().isLoading first"), and
// these tests render it with no AuthProvider, so the real `useAuth` throws.
// `isLoading: false` is the settled-auth case; none of these tests concern auth.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

// Provide a no-op BunkRequestContext so CamperDetailsPanel can derive the
// unsatisfied-requests alert without a live BunkRequestProvider in tests.
vi.mock('../hooks', async () => {
  const actual = await vi.importActual<typeof import('../hooks')>('../hooks')
  return {
    ...actual,
    useBunkRequestContext: () => ({
      allRequests: [],
      hasRequests: () => false,
      getRequestsForCamper: () => [],
      getSatisfiedRequestInfo: (personCmId: number) => ({
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
      }),
      isLoading: false,
      error: null,
    }),
  }
})

// Provide a no-op LockGroupContext so CamperDetailsPanel renders in tests
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    isDraftMode: false,
    groups: [],
    pendingCampers: [],
    addPendingCamper: vi.fn(),
    removePendingCamper: vi.fn(),
    getPendingAnimationDelay: () => 0,
    addCamperToGroup: vi.fn(),
    getCamperLockGroup: () => null,
    getCamperLockState: () => 'none',
    getCamperLockGroupColor: () => undefined,
    getGroupMembers: () => [],
    createLockGroup: vi.fn(),
    deleteLockGroup: vi.fn(),
    isLoading: false,
  }),
}))

describe('CamperDetailsPanel — alert section integration', () => {
  it('regression: existing panel sections still render after alert section added', async () => {
    const { queryByTestId } = render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} />)

    // Backdrop still present (non-embedded mode)
    await waitFor(() => {
      expect(queryByTestId('panel-backdrop')).toBeInTheDocument()
    })
  })

  // Scenario-aware assignment: CamperDetailsPanel re-fetches `camper` from PB,
  // which only sees LIVE/prod assignments. The panel calls getSatisfiedRequestInfo
  // with the camper's personCmId; the assignedBunkCmId prop gates whether
  // buildCamperAlerts fires request-related alerts, not getSatisfiedRequestInfo.
  // Finding #20: prior title promised "surfaces alert ..." but the body only
  // checked the spy was called — the camper-load mock is incomplete here, so
  // this stays a hook-invocation contract test. End-to-end alert rendering is
  // covered in CamperDetailsPanel.test.tsx (which mocks useCamper).
  it('calls getSatisfiedRequestInfo when parent_min_one_violation flag is true', async () => {
    const hooks = await import('../hooks')

    const spy = vi.fn((_personCmId: number) => ({
      person_cm_id: _personCmId,
      per_request: [],
      counted_totals: {
        material_parent: { total: 2, satisfied: 0 },
        staff: { satisfied: 0, total: 0 },
      },
      immaterial: { satisfied: 0, total: 0 },
      flags: {
        parent_min_one_violation: true,
        staff_unsatisfied_alert: false,
        has_any_counted_request: true,
      },
    }))
    vi.spyOn(hooks, 'useBunkRequestContext').mockReturnValue({
      allRequests: [],
      hasRequests: () => false,
      getRequestsForCamper: () => [],
      getSatisfiedRequestInfo: spy,
      isLoading: false,
      error: null,
    })

    render(<CamperDetailsPanel camperId="12345" onClose={vi.fn()} assignedBunkCmId={777} />)

    // Wait for getSatisfiedRequestInfo to be called (it fires during render even
    // before camper data loads, using the `?? 0` fallback personCmId).
    await waitFor(() => {
      expect(spy).toHaveBeenCalled()
    })
  })

  // Regression guard: CamperDetailsPanel must mount without error when the
  // bunking-board passes the full scenario-aware satisfaction trio
  // (assignedBunkCmId + bunkCampers + getBunkForPerson). Per-branch behavior
  // of the satisfaction calculation is covered exhaustively in
  // requestSatisfaction.test.ts; this test only guards the prop wiring.
  it('mounts cleanly with getBunkForPerson + assignedBunkCmId + bunkCampers (scenario path)', async () => {
    const { queryByTestId } = render(
      <CamperDetailsPanel
        camperId="12345"
        onClose={vi.fn()}
        assignedBunkCmId={777}
        getBunkForPerson={() => 777}
        bunkCampers={[
          { cmId: 12345, grade: 7 },
          { cmId: 200, grade: 7 },
        ]}
      />
    )

    await waitFor(() => {
      expect(queryByTestId('panel-backdrop')).toBeInTheDocument()
    })
  })
})
