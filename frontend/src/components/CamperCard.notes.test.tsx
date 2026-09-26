/**
 * Board notes on the summer camper card. The pixel snapshot is recorded
 * BEFORE CamperCard gains the slot prop. Never run with -u. Fictional data.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CamperCard from './CamperCard'
import { mockCamper } from '../test/mockData'
import { emptyCamperSatisfaction } from '../types/satisfaction'

const setNodeRef = vi.hoisted(() => vi.fn())
const dragStart = vi.hoisted(() => vi.fn())
const SORTABLE = vi.hoisted(() => ({
  attributes: {},
  listeners: { onPointerDown: (...a: unknown[]) => dragStart(...a) },
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
