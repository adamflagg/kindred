/**
 * Board notes on the summer camper card. The pixel snapshot is recorded
 * BEFORE CamperCard gains the slot prop. Never run with -u. Fictional data.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CamperCard from './CamperCard'
import { mockCamper } from '../test/mockData'
import { emptyCamperSatisfaction } from '../types/satisfaction'
import { NotesScopeFixture, PERSON, noteRow, scopeValue } from '../test/notesScope'
import { SubjectNoteCorner } from './notes/SubjectNoteCorner'

const setNodeRef = vi.hoisted(() => vi.fn())
const dragStart = vi.hoisted(() => vi.fn())
const SORTABLE = vi.hoisted(() => ({
  attributes: {},
  listeners: {
    onMouseDown: (...a: unknown[]) => dragStart(...a),
    onTouchStart: (...a: unknown[]) => dragStart(...a),
  },
  setNodeRef: (element: HTMLElement | null) => setNodeRef(element),
  transform: null,
  transition: undefined,
  isDragging: false,
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))
vi.mock('@dnd-kit/sortable', () => ({ useSortable: () => SORTABLE }))
vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
    getSatisfiedRequestInfo: (cmId: number) => emptyCamperSatisfaction(cmId),
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    addPendingCamper: vi.fn(),
    removePendingCamper: vi.fn(),
    getPendingAnimationDelay: () => 0,
    groups: [],
    addCamperToGroup: vi.fn(),
    getCamperLockGroup: () => null,
    getGroupMembers: () => [],
    setSelectedGroupId: vi.fn(),
    setIsLockPanelOpen: vi.fn(),
  }),
}))

function normalizeIds(html: string): string {
  return html.replace(/[«:_]r[0-9a-z]+[»:_]/g, 'ID')
}

const EMMA = mockCamper({ person_cm_id: 1000101, session_cm_id: 1000001, name: 'Emma Johnson' })

beforeEach(() => {
  setNodeRef.mockReset()
  dragStart.mockReset()
})

describe('CamperCard — pixel identity without note slots', () => {
  it('renders exactly what main renders', () => {
    const { container } = render(<CamperCard camper={EMMA} />)
    expect(normalizeIds(container.innerHTML)).toMatchSnapshot()
  })
})

function renderWithCorner(onClick = vi.fn()) {
  const slots = {
    corner: <SubjectNoteCorner subject={PERSON} label="Emma Johnson" containing="border" />,
  }
  const value = scopeValue([noteRow(PERSON, 'Mom called: lower bunk please.')])
  const view = render(
    <NotesScopeFixture value={value}>
      <CamperCard camper={EMMA} onClick={onClick} noteSlots={slots} />
    </NotesScopeFixture>
  )
  return { ...view, value, onClick }
}

describe('CamperCard — the note corner (wrapper variant)', () => {
  it('without slots, the button itself is the sortable node', () => {
    render(<CamperCard camper={EMMA} />)
    expect(setNodeRef).toHaveBeenLastCalledWith(document.querySelector('[data-camper-card]'))
  })

  it('with slots, a group/relative wrapper is the sortable node and the corner is the button’s sibling', () => {
    renderWithCorner()
    const button = document.querySelector('[data-camper-card]') as HTMLElement
    const wrapper = setNodeRef.mock.lastCall?.[0] as HTMLElement
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.className.split(' ')).toEqual(expect.arrayContaining(['group', 'relative']))
    expect(button.parentElement).toBe(wrapper)
    expect(button.nextElementSibling).toHaveAttribute('data-note-corner', 'standard')
  })

  it('pressing the corner never starts a drag; pressing the card still does', () => {
    renderWithCorner()
    const corner = screen.getByRole('button', { name: 'Note' })
    fireEvent.mouseDown(corner)
    fireEvent.touchStart(corner)
    expect(dragStart).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.querySelector('[data-camper-card]') as HTMLElement)
    expect(dragStart).toHaveBeenCalledTimes(1)
  })

  it('clicking the corner opens the note, never the camper panel', () => {
    const { onClick, value } = renderWithCorner()
    fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(value.openEditor).toHaveBeenCalled()
  })

  it('right-clicking the corner opens the card’s own menu, not the browser’s', async () => {
    renderWithCorner()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Note' }))
    expect(await screen.findByText('View Details')).toBeInTheDocument()
  })
})

describe('CamperCard — the note item in the right-click menu', () => {
  it('sits directly under View Details', async () => {
    render(
      <CamperCard
        camper={EMMA}
        noteSlots={{ menuItem: <button type="button">Add note…</button> }}
      />
    )
    fireEvent.contextMenu(document.querySelector('[data-camper-card]') as HTMLElement)
    const view = await screen.findByText('View Details')
    expect(view.closest('button')?.nextElementSibling).toHaveTextContent('Add note…')
  })
})
