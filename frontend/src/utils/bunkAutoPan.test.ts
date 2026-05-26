/**
 * Tests for the bunk auto-pan utility.
 *
 * The bunk board has no inner overflow container — the page scrolls on the
 * document/window (the session header is `sticky top-0`). So auto-pan must
 * scroll the *element into the viewport*, NOT a wrapper div's scrollTop.
 *
 * These tests exercise that real contract: we stub the element's
 * getBoundingClientRect + the viewport height and assert the element's
 * scrollIntoView is (or isn't) invoked. JSDOM has no layout engine, so we
 * never assert pixels — only the scroll decision and target.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { findBunkElement, scrollBunkIntoView, autoPanToBunk } from './bunkAutoPan'

// ---------------------------------------------------------------------------
// findBunkElement
// ---------------------------------------------------------------------------

describe('findBunkElement', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
  })

  it('returns null when no element has the given bunk CM ID', () => {
    const card = document.createElement('div')
    card.setAttribute('data-bunk-cm-id', '9001')
    container.appendChild(card)
    expect(findBunkElement(9002, container)).toBeNull()
  })

  it('returns the element whose data-bunk-cm-id matches', () => {
    const card = document.createElement('div')
    card.setAttribute('data-bunk-cm-id', '9001')
    container.appendChild(card)
    expect(findBunkElement(9001, container)).toBe(card)
  })

  it('returns the correct element when multiple bunk cards exist', () => {
    const card1 = document.createElement('div')
    card1.setAttribute('data-bunk-cm-id', '9001')
    const card2 = document.createElement('div')
    card2.setAttribute('data-bunk-cm-id', '9002')
    container.appendChild(card1)
    container.appendChild(card2)
    expect(findBunkElement(9002, container)).toBe(card2)
  })

  it('returns null for an empty container', () => {
    expect(findBunkElement(9001, container)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// scrollBunkIntoView — scrolls the element into the viewport (window scroll)
// ---------------------------------------------------------------------------

/** Stub a fixed viewport height for the duration of a test. */
function setViewportHeight(height: number): void {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

function mockRect(el: Element, top: number, bottom: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect)
}

/** Attach a spy to an element's scrollIntoView and return the mock. */
function spyScrollIntoView(el: Element): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  el.scrollIntoView = spy as unknown as Element['scrollIntoView']
  return spy
}

describe('scrollBunkIntoView', () => {
  let bunkEl: HTMLDivElement
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    bunkEl = document.createElement('div')
    scrollIntoView = spyScrollIntoView(bunkEl)
    setViewportHeight(800)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scrolls the bunk to centre when it is below the fold', () => {
    mockRect(bunkEl, 1000, 1100) // entirely below the 800px viewport
    scrollBunkIntoView(bunkEl)
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('scrolls when the bunk is hidden behind the sticky header (near the top)', () => {
    mockRect(bunkEl, 8, 108) // top sits under the sticky header offset
    scrollBunkIntoView(bunkEl)
    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('does NOT scroll when the bunk is already fully visible below the header', () => {
    mockRect(bunkEl, 200, 400) // comfortably inside the viewport, clear of header
    scrollBunkIntoView(bunkEl)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not throw when scrollIntoView is unavailable', () => {
    // Simulate an environment without the scrollIntoView API.
    bunkEl.scrollIntoView = undefined as unknown as Element['scrollIntoView']
    mockRect(bunkEl, 1000, 1100)
    expect(() => scrollBunkIntoView(bunkEl)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// autoPanToBunk (high-level integration)
// ---------------------------------------------------------------------------

describe('autoPanToBunk', () => {
  beforeEach(() => {
    setViewportHeight(800)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-ops when bunkCmId is null', () => {
    const root = document.createElement('div')
    const card = document.createElement('div')
    card.setAttribute('data-bunk-cm-id', '9001')
    const scrollIntoView = spyScrollIntoView(card)
    root.appendChild(card)
    autoPanToBunk(null, root)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('no-ops when bunkCmId is undefined', () => {
    const root = document.createElement('div')
    expect(() => autoPanToBunk(undefined, root)).not.toThrow()
  })

  it('no-ops (does not throw) when the board root is null', () => {
    expect(() => autoPanToBunk(9001, null)).not.toThrow()
  })

  it('no-ops when no matching bunk element is found', () => {
    const root = document.createElement('div')
    const card = document.createElement('div')
    card.setAttribute('data-bunk-cm-id', '1111')
    const scrollIntoView = spyScrollIntoView(card)
    root.appendChild(card)
    autoPanToBunk(9999, root)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the matched bunk into view when it is off-screen', () => {
    const root = document.createElement('div')
    const card = document.createElement('div')
    card.setAttribute('data-bunk-cm-id', '9001')
    const scrollIntoView = spyScrollIntoView(card)
    root.appendChild(card)
    mockRect(card, 1000, 1100) // below the fold

    autoPanToBunk(9001, root)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('finds the element by cm_id and skips scrolling when it is already visible', () => {
    const root = document.createElement('div')
    const wrongCard = document.createElement('div')
    wrongCard.setAttribute('data-bunk-cm-id', '1111')
    const rightCard = document.createElement('div')
    rightCard.setAttribute('data-bunk-cm-id', '9001')
    const scrollIntoView = spyScrollIntoView(rightCard)
    root.appendChild(wrongCard)
    root.appendChild(rightCard)
    mockRect(rightCard, 200, 400) // fully visible

    autoPanToBunk(9001, root)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
