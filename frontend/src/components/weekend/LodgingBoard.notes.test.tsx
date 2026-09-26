/**
 * Board notes on the weekend board (2026-09-25): the corner on a placed and
 * an unplaced family card, the drag-in-progress flag on the board root, and
 * the panel's Note section.
 *
 * Harness copied verbatim from `LodgingBoard.drag.test.tsx` lines 1-187 (its
 * imports, the `vi.mock` blocks for `usePermissions`, `useWeekendRoster`,
 * `useLodgingPlacement`, `useUnitAvailability`, `useUnitMerge`,
 * `useApiWithAuth`, `./boardCollision`, `@dnd-kit/core` with the captured
 * `onDragStart`/`onDragCancel`, the `beforeEach`, `wrapper`, `unit()`,
 * `party()` and `SCENARIO`) — minus `UNPLACED_DROPPABLE_ID`, `unitDroppableId`
 * and `onDragEnd`, which that file's `renderBoard`/`startDrag`/`drop` use and
 * this one does not.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { SubjectNotesScope } from '../notes/SubjectNotesScope'
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

// Returns a promise because the real hook does: the board chains `.catch()`
// on it to keep a rejected write from surfacing as an unhandled rejection.
const move = vi.fn((_intent: unknown) => Promise.resolve())
vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: (...args: unknown[]) => {
    placementOptions.push(args[0])
    return { move, isMoving: false }
  },
}))
let placementOptions: unknown[] = []

// The board also writes availability now. Mocked here only to keep the real
// hook's `useApiWithAuth` out of a tree with no AuthProvider — this file is
// about drag, and the availability gate is pinned in
// `LodgingBoard.availability.test.tsx`.
vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({ setAvailability: vi.fn(), pendingUnitId: '' }),
}))

// Same reason: the board now also writes merges. The merge gesture and its
// own gate are pinned in `LodgingBoard.merge.test.tsx`.
vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(), pendingUnitId: null }),
}))

// Same reason again: the board now also mounts `PushWriteInsModal`
// (kindred#2477 Task 8), which calls the real `useApiWithAuth` directly
// rather than through a wrapped hook. The push queue itself is pinned in
// `PushWriteInsModal.test.tsx` and `LodgingBoard.pushEntry.test.tsx`.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

/** Its `onDragCancel` sibling — Escape, resize, tab-hide mid-drag. */
let onDragCancel: (() => void) | undefined
/** Its `onDragStart` sibling — the half the needs-misfit hatch (#1912) rides on. */
let onDragStart: ((event: unknown) => void) | undefined

// The collision policy is STATEFUL (it holds the last cabin the pointer was
// inside), so the board must clear it at every gesture boundary — one gesture
// inheriting the previous gesture's hold is a wrong drop target waiting for a
// gutter release. jsdom can't drive the real detector (no rects), so the
// wiring is pinned by spying on `reset` instead.
const collisionReset = vi.fn()
vi.mock('./boardCollision', () => ({
  createBoardCollisionDetection: () => {
    const detect = () => []
    detect.reset = collisionReset
    return detect
  },
}))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart: startHandler,
      onDragCancel: cancelHandler,
    }: {
      children: ReactNode
      onDragStart: (e: unknown) => void
      onDragCancel: () => void
    }) => {
      onDragStart = startHandler
      onDragCancel = cancelHandler
      return <div data-testid="dnd-context">{children}</div>
    },
  }
})

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  onDragStart = undefined
  onDragCancel = undefined
  placementOptions = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// The board reads its collapsed areas from the query string, so it needs a
// router. `MemoryRouter` rather than a real one, so no `?closed=` written by
// one test can leak into the next.
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
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
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

// The real panel mounts journey and medical hooks this harness does not mock,
// and its own slot placement has its own test elsewhere. Here the question
// is only whether the BOARD hands the panel a Note section, so the panel is
// a stub that renders its slot.
vi.mock('./FamilyDetailsPanel', () => ({
  FamilyDetailsPanel: ({ notesSlot }: { notesSlot?: ReactNode }) => (
    <div data-testid="panel-stub">{notesSlot}</div>
  ),
}))

let notesData: { notes: unknown[] } = { notes: [] }
vi.mock('../../hooks/useSubjectNotes', () => ({
  useSubjectNotes: () => ({ data: notesData }),
  useSaveSubjectNote: () => ({ mutateAsync: vi.fn() }),
  usePromoteSubjectNote: () => ({ mutateAsync: vi.fn() }),
}))

const NOTE = {
  subject_kind: 'household',
  subject_cm_id: 101,
  session_cm_id: 1000001,
  scenario: '',
  body: 'Grandma is coming Saturday only.',
  updated_by: 'Test Staff',
  updated: '2026-09-25T12:00:00Z',
}

function renderNotesBoard({
  canManage = true,
  parties = [party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })],
} = {}) {
  return render(
    <SubjectNotesScope
      year={2026}
      sessionCmId={1000001}
      scenarioId={SCENARIO}
      scenarioName="Option A"
      canManage={canManage}
    >
      <LodgingBoard
        parties={parties}
        units={[unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })]}
        year={2026}
        sessionCmId={1000001}
        scenario={SCENARIO}
        canManage={canManage}
      />
    </SubjectNotesScope>,
    { wrapper }
  )
}

describe('LodgingBoard — board notes', () => {
  beforeEach(() => {
    notesData = { notes: [NOTE] }
  })

  it('marks a placed family’s card with its note corner', () => {
    renderNotesBoard()
    const corner = document.querySelector('[data-note-corner="standard"]')
    // A null `corner` would make `corner?.closest(...)` resolve to
    // `undefined`, which `.not.toBeNull()` accepts — so the corner's
    // presence is asserted on its own line, not folded into the chain.
    expect(corner).not.toBeNull()
    expect(corner?.closest('[data-family-card]')).not.toBeNull()
  })

  it('gives an unplaced family in the queue a ghost corner', async () => {
    notesData = { notes: [] }
    renderNotesBoard({ parties: [party()] })
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))
    const corner = document.querySelector('[data-note-corner="ghost"]')
    expect(corner).not.toBeNull()
    expect(corner?.closest('[data-family-card]')).not.toBeNull()
  })

  it('shows no corner without bunking.manage', () => {
    renderNotesBoard({ canManage: false })
    expect(document.querySelector('[data-note-corner]')).toBeNull()
  })

  it('flags the board root while a drag is in progress, and clears it after', () => {
    renderNotesBoard()
    expect(document.querySelector('[data-dragging]')).toBeNull()
    act(() => onDragStart?.({ active: { id: 'household-101' } }))
    expect(document.querySelector('[data-dragging]')).not.toBeNull()
    act(() => onDragCancel?.())
    expect(document.querySelector('[data-dragging]')).toBeNull()
  })

  it('the corner opens the note popover, not the family panel', () => {
    renderNotesBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByRole('dialog', { name: 'Note' })).toBeInTheDocument()
    expect(screen.queryByTestId('panel-stub')).not.toBeInTheDocument()
  })

  it('opening the family hands its panel the Note section', () => {
    renderNotesBoard()
    const card = document.querySelector('[data-family-card]') as HTMLElement
    // The identity button is the frame's first control; the corner is its last child.
    fireEvent.click(within(card).getAllByRole('button')[0] as HTMLElement)
    expect(
      within(screen.getByTestId('panel-stub')).getByText('Grandma is coming Saturday only.')
    ).toBeInTheDocument()
  })
})
