import { describe, it, expect } from 'vitest'
import { createGraphElements } from './cytoscapeStyles'
import type { GraphNodeData, GraphEdgeData, ShowEdgesSettings } from './cytoscapeStyles'

describe('createGraphElements — stranded bunk labels', () => {
  it('never labels a bunk parent node with a raw numeric id', () => {
    // One camper grouped under bunk cm_id 12345, which is absent from bunksData
    // (its bunk has no plan for this session — stranded assignment, #1417).
    const nodes: GraphNodeData[] = [
      {
        id: 1,
        name: 'Emma Johnson',
        bunk_cm_id: 12345,
      },
    ]
    const edges: GraphEdgeData[] = []
    const showEdges: ShowEdgesSettings = { request: true }

    const { parentNodes } = createGraphElements(nodes, edges, {}, showEdges)

    const orphanParent = parentNodes.find((p) => p.data.bunk_cm_id === 12345)
    expect(orphanParent).toBeDefined()
    expect(orphanParent!.data.label).not.toMatch(/\d{4,}/) // no 4+ digit number
    expect(orphanParent!.data.label).toBe('Removed cabin')
  })
})
