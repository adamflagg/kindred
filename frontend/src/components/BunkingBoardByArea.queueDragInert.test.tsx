/**
 * I2: the unassigned queue's note corners must be drag-inert too. index.css's
 * `[data-dragging] [data-note-corner…]` rule only reaches a corner that has
 * `[data-dragging]` somewhere ABOVE it in the DOM, and `data-board-wrapper`
 * (where that attribute lives) does not contain FloatingUnassignedBadge --
 * the badge renders as its sibling. Real FloatingUnassignedBadge + real
 * CamperCard, fictional data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    pendingCampers: [],
    clearPendingCampers: () => {},
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getCamperLockState: () => 'none',
    getCamperLockGroup: () => null,
    getCamperLockGroupColor: () => undefined,
    getGroupMembers: () => [],
    scenarioId: null,
    sessionPbId: null,
    isDraftMode: false,
    isLockPanelOpen: false,
    setIsLockPanelOpen: () => {},
    selectedGroupId: null,
    setSelectedGroupId: () => {},
    groups: [],
    membersByGroup: new Map(),
    isActionBarVisible: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
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
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
  useBunkRequestsFromContext: () => ({ data: {} }),
}))
vi.mock('./BunkCard', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({ default: () => null }))
vi.mock('./BunkSocialGraphModal', () => ({ default: () => null }))
vi.mock('./LockGroupActionBar', () => ({ default: () => null }))
vi.mock('./LockGroupPanel', () => ({ default: () => null }))
vi.mock('./LockGroupsHub', () => ({ default: () => null }))

let onDragStart: ((event: unknown) => void) | undefined
let onDragCancel: (() => void) | undefined
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart: start,
      onDragCancel: cancel,
    }: {
      children: React.ReactNode
      onDragStart: (e: unknown) => void
      onDragCancel: () => void
    }) => {
      onDragStart = start
      onDragCancel = cancel
      return <>{children}</>
    },
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  }
})

import BunkingBoardByArea from './BunkingBoardByArea'
import type { Bunk, Camper } from '../types/app-types'
import { NotesScopeFixture, scopeValue } from '../test/notesScope'

const makeProps = () => ({
  sessionId: 'sess-1',
  sessionCmId: 1001,
  bunks: [] as unknown as Bunk[],
  campers: [
    {
      id: 'emma:sess-1',
      person_cm_id: 100,
      session_cm_id: 1002,
      name: 'Emma Johnson',
      gender: 'F',
      grade: 6,
      assigned_bunk: '',
      assigned_bunk_cm_id: null,
    },
  ] as unknown as Camper[],
  selectedArea: 'all' as const,
  onAreaChange: vi.fn(),
  onCamperMove: vi.fn(async () => {}),
})

function renderBoard() {
  return render(
    <NotesScopeFixture value={scopeValue([])}>
      <BunkingBoardByArea {...makeProps()} />
    </NotesScopeFixture>
  )
}

describe('BunkingBoardByArea — unassigned queue corners are drag-inert', () => {
  beforeEach(() => {
    onDragStart = undefined
    onDragCancel = undefined
  })

  it('a queue corner has a [data-dragging] ancestor mid-drag, and loses it after cancel', () => {
    renderBoard()
    fireEvent.click(document.querySelector('[data-floating-badge] > button') as HTMLElement)
    const corner = document.querySelector('[data-note-corner]') as HTMLElement
    expect(corner).toBeTruthy()
    expect(corner.closest('[data-dragging]')).toBeNull()

    act(() => onDragStart?.({ active: { id: 'emma:sess-1' } }))
    expect(corner.closest('[data-dragging]')).not.toBeNull()

    act(() => onDragCancel?.())
    expect(corner.closest('[data-dragging]')).toBeNull()
  })
})
