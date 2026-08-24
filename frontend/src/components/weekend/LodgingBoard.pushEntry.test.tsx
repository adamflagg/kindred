/**
 * The "Push write-ins" toolbar button (kindred#2477 Task 8): the entry point
 * into comparing a scenario's write-ins against the live board.
 *
 * Present only where a push could ever apply — inside a scenario, held by a
 * `bunking.manage` user — and ABSENT everywhere else. `opacity-40` is this
 * board's vocabulary for a refusal (CLAUDE.md §4, "Family Camp Models
 * Summer"); an affordance with nothing behind it is not a refusal, so it is
 * not rendered at all rather than disabled.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { LodgingBoard } from './LodgingBoard'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(), isMoving: false }),
}))

vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({ setAvailability: vi.fn(), pendingUnitId: '' }),
}))

vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(), pendingUnitId: null }),
}))

// `PushWriteInsModal` (mounted alongside the button) calls the real
// `useApiWithAuth` directly rather than through a wrapped hook, and this tree
// carries no AuthProvider — the same reason the sibling board test files mock
// `useUnitAvailability`/`useUnitMerge` rather than let them reach the real
// hook.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/weekend/fc1/housing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

const SCENARIO = 'scn7x2k9qw3mnbv'

function renderBoard(props: Partial<Parameters<typeof LodgingBoard>[0]> = {}) {
  return render(
    <LodgingBoard
      parties={[party()]}
      units={[unit()]}
      year={2026}
      sessionCmId={1000001}
      scenario={SCENARIO}
      canManage={true}
      {...props}
    />,
    { wrapper }
  )
}

describe('LodgingBoard — the push write-ins entry button', () => {
  it('is absent without bunking.manage', () => {
    renderBoard({ canManage: false })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('is absent on the CampMinder mirror, where there is no scenario to push', () => {
    renderBoard({ scenario: '' })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('is absent without a weekend session, where a preview would fire session_cm_id=0', () => {
    // CodeRabbit fix-round finding (2026-08-23, PR #2555 comment 3): the
    // same third condition `canPlace` (Line ~314) carries for the identical
    // reason -- `sessionCmId` defaults to 0 for boards under test that don't
    // exercise a real weekend, and the preview endpoint requires a positive
    // id.
    renderBoard({ sessionCmId: 0 })
    expect(screen.queryByRole('button', { name: /push write-ins/i })).not.toBeInTheDocument()
  })

  it('is present, badged, with both', () => {
    renderBoard()
    expect(screen.getByRole('button', { name: /push write-ins/i })).toBeInTheDocument()
  })

  it('badges the board-wide count of own-or-descendant write-in covers, excluding ancestor duplicates', () => {
    const cover = (
      unitCode: string,
      occupantName: string,
      relation: 'own' | 'ancestor' | 'descendant'
    ) => ({
      unit_id: `u-${unitCode}`,
      unit_code: unitCode,
      unit_name: unitCode,
      occupant_name: occupantName,
      note: '',
      relation,
    })
    renderBoard({
      units: [
        // Its own row: counts once.
        unit({
          unit_id: 'u1',
          code: 'cedar-1',
          write_ins: [cover('cedar-1', 'Alex Rivera', 'own')],
        }),
        // A merged building drawing in two rooms' rows: counts twice, as
        // `descendant`.
        unit({
          unit_id: 'u2',
          code: 'house',
          write_ins: [
            cover('house-a', 'Jordan Lee', 'descendant'),
            cover('house-b', 'Sam Patel', 'descendant'),
          ],
        }),
        // A split room inheriting its building's row: excluded. The
        // building's own row is counted wherever IT is drawn, and this is
        // the same row surfacing a second time.
        unit({
          unit_id: 'u3',
          code: 'annex-a',
          write_ins: [cover('annex', 'Taylor Brooks', 'ancestor')],
        }),
      ],
    })
    expect(screen.getByRole('button', { name: /push write-ins/i })).toHaveTextContent('3')
  })
})
