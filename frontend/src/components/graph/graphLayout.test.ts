/**
 * Tests for graph layout utilities — single source of truth for fcose config.
 */
import { describe, it, expect } from 'vitest'
import { getFcoseOptions, prepareWorkerInput } from './graphLayout'
import type { ParentNodeElement, CamperNodeElement, EdgeElement } from './cytoscapeStyles'

describe('getFcoseOptions', () => {
  it('returns base spacing when compound nodes exist', () => {
    const opts = getFcoseOptions({ hasCompoundNodes: true })
    expect(opts.name).toBe('fcose')
    expect(opts.nodeSeparation).toBeGreaterThan(0)
    expect(opts.componentSpacing).toBeGreaterThan(0)
  })

  it('expands spacing when no compound nodes exist', () => {
    const tight = getFcoseOptions({ hasCompoundNodes: true })
    const loose = getFcoseOptions({ hasCompoundNodes: false })
    expect(loose.nodeSeparation).toBeGreaterThan(tight.nodeSeparation)
    expect(loose.componentSpacing).toBeGreaterThan(tight.componentSpacing)
  })

  it('preserves shared layout properties across both branches', () => {
    const opts = getFcoseOptions({ hasCompoundNodes: true })
    expect(opts.numIter).toBeGreaterThan(0)
    expect(opts.fit).toBe(true)
    expect(opts.gravityCompound).toBeGreaterThan(0)
  })

  it('returns serializable options (no function values)', () => {
    const opts = getFcoseOptions({ hasCompoundNodes: true })
    for (const [key, value] of Object.entries(opts)) {
      expect(typeof value, `${key} must be serializable for postMessage`).not.toBe('function')
    }
  })

  // Layout-quality lock: 'draft' skips fcose's spectral pre-layout and on
  // this dataset (with strong gravityCompound) collapsed the graph to a
  // line. 'default' is required for a coherent initial spread.
  it("uses quality: 'default' for spectral pre-layout (draft collapses graph)", () => {
    expect(getFcoseOptions({ hasCompoundNodes: true }).quality).toBe('default')
  })

  it('caps numIter at 300 (force-directed phase converges before 1000)', () => {
    expect(getFcoseOptions({ hasCompoundNodes: true }).numIter).toBeLessThanOrEqual(300)
  })

  // Spacing lock: tightened from 200 → 130 (#user-feedback: graph required
  // constant zoom-in; cross-unit same-gender request stretching addressed
  // via the unit gender-side split).
  it('uses tightened compound-graph spacing (≤140 to keep graph compact)', () => {
    const opts = getFcoseOptions({ hasCompoundNodes: true })
    expect(opts.nodeSeparation).toBeLessThanOrEqual(140)
    expect(opts.componentSpacing).toBeLessThanOrEqual(140)
  })
})

describe('prepareWorkerInput', () => {
  const parentNodes: ParentNodeElement[] = [
    { data: { id: 'bunk-1', label: 'B-1', isBunkParent: true } },
  ]
  const nodes: CamperNodeElement[] = [
    {
      data: {
        id: '1',
        label: 'A',
        name: 'A',
        grade: 5,
        centrality: 0.5,
        clustering: 0,
        satisfaction_status: 'satisfied',
        bunk_cm_id: 1,
        community: 1,
        parent: 'bunk-1',
      },
    },
  ]
  const edges: EdgeElement[] = []

  it('attaches the full fcose options object derived from getFcoseOptions', () => {
    const input = prepareWorkerInput(parentNodes, nodes, edges)
    const expected = getFcoseOptions({ hasCompoundNodes: true })
    expect(input.options).toEqual(expected)
  })

  it('uses no-compound spacing when there are no parent nodes', () => {
    const input = prepareWorkerInput([], nodes, edges)
    const expected = getFcoseOptions({ hasCompoundNodes: false })
    expect(input.options).toEqual(expected)
  })
})
