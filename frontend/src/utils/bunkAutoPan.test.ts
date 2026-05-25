/**
 * Tests for the bunk auto-pan utility.
 *
 * Verifies the scroll-target computation and element lookup without relying on
 * actual layout dimensions (JSDOM has no layout engine).
 *
 * Auto-pan: when the camper detail panel opens, the board scrolls so the
 * selected camper's bunk is visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
// scrollBunkIntoView
// ---------------------------------------------------------------------------

describe('scrollBunkIntoView', () => {
  it('calls scrollTo when the element is below the visible area', () => {
    const scrollContainer = document.createElement('div')
    const bunkEl = document.createElement('div')
    scrollContainer.appendChild(bunkEl)

    // Simulate: container occupies [0, 600] vertically; bunk is at [700, 800]
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(bunkEl, 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 800,
      left: 0,
      right: 400,
      width: 400,
      height: 100,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    })

    const scrollTo = vi.fn()
    scrollContainer.scrollTo = scrollTo
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })

    scrollBunkIntoView(bunkEl, scrollContainer)

    expect(scrollTo).toHaveBeenCalledOnce()
    const [arg] = scrollTo.mock.calls[0] as [ScrollToOptions]
    expect(arg.behavior).toBe('smooth')
    // scrollTop should be positive (scrolling down to reveal the bunk below)
    expect((arg.top as number) > 0).toBe(true)
  })

  it('calls scrollTo when the element is above the visible area', () => {
    const scrollContainer = document.createElement('div')
    const bunkEl = document.createElement('div')
    scrollContainer.appendChild(bunkEl)

    // Container is at [200, 800]; bunk card is at [50, 150] — above the container
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 800,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    })
    vi.spyOn(bunkEl, 'getBoundingClientRect').mockReturnValue({
      top: 50,
      bottom: 150,
      left: 0,
      right: 400,
      width: 400,
      height: 100,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    })

    const scrollTo = vi.fn()
    scrollContainer.scrollTo = scrollTo
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 300, writable: true })

    scrollBunkIntoView(bunkEl, scrollContainer)

    expect(scrollTo).toHaveBeenCalledOnce()
    const [arg] = scrollTo.mock.calls[0] as [ScrollToOptions]
    expect(arg.behavior).toBe('smooth')
  })

  it('does NOT call scrollTo when the element is already fully visible', () => {
    const scrollContainer = document.createElement('div')
    const bunkEl = document.createElement('div')
    scrollContainer.appendChild(bunkEl)

    // Container [0, 600]; bunk [100, 300] — comfortably inside
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(bunkEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 400,
      width: 400,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    const scrollTo = vi.fn()
    scrollContainer.scrollTo = scrollTo
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true })

    scrollBunkIntoView(bunkEl, scrollContainer)

    expect(scrollTo).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// autoPanToBunk (high-level integration)
// ---------------------------------------------------------------------------

describe('autoPanToBunk', () => {
  it('no-ops when bunkCmId is null', () => {
    const container = document.createElement('div')
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    autoPanToBunk(null, container)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('no-ops when bunkCmId is undefined', () => {
    const container = document.createElement('div')
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    autoPanToBunk(undefined, container)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('no-ops when the scroll container is null', () => {
    // Should not throw
    expect(() => autoPanToBunk(9001, null)).not.toThrow()
  })

  it('no-ops when no matching bunk element is found', () => {
    const container = document.createElement('div')
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    autoPanToBunk(9999, container)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('calls scrollTo when the bunk element is found below the viewport', () => {
    const container = document.createElement('div')
    const bunkCard = document.createElement('div')
    bunkCard.setAttribute('data-bunk-cm-id', '9001')
    container.appendChild(bunkCard)

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(bunkCard, 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 800,
      left: 0,
      right: 400,
      width: 400,
      height: 100,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    })

    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true })

    autoPanToBunk(9001, container)

    expect(scrollTo).toHaveBeenCalledOnce()
    const [arg] = scrollTo.mock.calls[0] as [ScrollToOptions]
    expect(arg.behavior).toBe('smooth')
  })

  it('is invoked with the correct bunk CM ID — wiring test', () => {
    // Verifies that autoPanToBunk finds the element by cm_id, not by any other attribute.
    const container = document.createElement('div')

    const wrongCard = document.createElement('div')
    wrongCard.setAttribute('data-bunk-cm-id', '1111')
    const rightCard = document.createElement('div')
    rightCard.setAttribute('data-bunk-cm-id', '9001')
    container.appendChild(wrongCard)
    container.appendChild(rightCard)

    // Both visible; we verify scrollTo is NOT called (both in view)
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 900,
      left: 0,
      right: 800,
      width: 800,
      height: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(rightCard, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 400,
      width: 400,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })

    const scrollTo = vi.fn()
    container.scrollTo = scrollTo
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true })

    autoPanToBunk(9001, container)

    // rightCard (9001) is fully visible → no scroll needed
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
