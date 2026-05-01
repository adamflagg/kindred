/**
 * Tests for the session graph PNG export pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  stripSvgWrapper,
  readBubbleTransform,
  readLabelLayer,
  exportSessionGraphPng,
} from './graphPngExport'

describe('stripSvgWrapper', () => {
  it('removes the outer <svg> tags and returns inner content', () => {
    const inner = '<g><circle r="5" /></g>'
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">${inner}</svg>`
    expect(stripSvgWrapper(wrapped)).toBe(inner)
  })

  it('preserves attributes on inner elements', () => {
    const wrapped =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10" stroke="red" /></svg>'
    expect(stripSvgWrapper(wrapped)).toBe('<path d="M0 0 L10 10" stroke="red" />')
  })

  it('returns the input unchanged when there is no <svg> wrapper', () => {
    expect(stripSvgWrapper('<g></g>')).toBe('<g></g>')
  })
})

describe('readBubbleTransform', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('returns "" when the container has no <svg> child', () => {
    expect(readBubbleTransform(container)).toBe('')
  })

  it('extracts a matrix(...) transform from the wrapper svg', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.transform = 'matrix(2, 0, 0, 2, 100, 50)'
    container.appendChild(svg)
    expect(readBubbleTransform(container)).toBe('matrix(2, 0, 0, 2, 100, 50)')
  })

  it('extracts a translate(...) scale(...) transform', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.transform = 'translate(10px, 20px) scale(1.5)'
    container.appendChild(svg)
    expect(readBubbleTransform(container)).toBe('translate(10px, 20px) scale(1.5)')
  })

  it('returns "" when the wrapper svg has no transform set', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    container.appendChild(svg)
    expect(readBubbleTransform(container)).toBe('')
  })
})

describe('readLabelLayer', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    document.body.appendChild(container)
  })

  function makeBunkLabel(text: string, bg: string, atX: number, atY: number): HTMLElement {
    const outer = document.createElement('div')
    outer.className = 'bunk-label-popper'
    const inner = document.createElement('div')
    Object.assign(inner.style, {
      backgroundColor: bg,
      color: 'white',
      padding: '4px 12px',
      borderRadius: '16px',
      fontSize: '12px',
      fontWeight: '600',
    })
    inner.textContent = text
    outer.appendChild(inner)
    Object.defineProperty(outer, 'getBoundingClientRect', {
      value: () =>
        ({
          left: atX,
          top: atY,
          right: atX + 60,
          bottom: atY + 20,
          width: 60,
          height: 20,
          x: atX,
          y: atY,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    container.appendChild(outer)
    return outer
  }

  it('returns an empty <g> when there are no labels', () => {
    expect(readLabelLayer(container)).toBe('<g></g>')
  })

  it('emits one <rect> + <text> per bunk label, positioned relative to the container', () => {
    makeBunkLabel('Bunk 7', 'rgb(200, 50, 50)', 100, 200)
    const out = readLabelLayer(container)
    expect(out).toContain('<g>')
    expect(out).toContain('</g>')
    expect(out).toMatch(/<rect[^>]+x="100"/)
    expect(out).toMatch(/<rect[^>]+y="200"/)
    expect(out).toMatch(/<rect[^>]+width="60"/)
    expect(out).toMatch(/<rect[^>]+height="20"/)
    expect(out).toMatch(/<rect[^>]+rx="16"/)
    expect(out).toMatch(/<rect[^>]+fill="rgb\(200, 50, 50\)"/)
    expect(out).toContain('>Bunk 7</text>')
  })

  it('escapes XML special characters in the label text', () => {
    makeBunkLabel('A & B <C>', '#000', 0, 0)
    const out = readLabelLayer(container)
    expect(out).toContain('A &amp; B &lt;C&gt;')
    expect(out).not.toContain('A & B <C>')
  })

  it('emits one entry per label when there are several bunks', () => {
    makeBunkLabel('Bunk 1', '#111', 10, 10)
    makeBunkLabel('Bunk 2', '#222', 20, 20)
    makeBunkLabel('Bunk 3', '#333', 30, 30)
    const out = readLabelLayer(container)
    expect((out.match(/<rect/g) ?? []).length).toBe(3)
    expect((out.match(/<text/g) ?? []).length).toBe(3)
  })

  function makeUnitLabel(text: string, color: string, atX: number, atY: number): HTMLElement {
    const outer = document.createElement('div')
    outer.className = 'unit-label-popper'
    Object.assign(outer.style, {
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      padding: '2px 10px',
      borderRadius: '10px',
      border: `2px solid ${color}`,
    })
    const innerText = document.createElement('div')
    innerText.style.color = color
    innerText.style.fontWeight = '700'
    innerText.style.fontSize = '13px'
    innerText.textContent = text
    outer.appendChild(innerText)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '14')
    svg.setAttribute('height', '14')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('stroke', color)
    svg.innerHTML = '<circle cx="10" cy="14" r="6"/>'
    outer.appendChild(svg)
    Object.defineProperty(outer, 'getBoundingClientRect', {
      value: () =>
        ({
          left: atX,
          top: atY,
          right: atX + 80,
          bottom: atY + 22,
          width: 80,
          height: 22,
          x: atX,
          y: atY,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    container.appendChild(outer)
    return outer
  }

  it('emits a <rect> with stroke + <text> + inlined marker SVG for a unit label', () => {
    makeUnitLabel('Galil', 'rgb(50, 100, 200)', 50, 80)
    const out = readLabelLayer(container)
    expect(out).toMatch(/<rect[^>]+x="50"/)
    expect(out).toMatch(/<rect[^>]+y="80"/)
    expect(out).toMatch(/<rect[^>]+stroke="rgb\(50, 100, 200\)"/)
    expect(out).toMatch(/<rect[^>]+stroke-width="2"/)
    expect(out).toMatch(/<rect[^>]+fill="rgba\(255, 255, 255, 0.85\)"/)
    expect(out).toContain('>Galil</text>')
    // jsdom normalizes self-closing SVG tags to explicit close tags
    expect(out).toMatch(/<circle\s+cx="10"\s+cy="14"\s+r="6"(?:\s*\/>|><\/circle>)/)
  })

  it('handles bunk and unit labels in the same container', () => {
    makeBunkLabel('Bunk 7', '#a00', 0, 0)
    makeUnitLabel('Galil', '#00a', 100, 100)
    const out = readLabelLayer(container)
    expect((out.match(/<rect/g) ?? []).length).toBe(2)
    expect(out).toContain('Bunk 7')
    expect(out).toContain('Galil')
  })
})

describe('composite SVG layer order', () => {
  /**
   * Bubble layer (bunk + unit boundaries) must paint *behind* cyInner (camper
   * nodes/edges/labels) so unit bubble strokes don't cut through camper names.
   * This matches the live view, where cytoscape-bubblesets renders below
   * cytoscape's canvas. SVG paints back-to-front, so order in the document =
   * order in paint.
   */
  let container: HTMLElement
  let capturedSvg: string

  beforeEach(() => {
    capturedSvg = ''
    container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    // Add a bubblesets-style wrapper svg with one identifiable child path so
    // the bubble layer in the composite is non-empty and detectable.
    const bubbleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    bubbleSvg.innerHTML = '<path data-bubble-marker="1" d="M0 0"/>'
    container.appendChild(bubbleSvg)
    document.body.appendChild(container)

    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test') })
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn() })
    }
    // Capture the composite SVG by intercepting the Blob constructor input.
    const OriginalBlob = global.Blob
    Object.defineProperty(global, 'Blob', {
      writable: true,
      value: class FakeBlob extends OriginalBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts)
          if (opts?.type?.includes('svg')) {
            capturedSvg = parts.map(String).join('')
          }
        }
      },
    })
    Object.defineProperty(global, 'Image', {
      writable: true,
      value: class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    })
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['fake-png'], { type: 'image/png' }))
    }
    HTMLCanvasElement.prototype.getContext = function (contextId: string) {
      if (contextId === '2d') {
        return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
      }
      return null
    } as typeof HTMLCanvasElement.prototype.getContext
  })

  function makeFakeCy(svg: string) {
    return {
      svg: vi.fn(() => svg),
      fit: vi.fn(),
      zoom: vi.fn(() => 1),
      pan: vi.fn(() => ({ x: 0, y: 0 })),
      destroyed: vi.fn(() => false),
    } as unknown as Parameters<typeof exportSessionGraphPng>[0]
  }

  it('places bubble layer before cyInner so bubbles paint behind camper names', async () => {
    const cyMarker = '<circle data-cy-marker="1" r="5"/>'
    const cy = makeFakeCy(`<svg width="100" height="100">${cyMarker}</svg>`)
    await exportSessionGraphPng(cy, container, 'viewport')

    const bubbleIdx = capturedSvg.indexOf('data-bubble-marker')
    const cyIdx = capturedSvg.indexOf('data-cy-marker')

    expect(bubbleIdx).toBeGreaterThan(-1)
    expect(cyIdx).toBeGreaterThan(-1)
    // Bubble layer must appear earlier in the document than cytoscape content.
    expect(bubbleIdx).toBeLessThan(cyIdx)
  })
})

