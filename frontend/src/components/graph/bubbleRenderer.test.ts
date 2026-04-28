/**
 * Tests for bubbleRenderer — unit/bunk label DOM construction.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildUnitLabel, buildBunkLabel, getLabelParent } from './bubbleRenderer'

describe('buildUnitLabel', () => {
  it('renders the unit name as text', () => {
    const el = buildUnitLabel('Galil', 'B', '#aabbcc')
    expect(el.textContent).toContain('Galil')
  })

  it('emits an SVG icon (mars/venus) instead of unicode text for the gender marker', () => {
    const boys = buildUnitLabel('Galil', 'B', '#aabbcc')
    const girls = buildUnitLabel('Galil', 'G', '#aabbcc')

    // Each label should contain at least one inline <svg> for the gender marker —
    // unicode glyphs (♂ / ♀) render too thin against the unit color stroke.
    expect(boys.querySelector('svg')).toBeTruthy()
    expect(girls.querySelector('svg')).toBeTruthy()
    // And the literal unicode glyphs must NOT appear.
    expect(boys.textContent).not.toContain('♂')
    expect(girls.textContent).not.toContain('♀')
  })

  it('marks boys vs girls icons distinctly so they are not interchangeable', () => {
    const boys = buildUnitLabel('Galil', 'B', '#aabbcc')
    const girls = buildUnitLabel('Galil', 'G', '#aabbcc')
    expect(boys.querySelector('svg')?.outerHTML).not.toBe(girls.querySelector('svg')?.outerHTML)
  })

  it('uses the unit color for both text and SVG stroke', () => {
    const el = buildUnitLabel('Galil', 'B', '#aabbcc')
    const svg = el.querySelector('svg')
    expect(svg?.getAttribute('stroke')).toBe('#aabbcc')
    // The label inner text wrapper should also color-match.
    expect((el.querySelector('div') as HTMLElement | null)?.style.color).toBe('rgb(170, 187, 204)')
  })
})

describe('buildBunkLabel', () => {
  it('renders the bunk name as text', () => {
    const el = buildBunkLabel('B-5', '#aabbcc')
    expect(el.textContent).toContain('B-5')
  })

  it('uses the bunk color as the background of the inner pill', () => {
    const el = buildBunkLabel('B-5', '#aabbcc')
    const inner = el.querySelector('div') as HTMLElement | null
    expect(inner?.style.backgroundColor).toBe('rgb(170, 187, 204)')
  })

  it('applies the .bunk-label-popper class to the outer wrapper', () => {
    const el = buildBunkLabel('B-5', '#aabbcc')
    expect(el.classList.contains('bunk-label-popper')).toBe(true)
  })
})

describe('getLabelParent', () => {
  let container: HTMLDivElement | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('returns the graph container when one is provided so labels are clipped + visible in fullscreen', () => {
    const parent = getLabelParent({ current: container })
    expect(parent).toBe(container)
    expect(parent).not.toBe(document.body)
  })

  it('falls back to document.body when no container ref is provided so labels still render', () => {
    const parent = getLabelParent({ current: null })
    expect(parent).toBe(document.body)
  })
})
