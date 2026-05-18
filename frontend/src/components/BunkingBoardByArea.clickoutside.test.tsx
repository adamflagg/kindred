/**
 * Click-outside behavior on the board:
 *   - Ctrl/Meta-modified clicks must NOT dismiss CamperDetailsPanel or LockGroupPanel
 *     (those keys are reserved for the friend-group selection workflow).
 *   - Clicks landing on a [data-panel="lock-action-bar"] element must NOT dismiss
 *     either side panel.
 *   - Clicks landing on a [data-panel="lock-group-picker"] element (the portaled
 *     AddMemberPicker dropdown) must NOT dismiss either side panel.
 *
 * Both behaviors are wired in BunkingBoardByArea.handleGlobalClick via the
 * shared shouldKeepPanelsOpen predicate.
 */
import { describe, it, expect } from 'vitest'
import { shouldKeepPanelsOpen } from '../utils/clickoutsidePredicate'

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

  it('keeps panels open on click inside the AddMemberPicker portal (lock-group-picker)', () => {
    const portal = document.createElement('div')
    portal.setAttribute('data-panel', 'lock-group-picker')
    // Non-interactive child: a span. Without the data-panel whitelist this
    // would close the panels.
    const child = document.createElement('span')
    portal.appendChild(child)
    document.body.appendChild(portal)
    const result = shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: child })
    expect(result).toBe(true)
    portal.remove()
  })

  it('closes panels on plain click on empty board area', () => {
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    const result = shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: empty })
    expect(result).toBe(false)
    empty.remove()
  })
})