describe('exportSessionGraphPng - viewport mode', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    document.body.appendChild(container)
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test') })
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn() })
    }
    Object.defineProperty(global, 'Image', {
      writable: true,
      value: class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    })
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['fake-png'], { type: 'image/png' }))
    }
    HTMLCanvasElement.prototype.getContext = function (contextId: string) {
      if (contextId === '2d') {
        return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
      }
      return null
    } as typeof HTMLCanvasElement.prototype.getContext
  })

  function makeFakeCy(svg: string) {
    return {
      svg: vi.fn(() => svg),
      fit: vi.fn(),
      zoom: vi.fn(() => 1),
      pan: vi.fn(() => ({ x: 0, y: 0 })),
      destroyed: vi.fn(() => false),
    } as unknown as Parameters<typeof exportSessionGraphPng>[0]
  }

  it('does not call cy.fit() in viewport mode', async () => {
    const cy = makeFakeCy('<svg width="100" height="100"><circle r="5"/></svg>')
    await exportSessionGraphPng(cy, container, 'viewport')
    expect((cy as unknown as { fit: ReturnType<typeof vi.fn> }).fit).not.toHaveBeenCalled()
  })

  it('does not change cy.zoom() or cy.pan() in viewport mode', async () => {
    const cy = makeFakeCy('<svg width="100" height="100"></svg>')
    await exportSessionGraphPng(cy, container, 'viewport')
    const fakeCy = cy as unknown as {
      zoom: ReturnType<typeof vi.fn>
      pan: ReturnType<typeof vi.fn>
    }
    fakeCy.zoom.mock.calls.forEach((args) => expect(args).toHaveLength(0))
    fakeCy.pan.mock.calls.forEach((args) => expect(args).toHaveLength(0))
  })

  it('resolves to a Blob', async () => {
    const cy = makeFakeCy('<svg width="100" height="100"></svg>')
    const result = await exportSessionGraphPng(cy, container, 'viewport')
    expect(result).toBeInstanceOf(Blob)
  })

  it('throws a clear message when cy.svg is not registered', async () => {
    const cyBroken = {
      svg: undefined,
      destroyed: () => false,
    } as unknown as Parameters<typeof exportSessionGraphPng>[0]
    await expect(exportSessionGraphPng(cyBroken, container, 'viewport')).rejects.toThrow(
      /cytoscape-svg/
    )
  })
})

