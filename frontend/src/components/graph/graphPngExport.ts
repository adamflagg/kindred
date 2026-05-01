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
import { toSvg } from 'html-to-image'

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

  const labels = Array.from(container.querySelectorAll<HTMLElement>(LABEL_SELECTORS))
  const labelFragments = await Promise.all(
    labels.map(async (label) => {
      const rect = label.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return ''
      const x = Math.round(rect.left - containerRect.left)
      const y = Math.round(rect.top - containerRect.top)
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      const dataUrl = await toSvg(label, { pixelRatio: EXPORT_SCALE, cacheBust: true })
      return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${dataUrl}" />`
    })
  )

  const composite =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="white" />` +
    cyInner +
    `<svg width="${width}" height="${height}">${bubbleInner}</svg>` +
    labelFragments.join('') +
    `</svg>`

  const svgBlob = new Blob([composite], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  try {
    const img = await loadImage(svgUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width * EXPORT_SCALE
    canvas.height = height * EXPORT_SCALE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('failed to acquire 2d context for graph export')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
        'image/png'
      )
    })
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}
