/**
 * Ctrl+click on a locked camper: opens the LockGroupPanel and selects that
 * camper's group (so its row auto-expands via the existing
 * `expandedGroupId = selectedGroupId ?? localExpandedGroupId` logic).
 *
 * Today (pre-change) this is a no-op; only the right-click "Manage Friend
 * Group" item does this.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLockGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }
const setSelectedGroupId = vi.fn()
const setIsLockPanelOpen = vi.fn()
const addPendingCamper = vi.fn()
const removePendingCamper = vi.fn()

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
    addPendingCamper,
    removePendingCamper,
    getPendingAnimationDelay: () => 0,
    groups: [mockLockGroup],
    addCamperToGroup: () => {},
    getCamperLockGroup: (cmId: number) => (cmId === 1000001 ? mockLockGroup : null),
    getCamperLockState: (cmId: number) => (cmId === 1000001 ? 'locked' : 'none'),
    getCamperLockGroupColor: () => undefined,
    getGroupMembers: () => [],
    selectedGroupId: null,
    setSelectedGroupId,
    isLockPanelOpen: false,
    setIsLockPanelOpen,
    isDraftMode: true,
  }),
}))

vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
    getSatisfiedRequestInfo: () => null,
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import CamperCard from './CamperCard'
import type { Camper } from '../types/app-types'

const lockedCamper: Camper = {
  id: 'pb-1',
  person_cm_id: 1000001,
  name: 'Emma Johnson',
  grade: 5,
  gender: 'F',
  assigned_bunk: '',
  assigned_bunk_cm_id: null,
} as unknown as Camper

beforeEach(() => {
  setSelectedGroupId.mockReset()
  setIsLockPanelOpen.mockReset()
  addPendingCamper.mockReset()
  removePendingCamper.mockReset()
})

describe('CamperCard Ctrl+click on locked camper', () => {
  it("sets selectedGroupId to that camper's group and opens the panel", () => {
    render(<CamperCard camper={lockedCamper} lockState="locked" isDraftMode={true} />)
    const card = screen.getByText('Emma Johnson').closest('[data-camper-card]') as HTMLElement
    fireEvent.click(card, { ctrlKey: true })
    expect(setSelectedGroupId).toHaveBeenCalledWith('group-abc')
    expect(setIsLockPanelOpen).toHaveBeenCalledWith(true)
  })

  it('does not change pending list', () => {
    render(<CamperCard camper={lockedCamper} lockState="locked" isDraftMode={true} />)
    const card = screen.getByText('Emma Johnson').closest('[data-camper-card]') as HTMLElement
    fireEvent.click(card, { ctrlKey: true })
    expect(addPendingCamper).not.toHaveBeenCalled()
    expect(removePendingCamper).not.toHaveBeenCalled()
  })
})