describe('exportSessionGraphPng - fit mode', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () =>
        ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    })
    document.body.appendChild(container)
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test') })
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn() })
    }
    Object.defineProperty(global, 'Image', {
      writable: true,
      value: class FakeImage {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    })
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['fake-png'], { type: 'image/png' }))
    }
    HTMLCanvasElement.prototype.getContext = function (contextId: string) {
      if (contextId === '2d') {
        return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
      }
      return null
    } as typeof HTMLCanvasElement.prototype.getContext
  })

  function makeFakeCyTracking() {
    const state = { zoom: 1.5, pan: { x: 100, y: 50 } }
    return {
      state,
      cy: {
        svg: vi.fn(() => '<svg width="100" height="100"></svg>'),
        fit: vi.fn(),
        zoom: vi.fn((z?: number) => {
          if (typeof z === 'number') state.zoom = z
          return state.zoom
        }),
        pan: vi.fn((p?: { x: number; y: number }) => {
          if (p) state.pan = p
          return state.pan
        }),
        destroyed: vi.fn(() => false),
      } as unknown as Parameters<typeof exportSessionGraphPng>[0],
    }
  }

  it('calls cy.fit() exactly once in fit mode', async () => {
    const { cy } = makeFakeCyTracking()
    await exportSessionGraphPng(cy, container, 'fit')
    expect((cy as unknown as { fit: ReturnType<typeof vi.fn> }).fit).toHaveBeenCalledTimes(1)
  })

  it('restores cy.zoom and cy.pan after a successful fit-mode export', async () => {
    const { cy, state } = makeFakeCyTracking()
    const originalZoom = state.zoom
    const originalPan = { ...state.pan }
    ;(
      cy as unknown as { fit: { mockImplementation: (fn: () => void) => void } }
    ).fit.mockImplementation(() => {
      state.zoom = 0.5
      state.pan = { x: 0, y: 0 }
    })

    await exportSessionGraphPng(cy, container, 'fit')

    expect(state.zoom).toBe(originalZoom)
    expect(state.pan).toEqual(originalPan)
  })

  it('restores cy.zoom and cy.pan even when rasterization throws', async () => {
    const { cy, state } = makeFakeCyTracking()
    const originalZoom = state.zoom
    const originalPan = { ...state.pan }
    ;(
      cy as unknown as { fit: { mockImplementation: (fn: () => void) => void } }
    ).fit.mockImplementation(() => {
      state.zoom = 0.5
      state.pan = { x: 0, y: 0 }
    })
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null)
    }

    await expect(exportSessionGraphPng(cy, container, 'fit')).rejects.toThrow()

    expect(state.zoom).toBe(originalZoom)
    expect(state.pan).toEqual(originalPan)
  })

  it('falls through gracefully when cy.fit() throws', async () => {
    const { cy } = makeFakeCyTracking()
    ;(
      cy as unknown as { fit: { mockImplementation: (fn: () => void) => void } }
    ).fit.mockImplementation(() => {
      throw new Error('zero nodes')
    })
    const result = await exportSessionGraphPng(cy, container, 'fit')
    expect(result).toBeInstanceOf(Blob)
  })
})
