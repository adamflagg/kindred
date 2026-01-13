/**
 * Cytoscape styles and graph data transformations
 * Extracted from SocialNetworkGraph.tsx
 */
import type { NodeSingular, EdgeSingular, StylesheetStyle } from 'cytoscape';
import { GRADE_COLORS, EDGE_COLORS, STATUS_COLORS } from './constants';
import { formatGradeOrdinal } from '../../utils/gradeUtils';

/** Input node data from API */
export interface GraphNodeData {
  id: number;
  name: string;
  grade: number;
  centrality: number;
  clustering: number;
  satisfaction_status: string;
  bunk_cm_id: number | undefined;
  community: number;
}

/** Input edge data from API */
export interface GraphEdgeData {
  source: number;
  target: number;
  type: string;
  priority: number;
  confidence: number;
  reciprocal: boolean;
}

/** Edge visibility settings */
export interface ShowEdgesSettings {
  request: boolean;
  historical: boolean;
  sibling: boolean;
  school: boolean;
}

/** Options for getCytoscapeStyles */
export interface CytoscapeStyleOptions {
  showLabels: boolean;
}

/**
 * Get Cytoscape stylesheet for the social network graph
 */
export function getCytoscapeStyles({ showLabels }: CytoscapeStyleOptions): StylesheetStyle[] {
  return [
    // Camper nodes (exclude parent compound nodes)
    {
      selector: 'node:childless',
      style: {
        'background-color': (ele: NodeSingular) => {
          const grade = ele.data('grade');
          return grade ? GRADE_COLORS[grade] || '#95a5a6' : '#95a5a6';
        },
        'width': (ele: NodeSingular) => {
          const centrality = ele.data('centrality') || 0;
          return 10 + centrality * 40; // 10-50px range
        },
        'height': (ele: NodeSingular) => {
          const centrality = ele.data('centrality') || 0;
          return 10 + centrality * 40; // 10-50px range
        },
        'label': showLabels ? 'data(label)' : '',
        // Responsive font size: larger base for mobile readability
        'font-size': '12px',
        'color': '#f5f5f5',
        'text-outline-width': 2,
        'text-outline-color': '#1a1a1a',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-max-width': '100px',
        'text-wrap': 'ellipsis',
        'border-width': 3,
        'border-color': (ele: NodeSingular) => {
          const status = ele.data('satisfaction_status');
          return STATUS_COLORS[status] || STATUS_COLORS['default'] || '#2c3e50';
        },
        'overlay-padding': '6px',
      },
    },
    {
      selector: 'node:childless:selected',
      style: {
        'border-width': 4,
        'border-color': '#e74c3c',
        'overlay-color': '#e74c3c',
        'overlay-opacity': 0.2,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': (ele: EdgeSingular) => {
          const edgeType = ele.data('edge_type');
          return EDGE_COLORS[edgeType] || '#95a5a6';
        },
        'line-opacity': (ele: EdgeSingular) => {
          const confidence = ele.data('confidence') || 0.5;
          return 0.3 + confidence * 0.7; // 0.3-1.0 range
        },
        'target-arrow-shape': 'triangle',
        'target-arrow-color': (ele: EdgeSingular) => {
          const edgeType = ele.data('edge_type');
          return EDGE_COLORS[edgeType] || '#95a5a6';
        },
        'curve-style': 'bezier',
        'overlay-padding': '2px',
      },
    },
    {
      selector: 'edge.hidden',
      style: {
        display: 'none',
      },
    },
    {
      selector: 'edge[type = "bundled"]',
      style: {
        width: 3,
        'line-style': 'solid',
        'line-dash-pattern': [6, 3],
      },
    },
    {
      selector: '.faded',
      style: {
        opacity: 0.1,
        events: 'no',
      },
    },
    {
      selector: '.hide-label',
      style: {
        label: '',
      },
    },
    {
      selector: '.highlighted',
      style: {
        'z-index': 999,
        'font-weight': 'bold',
        'font-size': '14px',
        'text-outline-width': 2,
        'text-outline-color': '#fff',
      },
    },
    {
      selector: '.bunk-label',
      style: {
        shape: 'rectangle',
        width: 1,
        height: 1,
        'background-opacity': 0,
        'border-width': 0,
        label: 'data(label)',
        'font-size': '18px',
        'font-weight': 'bold',
        color: '#333',
        'text-outline-width': 3,
        'text-outline-color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        events: 'no',
        'z-index': 1000,
      },
    },
    // Compound parent nodes for bunk grouping (invisible - used for layout only)
    {
      selector: 'node[isBunkParent]',
      style: {
        'background-opacity': 0,
        'border-width': 0,
        label: '',
        padding: '20px',
        'min-width': '60px',
        'min-height': '60px',
        events: 'no',
      },
    },
  ];
}

