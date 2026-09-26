/**
 * I1: pressing a context-menu item on a queue card must not collapse the
 * unassigned queue. The menu is portaled to `document.body`, outside
 * `[data-camper-card]` -- so its `mousedown` bubbles all the way to
 * FloatingQueueBadge's own click-outside listener before the menu item's
 * `click` handler ever runs, and the queue (and the menu with it) would
 * unmount first. Real FloatingUnassignedBadge + real CamperCard, fictional
 * data.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
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

vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
    getSatisfiedRequestInfo: (cmId: number) => emptyCamperSatisfaction(cmId),
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
  useBunkRequestsFromContext: () => ({ data: {} }),
}))

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    getCamperLockState: () => 'none',
    getCamperLockGroupColor: () => undefined,
    isDraftMode: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))

import FloatingUnassignedBadge from './FloatingUnassignedBadge'
import { mockCamper } from '../test/mockData'
import { emptyCamperSatisfaction } from '../types/satisfaction'
import { NotesScopeFixture, PERSON, scopeValue } from '../test/notesScope'
import { SubjectNoteCorner } from './notes/SubjectNoteCorner'
import { SubjectNoteMenuItem } from './notes/SubjectNoteMenuItem'
import type { Camper } from '../types/app-types'

const EMMA = mockCamper({ person_cm_id: 1000101, session_cm_id: 1000001, name: 'Emma Johnson' })

const camperNoteSlots = (camper: Camper) => ({
  corner: <SubjectNoteCorner subject={PERSON} label={camper.name} containing="border" />,
  menuItem: <SubjectNoteMenuItem subject={PERSON} label={camper.name} />,
})

function renderQueue() {
  const value = scopeValue([])
  const onClose = vi.fn()
  const onCamperClick = vi.fn()
  render(
    <NotesScopeFixture value={value}>
      <FloatingUnassignedBadge
        campers={[EMMA]}
        onCamperClick={onCamperClick}
        isExpanded={true}
        onToggle={vi.fn()}
        onClose={onClose}
        camperNoteSlots={camperNoteSlots}
      />
    </NotesScopeFixture>
  )
  return { value, onClose, onCamperClick }
}

async function openMenu() {
  fireEvent.contextMenu(document.querySelector('[data-camper-card]') as HTMLElement)
  await screen.findByText('View Details')
}

describe('FloatingUnassignedBadge — a queue card’s menu item stays open under it', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('pressing "Add note…" opens the editor and leaves the queue open', async () => {
    const { value, onClose } = renderQueue()
    await openMenu()
    const addNote = await screen.findByText('Add note…')
    fireEvent.mouseDown(addNote)
    fireEvent.click(addNote)
    expect(value.openEditor).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('pressing "View Details" fires its handler and leaves the queue open', async () => {
    const { onCamperClick, onClose } = renderQueue()
    await openMenu()
    const viewDetails = await screen.findByText('View Details')
    fireEvent.mouseDown(viewDetails)
    fireEvent.click(viewDetails)
    expect(onCamperClick).toHaveBeenCalledWith(expect.objectContaining({ person_cm_id: 1000101 }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
