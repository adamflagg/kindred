/**
 * Type-level tests verifying that the generated API types (from openapi-typescript)
 * match the shapes expected by consumers.
 *
 * These tests use runtime shape assertions (duck-typing) to confirm that:
 *   1. The generated types have the required fields.
 *   2. The re-exported aliases in api-types.ts are assignable to existing consumers.
 *
 * Note: TypeScript type compatibility is proven at compile time via the import
 * statements + assignments below. The `it()` blocks provide runtime sanity
 * checks on example objects.
 */
import { describe, it, expect } from 'vitest'
import type { ApiSocialGraphNode, ApiSocialGraphEdge, ApiCrossScopeEdge } from './api-types'

// ── Type-level assertions (compile-time) ─────────────────────────────────────
// If any of these assignments fail to compile, the generated types are broken.

const sampleNode: ApiSocialGraphNode = {
  id: 1001,
  name: 'Emma Johnson',
  grade: 7,
  bunk_cm_id: 2001,
  centrality: 0.5,
  clustering: 0.3,
  community: 1,
  satisfaction_status: 'satisfied',
  parent_satisfaction_status: 'satisfied',
  staff_satisfaction_status: null,
  first_year: false,
  last_year_session: null,
  last_year_bunk: null,
}

const sampleEdge: ApiSocialGraphEdge = {
  source: 1001,
  target: 1002,
  weight: 1.0,
  edge_type: 'request',
  reciprocal: true,
  confidence: 0.9,
  priority: 1,
  request_type: 'bunk_with',
  metadata: {},
  cross_scope: false,
}

const sampleCrossScopeEdge: ApiCrossScopeEdge = {
  source: 1001,
  target: 1003,
  edge_type: 'request',
  weight: 1.0,
  request_type: 'bunk_with',
  priority: 1,
  confidence: 0.85,
  reciprocal: false,
  cross_scope: true,
}

// ── Runtime shape checks ──────────────────────────────────────────────────────

describe('ApiSocialGraphNode (generated)', () => {
  it('has required numeric id and name fields', () => {
    expect(typeof sampleNode.id).toBe('number')
    expect(typeof sampleNode.name).toBe('string')
  })

  it('has centrality and clustering numeric fields', () => {
    expect(typeof sampleNode.centrality).toBe('number')
    expect(typeof sampleNode.clustering).toBe('number')
  })

  it('has optional satisfaction_status', () => {
    const node: ApiSocialGraphNode = { ...sampleNode, satisfaction_status: null }
    expect(node.satisfaction_status).toBeNull()
  })

  it('has first_year boolean field', () => {
    expect(typeof sampleNode.first_year).toBe('boolean')
  })
})

describe('ApiSocialGraphEdge (generated)', () => {
  it('has source, target, edge_type fields', () => {
    expect(typeof sampleEdge.source).toBe('number')
    expect(typeof sampleEdge.target).toBe('number')
    expect(typeof sampleEdge.edge_type).toBe('string')
  })

  it('has weight field', () => {
    expect(typeof sampleEdge.weight).toBe('number')
  })

  it('has optional request_type', () => {
    const edge: ApiSocialGraphEdge = { ...sampleEdge, request_type: null }
    expect(edge.request_type).toBeNull()
  })
})

describe('ApiCrossScopeEdge (generated)', () => {
  it('has cross_scope: true literal', () => {
    expect(sampleCrossScopeEdge.cross_scope).toBe(true)
  })

  it('has source and target', () => {
    expect(typeof sampleCrossScopeEdge.source).toBe('number')
    expect(typeof sampleCrossScopeEdge.target).toBe('number')
  })

  it('has optional nullable priority and confidence', () => {
    const edge: ApiCrossScopeEdge = { ...sampleCrossScopeEdge, priority: null, confidence: null }
    expect(edge.priority).toBeNull()
    expect(edge.confidence).toBeNull()
  })
})
