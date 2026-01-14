/**
 * Tests for Cytoscape styles and graph data transformations
 */
import { describe, it, expect } from 'vitest';
import {
  getCytoscapeStyles,
  createGraphElements,
  type GraphNodeData,
  type GraphEdgeData,
} from './cytoscapeStyles';
import { expectDefined } from '../../test/testUtils';

describe('getCytoscapeStyles', () => {
  it('returns an array of style definitions', () => {
    const styles = getCytoscapeStyles({ showLabels: true });
    expect(Array.isArray(styles)).toBe(true);
    expect(styles.length).toBeGreaterThan(0);
  });

  it('includes node style selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true });
    const nodeStyle = styles.find((s) => s.selector === 'node:childless');
    expect(nodeStyle).toBeDefined();
  });

  it('includes edge style selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true });
    const edgeStyle = styles.find((s) => s.selector === 'edge');
    expect(edgeStyle).toBeDefined();
  });

  it('includes faded class selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true });
    const fadedStyle = styles.find((s) => s.selector === '.faded');
    expect(fadedStyle).toBeDefined();
  });

  it('includes bunk parent node selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true });
    const parentStyle = styles.find((s) => s.selector === 'node[isBunkParent]');
    expect(parentStyle).toBeDefined();
  });
});

describe('createGraphElements', () => {
  const mockNodes: GraphNodeData[] = [
    {
      id: 1,
      name: 'Alice',
      grade: 5,
      centrality: 0.5,
      clustering: 0.3,
      satisfaction_status: 'satisfied',
      bunk_cm_id: 100,
      community: 1,
    },
    {
      id: 2,
      name: 'Bob',
      grade: 6,
      centrality: 0.3,
      clustering: 0.2,
      satisfaction_status: 'partial',
      bunk_cm_id: 100,
      community: 1,
    },
    {
      id: 3,
      name: 'Charlie',
      grade: 5,
      centrality: 0.2,
      clustering: 0.1,
      satisfaction_status: 'isolated',
      bunk_cm_id: undefined,
      community: 2,
    },
  ];

  const mockEdges: GraphEdgeData[] = [
    {
      source: 1,
      target: 2,
      type: 'request',
      priority: 1,
      confidence: 0.9,
      reciprocal: true,
    },
    {
      source: 2,
      target: 3,
      type: 'historical',
      priority: 2,
      confidence: 0.7,
      reciprocal: false,
    },
  ];

  const mockBunksData: Record<number, string> = {
    100: 'Cabin A',
  };

  it('creates parent nodes for bunks', () => {
    const { parentNodes } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: true, sibling: true, school: true }
    );
    expect(parentNodes).toHaveLength(1);
    const parent = expectDefined(parentNodes[0], 'parent node');
    expect(parent.data.id).toBe('bunk-100');
    expect(parent.data.label).toBe('Cabin A');
  });

  it('creates camper nodes with correct data', () => {
    const { nodes } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: true, sibling: true, school: true }
    );
    expect(nodes).toHaveLength(3);

    const alice = expectDefined(nodes.find((n) => n.data.id === '1'), 'alice node');
    expect(alice.data.name).toBe('Alice');
    expect(alice.data.grade).toBe(5);
    expect(alice.data.parent).toBe('bunk-100');
  });

  it('assigns parent to nodes with bunk_cm_id', () => {
    const { nodes } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: true, sibling: true, school: true }
    );

    const alice = expectDefined(nodes.find((n) => n.data.id === '1'), 'alice');
    const charlie = expectDefined(nodes.find((n) => n.data.id === '3'), 'charlie');

    expect(alice.data.parent).toBe('bunk-100');
    expect(charlie.data.parent).toBeUndefined();
  });

  it('filters edges based on showEdges settings', () => {
    const { edges } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: false, sibling: true, school: true }
    );

    expect(edges).toHaveLength(1);
    const edge = expectDefined(edges[0], 'first edge');
    expect(edge.data.edge_type).toBe('request');
  });

  it('includes all edges when all types are enabled', () => {
    const { edges } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: true, sibling: true, school: true }
    );

    expect(edges).toHaveLength(2);
  });

  it('creates edges with correct data mapping', () => {
    const { edges } = createGraphElements(
      mockNodes,
      mockEdges,
      mockBunksData,
      { request: true, historical: true, sibling: true, school: true }
    );

    const requestEdge = expectDefined(
      edges.find((e) => e.data.edge_type === 'request'),
      'request edge'
    );
    expect(requestEdge.data.source).toBe('1');
    expect(requestEdge.data.target).toBe('2');
    expect(requestEdge.data.confidence).toBe(0.9);
    expect(requestEdge.data.is_reciprocal).toBe(true);
  });
});
