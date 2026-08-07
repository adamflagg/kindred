/**
 * Keyboard accessibility for CamperCard (a11y sweep, board-graph-users chunk).
 *
 * CamperCard used to be a `<div onClick>` — clickable only by mouse
 * (jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions).
 * The fix follows the house pattern already established by the weekend
 * board's `FamilyCard` (and by kindred#2063/#2068): a real `<button>` gets
 * native Enter/Space activation for free, no bolted-on onKeyDown needed.
 * This pins that regression — reachable by Tab, opens with the keyboard.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

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

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getPendingAnimationDelay: () => 0,
    groups: [],
    addCamperToGroup: () => {},
    getCamperLockGroup: () => null,
    getGroupMembers: () => [],
    setSelectedGroupId: () => {},
    setIsLockPanelOpen: () => {},
  }),
}))

vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({ getSatisfiedRequestInfo: () => null }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import CamperCard from './CamperCard'
import type { Camper } from '../types/app-types'

const camper: Camper = {
  id: 'pb-1',
  person_cm_id: 1000001,
  name: 'Emma Johnson',
  grade: 5,
  gender: 'F',
  assigned_bunk: '',
  assigned_bunk_cm_id: null,
} as unknown as Camper

describe('CamperCard keyboard activation', () => {
  it('is reachable as a native button and opens details on Enter', async () => {
    const onClick = vi.fn()
    render(<CamperCard camper={camper} isDraggable={true} onClick={onClick} />)

    const card = screen.getByRole('button', { name: /Emma Johnson/ })
    card.focus()
    await userEvent.keyboard('{Enter}')

    expect(onClick).toHaveBeenCalledWith(camper)
  })

  it('opens details on Space too (non-draggable card)', async () => {
    const onClick = vi.fn()
    render(<CamperCard camper={camper} isDraggable={false} onClick={onClick} />)

    const card = screen.getByRole('button', { name: /Emma Johnson/ })
    card.focus()
    await userEvent.keyboard(' ')

    expect(onClick).toHaveBeenCalledWith(camper)
  })
})

describe('CamperCard context menu dismiss backdrop', () => {
  // The full-viewport backdrop that closes the right-click context menu is a
  // decorative click-outside layer (jsx-a11y/click-events-have-key-events,
  // jsx-a11y/no-static-element-interactions flag it — see the suppression at
  // its definition). Escape is the real keyboard equivalent; this pins that
  // the menu is actually reachable without a mouse to dismiss.
  it('closes on Escape', async () => {
    render(<CamperCard camper={camper} isDraggable={true} />)
    const card = screen.getByRole('button', { name: /Emma Johnson/ })

    fireEvent.contextMenu(card)
    expect(await screen.findByText('View Details')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('View Details')).not.toBeInTheDocument()
  })
})
