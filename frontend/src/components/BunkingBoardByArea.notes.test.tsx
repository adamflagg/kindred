/**
 * Board notes wired into the summer bunking board: a camper's corner is keyed
 * by the camper's OWN session (an AG camper keeps its AG session id even on
 * the main board), the board wrapper flags a drag for index.css, and the
 * corner is gated on bunking.manage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Minimal mocks — keep them lean so the board's internal logic can run
// ---------------------------------------------------------------------------

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    pendingCampers: [],
    clearPendingCampers: () => {},
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getCamperLockState: () => 'none',
    getCamperLockGroup: () => null,
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
vi.mock('./BunkCard', () => ({
  default: ({
    bunk,
    camperNoteSlots,
    onCamperClick,
  }: {
    bunk: {
      id: string
      campers: Array<{ id: string; person_cm_id: number; session_cm_id: number; name: string }>
    }
    camperNoteSlots?: (c: unknown) => { corner?: React.ReactNode } | undefined
    onCamperClick?: (c: { id: string; person_cm_id: number; session_cm_id: number }) => void
  }) => (
    <div data-bunk-card data-testid={`bunk-${bunk.id}`}>
      {bunk.campers.map((c) => (
        <div
          key={c.id}
          data-testid={`camper-${String(c.person_cm_id)}`}
          onClick={() => onCamperClick?.(c)}
        >
          {c.name}
          {camperNoteSlots?.(c)?.corner}
        </div>
      ))}
    </div>
  ),
}))
vi.mock('./FloatingUnassignedBadge', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({
  default: ({ notesSlot }: { notesSlot?: React.ReactNode }) => (
    <div data-testid="camper-panel">{notesSlot}</div>
  ),
}))
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
  }
})

let notesData: { notes: unknown[] } = { notes: [] }
vi.mock('../hooks/useSubjectNotes', () => ({
  useSubjectNotes: () => ({ data: notesData }),
  useSaveSubjectNote: () => ({ mutateAsync: vi.fn() }),
  usePromoteSubjectNote: () => ({ mutateAsync: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Fixtures — fictional names per CLAUDE.md
// ---------------------------------------------------------------------------

import BunkingBoardByArea from './BunkingBoardByArea'
import type { Bunk, Camper } from '../types/app-types'
import { SubjectNotesScope } from './notes/SubjectNotesScope'

const makeBaseProps = () => ({
  sessionId: 'sess-1',
  sessionCmId: 1001,
  bunks: [
    {
      id: 'bunk-oak',
      cm_id: 9001,
      name: 'B-1',
      gender: 'M',
      capacity: 12,
      year: 2025,
      campers: [
        {
          id: 'emma:sess-1',
          person_cm_id: 100,
          session_cm_id: 1002,
          name: 'Emma Johnson',
          gender: 'F',
          grade: 6,
          assigned_bunk: 'bunk-oak',
          assigned_bunk_cm_id: 9001,
        },
      ],
      occupancy: 1,
      utilization: 8,
    },
  ] as unknown as Bunk[],
  campers: [
    {
      id: 'emma:sess-1',
      person_cm_id: 100,
      session_cm_id: 1002,
      name: 'Emma Johnson',
      gender: 'F',
      grade: 6,
      assigned_bunk: 'bunk-oak',
      assigned_bunk_cm_id: 9001,
    },
  ] as unknown as Camper[],
  selectedArea: 'all' as const,
  onAreaChange: vi.fn(),
  onCamperMove: vi.fn(async () => {}),
})

function renderSummer(canManage = true) {
  return render(
    <SubjectNotesScope
      year={2025}
      sessionCmId={1001}
      scenarioId=""
      scenarioName=""
      canManage={canManage}
    >
      <BunkingBoardByArea {...makeBaseProps()} />
    </SubjectNotesScope>
  )
}

describe('BunkingBoardByArea — board notes', () => {
  beforeEach(() => {
    notesData = {
      notes: [
        {
          subject_kind: 'person',
          subject_cm_id: 100,
          session_cm_id: 1002,
          scenario: '',
          body: 'Mom called: lower bunk please.',
          updated_by: 'Test Staff',
          updated: '2025-09-25T12:00:00Z',
        },
      ],
    }
  })

  it('keys an AG camper’s corner by the AG session, and finds the note read on the main board', () => {
    renderSummer()
    const corner = within(screen.getByTestId('camper-100')).getByRole('button', { name: 'Note' })
    expect(corner.closest('[data-note-corner]')).toHaveAttribute(
      'data-note-corner-for',
      'person:100:1002'
    )
  })

  it('shows no corner without bunking.manage', () => {
    renderSummer(false)
    expect(document.querySelector('[data-note-corner]')).toBeNull()
  })

  it('flags the board wrapper during a drag', () => {
    renderSummer()
    act(() => onDragStart?.({ active: { id: 'emma:sess-1' } }))
    expect(document.querySelector('[data-board-wrapper]')).toHaveAttribute('data-dragging')
    act(() => onDragCancel?.())
    expect(document.querySelector('[data-board-wrapper]')).not.toHaveAttribute('data-dragging')
  })

  it('opens the clicked camper’s own Note section in the panel (an AG camper, keyed to its own session)', () => {
    renderSummer()
    fireEvent.click(screen.getByTestId('camper-100'))
    const panel = screen.getByTestId('camper-panel')
    expect(within(panel).getByText('Mom called: lower bunk please.')).toBeInTheDocument()
  })
})
