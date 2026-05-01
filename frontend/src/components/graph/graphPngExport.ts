/**
 * PNG export for the session social network graph.
 *
 * Composes three layers — cytoscape (camper nodes + edges), the
 * cytoscape-bubblesets <svg> overlay (bunk + unit boundaries), and the
 * popper-positioned bunk/unit label divs — into a single SVG document, then
 * rasterizes that document to PNG. The intermediate is vector, so the final
 * raster step stays sharp at any chosen scale.
 */
import type { Core } from 'cytoscape'

export type ExportMode = 'fit' | 'viewport'

const EXPORT_SCALE = 2

/** cytoscape-svg attaches a `.svg(options)` method on Core when registered. */
type CytoscapeWithSvg = Core & {
  svg: (options: { full?: boolean; scale?: number; bg?: string }) => string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load image for graph export'))
    img.src = src
  })
}

/** Strip the outer `<svg ...>` wrapper from a cytoscape-svg output, leaving
 *  just the inner content so the caller can re-wrap with a known viewBox. */
export function stripSvgWrapper(svgString: string): string {
  const openMatch = svgString.match(/<svg[^>]*>/)
  if (openMatch?.index === undefined) return svgString
  const end = svgString.lastIndexOf('</svg>')
  if (end < 0) return svgString
  return svgString.slice(openMatch.index + openMatch[0].length, end)
}

/**
 * Read the CSS transform applied by cytoscape-bubblesets to its wrapper <svg>.
 * Bubbleset paths are stored in cytoscape model coordinates; the wrapper SVG's
 * transform pulls them into viewport pixel space. We re-apply this transform
 * as an SVG attribute on the composite's bubble-layer <g> so the same
 * coordinate alignment is preserved through SVG -> PNG rasterization.
 */
export function readBubbleTransform(container: HTMLElement): string {
  const svg = container.querySelector('svg')
  if (!svg) return ''
  const inline = (svg as SVGElement).style.transform
  if (inline) return inline
  const computed = window.getComputedStyle(svg).transform
  return computed && computed !== 'none' ? computed : ''
}

const LABEL_SELECTOR = '.bunk-label-popper, .unit-label-popper'

/**
 * Escape a string for safe inclusion as XML text or attribute value.
 * SVG-in-PNG rasterization is strict; an unescaped & or < blows up the parse.
 */
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&apos;'
      default:
        return c
    }
  })
}

/**
 * Read the popper-positioned bunk/unit labels from `container` and emit an SVG
 * <g> of native <rect> + <text> primitives that mirror their visual styling.
 *
 * Why native primitives, not <foreignObject>+CSS: per-label foreignObject with
 * inlined computed styles produces tens-of-KB data URLs; concatenating
 * hundreds of them blew V8's ~512MB string limit on real graphs. A native
 * <rect>+<text> pair is ~150 bytes regardless of styling.
 */
export function readLabelLayer(container: HTMLElement): string {
  const labels = Array.from(container.querySelectorAll<HTMLElement>(LABEL_SELECTOR))
  if (labels.length === 0) return '<g></g>'

  const containerRect = container.getBoundingClientRect()
  const fragments: string[] = ['<g>']

  for (const label of labels) {
    fragments.push(renderLabel(label, containerRect))
  }

  fragments.push('</g>')
  return fragments.join('')
}

function renderLabel(label: HTMLElement, containerRect: DOMRect): string {
  const rect = label.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return ''
  const x = rect.left - containerRect.left
  const y = rect.top - containerRect.top

  if (label.classList.contains('bunk-label-popper')) {
    return renderBunkLabel(label, x, y, rect.width, rect.height)
  }
  if (label.classList.contains('unit-label-popper')) {
    return renderUnitLabel(label, x, y, rect.width, rect.height)
  }
  return ''
}

function renderBunkLabel(label: HTMLElement, x: number, y: number, w: number, h: number): string {
  const inner = label.firstElementChild as HTMLElement | null
  if (!inner) return ''
  const style = inner.style
  const bg = style.backgroundColor || 'black'
  const color = style.color || 'white'
  const radius = parseFloat(style.borderRadius) || 16
  const fontSize = parseFloat(style.fontSize) || 12
  const fontWeight = style.fontWeight || '600'
  const textY = y + h / 2 + fontSize * 0.35
  const textX = x + w / 2
  const text = escapeXml(inner.textContent ?? '')
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${bg}"/>` +
    `<text x="${textX}" y="${textY}" font-size="${fontSize}" font-weight="${fontWeight}" ` +
    `fill="${color}" text-anchor="middle" font-family="sans-serif">${text}</text>`
  )
}

