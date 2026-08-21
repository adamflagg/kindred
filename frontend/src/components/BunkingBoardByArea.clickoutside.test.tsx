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

describe('weekend lodging board click-outside predicate', () => {
  it('keeps the family details panel open on a click inside it', () => {
    // Not every click inside the panel lands on a button — the request-text
    // blockquote and the children list are plain text, and dismissing on
    // those would make the panel feel broken.
    const panel = document.createElement('div')
    panel.setAttribute('data-panel', 'family-details')
    const text = document.createElement('blockquote')
    panel.appendChild(text)
    document.body.appendChild(panel)
    expect(shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: text })).toBe(true)
    panel.remove()
  })

  it('keeps panels open when the click lands on a family card', () => {
    const card = document.createElement('div')
    card.setAttribute('data-family-card', '')
    const name = document.createElement('span')
    card.appendChild(name)
    document.body.appendChild(card)
    expect(shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: name })).toBe(true)
    card.remove()
  })
  it('keeps the panel open when the click detached its own target, as the fold chevron does', () => {
    // Regression for #2476, reported from the weekend board: clicking the fold
    // chevron in `ShareRequestPanel` dismissed `FamilyDetailsPanel` instead of
    // collapsing the block, while clicking the block's NAME — same `<button>`,
    // a few pixels to the right — collapsed correctly. That reads like a
    // geometry bug and is emphatically not one.
    //
    // `ChevronDown` and `ChevronRight` are DIFFERENT component types, so
    // toggling unmounts one `<svg>` and mounts the other instead of mutating
    // it in place. React flushes that re-render synchronously for a discrete
    // event at its root-container listener, which sits BELOW `document` — so
    // by the time the same native click reaches the dead-space listener on
    // `document`, `event.target` is an orphan. `closest()` on an orphan walks
    // a tree with no ancestors and matches NOTHING: not the `[data-panel]`
    // wrapper, not the `<button>`. The predicate then reads a click on an
    // interactive control inside a panel as dead space.
    //
    // Confirmed in a real browser (React 19): the chevron click reports
    // `isConnected === false`, the label click `true`. jsdom cannot reproduce
    // it, because Testing Library's `act()` defers the re-render until after
    // the whole dispatch, leaving the node attached — which is why this is
    // pinned here, on the predicate, rather than through the hook.
    const panel = document.createElement('div')
    panel.setAttribute('data-panel', 'family-details')
    const button = document.createElement('button')
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    button.appendChild(chevron)
    panel.appendChild(button)
    document.body.appendChild(panel)

    // What React does between the click and the document listener.
    chevron.remove()

    expect(shouldKeepPanelsOpen({ ctrlKey: false, metaKey: false, target: chevron })).toBe(true)
    panel.remove()
  })
})

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
