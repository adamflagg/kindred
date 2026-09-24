/**
 * kindred#2237 — CamperCard's right-click context menu and the kindred#2205
 * overlay token stack.
 *
 * The menu is rendered by cards INSIDE the expanded `ui/FloatingQueueBadge`
 * queue (see `FloatingUnassignedBadge`, which renders CamperCard rows straight
 * into the badge's popover). Both surfaces listened on `document` in the
 * bubble phase and neither stopped propagation, so a single Escape closed the
 * context menu AND collapsed the queue it was opened from — the kindred#2205
 * double-close, still live on the board.
 *
 * The menu is the overlay that sits ON TOP, so it is the one that needs the
 * token: once it swallows the key while topmost, the badge beneath it never
 * sees the press and needs no token of its own.
 *
 * Fictional data throughout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import CamperCard from './CamperCard'
import { acquireOverlayToken, hasOpenModal, releaseOverlayToken } from './ui/modalStack'
import { mockCamper } from '../test/mockData'
import { emptyCamperSatisfaction } from '../types/satisfaction'

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

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

describe('CamperCard — context-menu overlay token (kindred#2237)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * `handleContextMenu` defers the open by one `requestAnimationFrame` (it
   * broadcasts `closeAllContextMenus` first and lets that settle), so every
   * test has to wait for the menu rather than assert synchronously.
   */
  async function openMenu() {
    const view = render(<CamperCard camper={mockCamper({ person_cm_id: 9001 })} isDraftMode />)
    const card = document.querySelector('[data-camper-card], button') as HTMLElement
    fireEvent.contextMenu(card)
    await waitFor(() => {
      expect(screen.getByText('View Details')).toBeInTheDocument()
    })
    return view
  }

  it('closes the menu on Escape when it is the only open overlay', async () => {
    await openMenu()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('View Details')).not.toBeInTheDocument()
    })
  })

  it('does NOT close once an overlay has opened on top of it', async () => {
    await openMenu()

    const topToken = acquireOverlayToken()
    try {
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.getByText('View Details')).toBeInTheDocument()
    } finally {
      releaseOverlayToken(topToken)
    }
  })

  // The defect this issue is actually about: the expanded FloatingQueueBadge
  // beneath the menu listens on `document` too. While the menu is topmost it
  // must swallow the key so the queue does not collapse alongside it.
  it('swallows the key while topmost, so the queue beneath does not also close', async () => {
    const beneath = vi.fn()
    document.addEventListener('keydown', beneath)
    try {
      await openMenu()

      fireEvent.keyDown(document, { key: 'Escape' })

      const escapes = beneath.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')
      expect(escapes).toHaveLength(0)
    } finally {
      document.removeEventListener('keydown', beneath)
    }
  })

  // A leaked token is invisible to a "does it still close?" test — a newly
  // acquired token is always last in the stack, so the freshly-opened menu is
  // topmost either way. Only the emptiness of the stack catches it.
  it('releases its overlay token on unmount, so the stack does not leak', async () => {
    const { unmount } = await openMenu()
    expect(hasOpenModal()).toBe(true)

    unmount()

    expect(hasOpenModal()).toBe(false)
  })

  it('registers no token while the context menu is closed', () => {
    render(<CamperCard camper={mockCamper({ person_cm_id: 9002 })} isDraftMode />)
    expect(hasOpenModal()).toBe(false)
  })
})

// The 21+ age rule is global (owner ruling 2026-09-22: cutoff raised from 18
// to 21 -- teens 18-20 are still campers in summer and teen programs): at 21
// and over the display drops the yy.mm months ("21.02" reads "21");
// under 21 the full yy.mm stays.
describe('CamperCard — age line', () => {
  beforeEach(() => {
    // getDisplayAgeForYear adjusts by (calendar year - viewing year); pin the
    // calendar to the mocked viewing year so the stored age shows as-is.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2025-07-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops the months at 21 and over', () => {
    // Ruled change: was age 18.02 / "Age 18" under the old 18 cutoff.
    render(<CamperCard camper={mockCamper({ person_cm_id: 9003, age: 21.02, grade: 12 })} />)
    expect(screen.getByText(/^Age 21 •/)).toBeInTheDocument()
    expect(screen.queryByText(/21\.02/)).toBeNull()
  })

  it('keeps yy.mm under 21', () => {
    render(<CamperCard camper={mockCamper({ person_cm_id: 9004, age: 11.06, grade: 6 })} />)
    expect(screen.getByText(/^Age 11\.06 •/)).toBeInTheDocument()
  })
})