/** Cytoscape element for parent (bunk) node */
export interface ParentNodeElement {
  data: {
    id: string;
    label: string;
    isBunkParent: boolean;
    bunk_cm_id: number;
  };
}

/** Cytoscape element for camper node */
export interface CamperNodeElement {
  data: {
    id: string;
    label: string;
    name: string;
    grade: number;
    centrality: number;
    clustering: number;
    satisfaction_status: string;
    bunk_cm_id: number | undefined;
    community: number;
    parent: string | undefined;
  };
}

/** Cytoscape element for edge */
export interface EdgeElement {
  data: {
    id: string;
    source: string;
    target: string;
    edge_type: string;
    priority: number;
    confidence: number;
    is_reciprocal: boolean;
  };
}

/** Result of createGraphElements */
export interface GraphElements {
  parentNodes: ParentNodeElement[];
  nodes: CamperNodeElement[];
  edges: EdgeElement[];
}

/**
 * Create Cytoscape elements from graph data
 */
export function createGraphElements(
  nodeData: GraphNodeData[],
  edgeData: GraphEdgeData[],
  bunksData: Record<number, string> | null | undefined,
  showEdges: ShowEdgesSettings
): GraphElements {
  // Group nodes by bunk
  const bunkGroups: Record<number, GraphNodeData[]> = {};

  nodeData.forEach((node) => {
    if (node.bunk_cm_id) {
      const bunkId = node.bunk_cm_id;
      if (!bunkGroups[bunkId]) {
        bunkGroups[bunkId] = [];
      }
      const group = bunkGroups[bunkId];
      if (group) {
        group.push(node);
      }
    }
  });

  // Create parent nodes for each bunk
  const parentNodes: ParentNodeElement[] = Object.keys(bunkGroups).map(
    (bunkIdStr) => {
      const bunkId = parseInt(bunkIdStr, 10);
      return {
        data: {
          id: `bunk-${bunkId}`,
          label: bunksData?.[bunkId] || `Bunk ${bunkId}`,
          isBunkParent: true,
          bunk_cm_id: bunkId,
        },
      };
    }
  );

  // Create camper nodes with parent property for compound grouping
  const nodes: CamperNodeElement[] = nodeData.map((node) => ({
    data: {
      id: node.id.toString(),
      label: `${node.name} (${formatGradeOrdinal(node.grade)})`,
      name: node.name,
      grade: node.grade,
      centrality: node.centrality,
      clustering: node.clustering,
      satisfaction_status: node.satisfaction_status,
      bunk_cm_id: node.bunk_cm_id,
      community: node.community,
      parent: node.bunk_cm_id ? `bunk-${node.bunk_cm_id}` : undefined,
    },
  }));

  // Filter and create edges based on visibility settings
  const edges: EdgeElement[] = edgeData
    .filter((edge) => {
      const edgeType = edge.type as keyof ShowEdgesSettings;
      return showEdges[edgeType] !== false;
    })
    .map((edge, index) => ({
      data: {
        id: `edge-${index}`,
        source: edge.source.toString(),
        target: edge.target.toString(),
        edge_type: edge.type,
        priority: edge.priority,
        confidence: edge.confidence,
        is_reciprocal: edge.reciprocal,
      },
    }));

  return { parentNodes, nodes, edges };
}
