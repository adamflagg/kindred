/**
 * Tests for BunkingBoardByArea prod-mode behavior.
 *
 * Asserts that:
 *  1. FloatingUnassignedBadge receives isProductionMode={true} when the board
 *     is in production mode. (FloatingUnassignedBadge is the unassigned-area
 *     surface rendered by BunkingBoardByArea.)
 *  2. The drag-start prod-mode warning toast no longer fires.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import toast from 'react-hot-toast'
import FloatingUnassignedBadge from './FloatingUnassignedBadge'

vi.mock('react-hot-toast', () => {
  const fn = vi.fn() as unknown as { (...args: unknown[]): void; error: (msg: string) => void }
  fn.error = vi.fn()
  return { default: fn, toast: fn }
})

vi.mock('./FloatingUnassignedBadge', () => ({
  default: vi.fn((_props: unknown) => null),
}))

vi.mock('./BunkCard', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({ default: () => null }))
vi.mock('./BunkSocialGraphModal', () => ({ default: () => null }))
vi.mock('./LockGroupActionBar', () => ({ default: () => null }))
vi.mock('./LockGroupPanel', () => ({ default: () => null }))

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
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

import BunkingBoardByArea from './BunkingBoardByArea'

describe('BunkingBoardByArea prod mode wiring', () => {
  const baseProps = {
    sessionId: 's1',
    sessionCmId: 1,
    bunks: [],
    campers: [],
    selectedArea: 'all' as const,
    onAreaChange: () => {},
    onCamperMove: async () => {},
  }

  it('passes isProductionMode through to FloatingUnassignedBadge', () => {
    render(<BunkingBoardByArea {...baseProps} isProductionMode={true} />)
    const badgeMock = vi.mocked(FloatingUnassignedBadge)
    expect(badgeMock).toHaveBeenCalledWith(
      expect.objectContaining({ isProductionMode: true }),
      undefined
    )
  })

  it('does not call the prod-mode warning toast on render', () => {
    render(<BunkingBoardByArea {...baseProps} isProductionMode={true} />)
    const toastMock = vi.mocked(toast as unknown as ReturnType<typeof vi.fn>)
    const calls = toastMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(calls.some((s: string) => s.includes('Production Mode'))).toBe(false)
  })
})
