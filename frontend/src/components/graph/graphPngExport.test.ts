/**
 * Tests for graphPngExport.
 *
 * The full pipeline depends on a live cytoscape Core (with cytoscape-svg
 * registered) plus browser canvas APIs that jsdom doesn't provide, so the
 * exported export function is exercised manually per the PR test plan. The
 * pure pieces (SVG wrapper stripping) are tested here.
 */
import { describe, expect, it } from 'vitest'
import { stripSvgWrapper } from './graphPngExport'

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
