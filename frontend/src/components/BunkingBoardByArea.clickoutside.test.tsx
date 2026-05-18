/**
 * Click-outside behavior on the board:
 *   - Ctrl/Meta-modified clicks must NOT dismiss CamperDetailsPanel or LockGroupPanel
 *     (those keys are reserved for the friend-group selection workflow).
 *   - Clicks landing on a [data-panel="lock-action-bar"] element must NOT dismiss
 *     either side panel.
 *
 * Both behaviors are wired in BunkingBoardByArea.handleGlobalClick.
 */
import { describe, it, expect } from 'vitest'

/**
 * Mirrors the predicate inside BunkingBoardByArea.handleGlobalClick.
 * If you change either one, change the other.
 *
 * Returns true iff the click should NOT trigger a panel dismiss.
 */
function shouldKeepPanelsOpen(e: {
  ctrlKey: boolean
  metaKey: boolean
  target: HTMLElement
}): boolean {
  if (e.ctrlKey || e.metaKey) return true
  const t = e.target
  const isOnPanel = t.closest(
    '[data-panel="camper-details"], [data-panel="lock-group"], [data-panel="lock-action-bar"]'
  )
  const isOnFloatingBadge = t.closest('[data-floating-badge]')
  const isInteractive = t.closest(
    'button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"]'
  )
  const isContextMenu = t.closest('[data-context-menu]')
  const isModal = t.closest('[role="dialog"]')
  const isCard = t.closest('[data-camper-card], [data-bunk-card]')
  return Boolean(
    isOnPanel || isOnFloatingBadge || isInteractive || isContextMenu || isModal || isCard
  )
}

describe('BunkingBoardByArea click-outside predicate', () => {
  it('keeps panels open on Ctrl+click', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const result = shouldKeepPanelsOpen({ ctrlKey: true, metaKey: false, target })
    expect(result).toBe(true)
    target.remove()
  })

  it('keeps panels open on Meta+click (macOS)', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const result = shouldKeepPanelsOpen({ ctrlKey: false, metaKey: true, target })
    expect(result).toBe(true)
    target.remove()
  })

  it('keeps panels open on click inside lock-action-bar', () => {
    const bar = document.createElement('div')
    bar.setAttribute('data-panel', 'lock-action-bar')
    const child = document.createElement('span')
    bar.appendChild(child)
    document.body.appendChild(bar)
    const result = shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: child })
    expect(result).toBe(true)
    bar.remove()
  })

  it('closes panels on plain click on empty board area', () => {
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    const result = shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: empty })
    expect(result).toBe(false)
    empty.remove()
  })
})
