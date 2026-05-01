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
import { toPng } from 'html-to-image'

const EXPORT_SCALE = 2

const LABEL_SELECTORS = '.bunk-label-popper, .unit-label-popper'

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

export async function exportSessionGraphPng(cy: Core, container: HTMLElement): Promise<Blob> {
  const cyWithSvg = cy as CytoscapeWithSvg
  if (typeof cyWithSvg.svg !== 'function') {
    throw new Error('cytoscape-svg extension not registered on this Core instance')
  }

  const containerRect = container.getBoundingClientRect()
  const width = Math.round(containerRect.width)
  const height = Math.round(containerRect.height)

  const cyInner = stripSvgWrapper(cyWithSvg.svg({ full: false, bg: 'white' }))

  const bubbleSvg = container.querySelector('svg')
  const bubbleInner = bubbleSvg ? bubbleSvg.innerHTML : ''

  // Compose the vector layers (cytoscape + bubblesets) into one SVG. Labels
  // are NOT embedded here — inlining each label as a foreignObject with
  // computed styles would produce data URLs in the hundreds of KB, and a
  // graph with hundreds of labels overflows V8's string length limit.
  const composite =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="white" />` +
    cyInner +
    `<svg width="${width}" height="${height}">${bubbleInner}</svg>` +
    `</svg>`

  const canvas = document.createElement('canvas')
  canvas.width = width * EXPORT_SCALE
  canvas.height = height * EXPORT_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('failed to acquire 2d context for graph export')

  const svgBlob = new Blob([composite], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  try {
    const baseImg = await loadImage(svgUrl)
    ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(svgUrl)
  }

  // Layer the popper-positioned labels on top, one rasterized PNG per label.
  // Each PNG is small (a single text pill at 2x), so this scales to graphs
  // with hundreds of labels without blowing memory.
  const labels = Array.from(container.querySelectorAll<HTMLElement>(LABEL_SELECTORS))
  for (const label of labels) {
    const rect = label.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const dataUrl = await toPng(label, {
      pixelRatio: EXPORT_SCALE,
      cacheBust: true,
      backgroundColor: 'transparent',
    })
    const img = await loadImage(dataUrl)
    const x = (rect.left - containerRect.left) * EXPORT_SCALE
    const y = (rect.top - containerRect.top) * EXPORT_SCALE
    ctx.drawImage(img, x, y, rect.width * EXPORT_SCALE, rect.height * EXPORT_SCALE)
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/png'
    )
  })
}