function renderUnitLabel(label: HTMLElement, x: number, y: number, w: number, h: number): string {
  const style = label.style
  const bg = style.backgroundColor || 'rgba(255,255,255,0.85)'
  // border is "2px solid rgb(50,100,200)" — pull width and color from it.
  const borderMatch = style.border.match(/(\d+)px\s+\w+\s+(.+)/)
  const strokeWidth = borderMatch ? borderMatch[1] : '2'
  const strokeColor = borderMatch ? borderMatch[2] : 'black'
  const radius = parseFloat(style.borderRadius) || 10

  const textDiv = label.firstElementChild as HTMLElement | null
  const markerSvg = label.querySelector('svg')
  const text = escapeXml(textDiv?.textContent ?? '')
  const textColor = textDiv?.style.color || 'black'
  const fontSize = parseFloat(textDiv?.style.fontSize ?? '') || 13
  const fontWeight = textDiv?.style.fontWeight || '700'

  const padding = 10
  const textX = x + padding
  const textY = y + h / 2 + fontSize * 0.35

  const fragments: string[] = []
  fragments.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ` +
      `fill="${bg}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`
  )
  fragments.push(
    `<text x="${textX}" y="${textY}" font-size="${fontSize}" font-weight="${fontWeight}" ` +
      `fill="${textColor}" font-family="sans-serif">${text}</text>`
  )

  if (markerSvg) {
    const markerSize = 14
    const markerX = x + w - padding - markerSize
    const markerY = y + (h - markerSize) / 2
    const stroke = markerSvg.getAttribute('stroke') ?? strokeColor
    const sw = markerSvg.getAttribute('stroke-width') ?? '2.5'
    fragments.push(
      `<svg x="${markerX}" y="${markerY}" width="${markerSize}" height="${markerSize}" ` +
        `viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" ` +
        `stroke-linecap="round" stroke-linejoin="round">${markerSvg.innerHTML}</svg>`
    )
  }

  return fragments.join('')
}

export async function exportSessionGraphPng(
  cy: Core,
  container: HTMLElement,
  mode: ExportMode
): Promise<Blob> {
  const cyWithSvg = cy as CytoscapeWithSvg
  if (typeof cyWithSvg.svg !== 'function') {
    throw new Error('cytoscape-svg extension not registered on this Core instance')
  }

  const snapshot = mode === 'fit' ? { zoom: cy.zoom(), pan: { ...cy.pan() } } : null

  try {
    if (mode === 'fit') {
      try {
        cy.fit(undefined, 30)
      } catch (err) {
        // Zero-node graph — fall through to a viewport-mode-equivalent export.
        console.warn('cy.fit() threw during export; falling back to viewport mode', err)
      }
      // Two rAFs: first lets cytoscape commit the new pan/zoom and fire its
      // own pan/zoom events, second lets bubblesets's listener actually
      // recompute and re-apply the wrapper transform.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    }

    const containerRect = container.getBoundingClientRect()
    const width = Math.round(containerRect.width)
    const height = Math.round(containerRect.height)

    const cyInner = stripSvgWrapper(cyWithSvg.svg({ full: false, bg: 'white' }))

    const bubbleTransform = readBubbleTransform(container)
    const bubbleSvg = container.querySelector('svg')
    const bubbleInner = bubbleSvg ? bubbleSvg.innerHTML : ''
    const bubbleLayer = bubbleInner
      ? `<g${bubbleTransform ? ` transform="${bubbleTransform}"` : ''}>${bubbleInner}</g>`
      : ''

    const labelLayer = readLabelLayer(container)

    const composite =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="white"/>` +
      cyInner +
      bubbleLayer +
      labelLayer +
      `</svg>`

    return await rasterizeSvgToPng(composite, width, height)
  } finally {
    if (snapshot) {
      try {
        cy.zoom(snapshot.zoom)
        cy.pan(snapshot.pan)
      } catch {
        // Cy may be destroyed mid-export — nothing we can do.
      }
    }
  }
}

async function rasterizeSvgToPng(svgString: string, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width * EXPORT_SCALE
  canvas.height = height * EXPORT_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('failed to acquire 2d context for graph export')

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  try {
    const img = await loadImage(svgUrl)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/png'
    )
  })
}
