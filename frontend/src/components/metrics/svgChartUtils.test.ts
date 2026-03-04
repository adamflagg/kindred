import { describe, it, expect } from 'vitest'
import { polarToCartesian, arcPath, monotoneCubicPath } from './svgChartUtils'

describe('polarToCartesian', () => {
  it('returns center point at radius 0', () => {
    const p = polarToCartesian(100, 100, 0, 45)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(100)
  })

  it('returns correct point at 0 degrees (top of circle)', () => {
    // 0 degrees = 12 o'clock = (cx, cy - r)
    const p = polarToCartesian(100, 100, 50, 0)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(50)
  })

  it('returns correct point at 90 degrees (right)', () => {
    const p = polarToCartesian(100, 100, 50, 90)
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(100)
  })

  it('returns correct point at 180 degrees (bottom)', () => {
    const p = polarToCartesian(100, 100, 50, 180)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(150)
  })

  it('returns correct point at 270 degrees (left)', () => {
    const p = polarToCartesian(100, 100, 50, 270)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(100)
  })
})

describe('arcPath', () => {
  it('returns a valid SVG path string', () => {
    const d = arcPath(100, 100, 0, 50, 0, 90)
    expect(d).toContain('M')
    expect(d).toContain('A')
  })

  it('returns empty string for zero-degree arc', () => {
    const d = arcPath(100, 100, 0, 50, 45, 45)
    expect(d).toBe('')
  })

  it('uses large arc flag for arcs > 180 degrees', () => {
    const d = arcPath(100, 100, 0, 50, 0, 270)
    // Large arc flag should be 1 (> 180 deg)
    expect(d).toMatch(/A\s*50[\s,]+50[\s,]+0[\s,]+1/)
  })

  it('uses small arc flag for arcs <= 180 degrees', () => {
    const d = arcPath(100, 100, 0, 50, 0, 90)
    // Large arc flag should be 0 (<= 180 deg)
    expect(d).toMatch(/A\s*50[\s,]+50[\s,]+0[\s,]+0/)
  })

  it('generates donut arc when innerRadius > 0', () => {
    const d = arcPath(100, 100, 30, 50, 0, 90)
    // Should have two arcs (outer + inner) making a ring segment
    const arcCount = (d.match(/A/g) || []).length
    expect(arcCount).toBe(2)
  })

  it('handles near-full-circle arc (359.9 degrees)', () => {
    const d = arcPath(100, 100, 0, 50, 0, 359.9)
    expect(d).toContain('A')
    expect(d.length).toBeGreaterThan(10)
  })
})

describe('monotoneCubicPath', () => {
  it('returns empty string for empty array', () => {
    expect(monotoneCubicPath([])).toBe('')
  })

  it('returns empty string for single point', () => {
    expect(monotoneCubicPath([{ x: 10, y: 20 }])).toBe('')
  })

  it('returns a straight line for two points', () => {
    const d = monotoneCubicPath([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ])
    expect(d).toMatch(/^M\s*0[\s,]+100/)
    // Two points: should be a simple line or curve
    expect(d.length).toBeGreaterThan(5)
  })

  it('returns a smooth curve for multiple points', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 30 },
      { x: 100, y: 80 },
      { x: 150, y: 10 },
    ]
    const d = monotoneCubicPath(points)
    expect(d).toMatch(/^M/)
    // Should contain cubic bezier commands
    expect(d).toContain('C')
  })

  it('produces monotone curves (no overshoot on flat segments)', () => {
    // Three collinear points — tangents should be 0 for the flat middle
    const points = [
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]
    const d = monotoneCubicPath(points)
    // All y-values in the path should be 50 (no overshoot)
    const nums = d.match(/[\d.]+/g)?.map(Number) ?? []
    const yValues = nums.filter((_: number, i: number) => i % 2 === 1) // every other number is y
    for (const y of yValues) {
      expect(y).toBeCloseTo(50, 0)
    }
  })
})
