import { useEffect, useRef, useState, Activity } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import cytoscape from 'cytoscape';
// @ts-expect-error - No types available for cytoscape-fcose
import fcose from 'cytoscape-fcose';
// @ts-expect-error - No types available for cytoscape-cola
import cola from 'cytoscape-cola';
// Tooltips removed - will implement React-based solution
import { Network, X, AlertTriangle, Users, Activity as ActivityIcon, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Info } from 'lucide-react';
import clsx from 'clsx';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { getSessionShorthand } from '../utils/sessionDisplay';
import { socialGraphService } from '../services/socialGraph';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import CamperDetailsPanel from './CamperDetailsPanel';
import { pb } from '../lib/pocketbase';
import type { Bunk, Session } from '../types/app-types';

// Register extensions
cytoscape.use(fcose);
cytoscape.use(cola);

interface BunkSocialGraphModalProps {
  bunkCmId: number;
  bunkName: string;
  sessionCmId: number;
  year: number;
  isOpen: boolean;
  onClose: () => void;
  onBunkChange?: (bunkCmId: number, bunkName: string) => void;
}

interface GraphNode {
  id: number;
  name: string;
  grade: number | null;
  bunk_cm_id: number | null;
  centrality: number;
  clustering: number;
  community: number | null;
  first_year?: boolean;
  last_year_session?: string | null;
  last_year_bunk?: string | null;
}

interface GraphEdge {
  source: number;
  target: number;
  weight: number;
  type: string;
  reciprocal: boolean;
  confidence?: number;
  priority?: number;
}

interface BunkGraphMetrics {
  cohesion_score: number;
  average_degree: number;
  density: number;
  isolated_count: number;
  suggestions: string[];
}

interface BunkGraphData {
  bunk_cm_id: number;
  bunk_name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: BunkGraphMetrics;
  health_score: number;
}

// Node colors based on connection status
const getNodeColor = (degree: number): string => {
  if (degree === 0) return '#e74c3c'; // Red - isolated
  if (degree <= 2) return '#f39c12'; // Yellow - weak connections
  return '#2ecc71'; // Green - well connected
};

// Edge type colors (matching main graph)
const EDGE_COLORS: Record<string, string> = {
  'request': '#3498db',  // Blue for all request edges
  'sibling': '#e74c3c',  // Red for all sibling edges
};

export default function BunkSocialGraphModal({
  bunkCmId,
  bunkName,
  sessionCmId,
  year,
  isOpen,
  onClose,
  onBunkChange
}: BunkSocialGraphModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const layoutRef = useRef<cytoscape.Layouts | null>(null);
  const { fetchWithAuth } = useApiWithAuth();
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null);
  const [currentBunkIndex, setCurrentBunkIndex] = useState<number>(0);
  const [sessionBunks, setSessionBunks] = useState<Array<{ cm_id: number; name: string; gender: string }>>([]);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  // Fetch bunk graph data
  const { data: graphData, isLoading } = useQuery<BunkGraphData>({
    queryKey: ['bunk-social-graph', bunkCmId, sessionCmId, year],
    queryFn: async () => {
      const data = await socialGraphService.getBunkSocialGraph(bunkCmId, sessionCmId, year, fetchWithAuth);
      return data as unknown as BunkGraphData;
    },
    enabled: isOpen,
  });

  // Fetch session bunks for navigation
  const { data: allBunks } = useQuery({
    queryKey: ['session-bunks', sessionCmId, year],
    queryFn: async () => {
      // Get the session by CampMinder ID and year
      const sessionResp = await pb.collection<Session>('camp_sessions').getList(1, 1, {
        filter: `cm_id = ${sessionCmId} && year = ${year}`,
      });

      if (sessionResp.items.length === 0) {
        throw new Error(`Session with CampMinder ID ${sessionCmId} not found for year ${year}`);
      }
      
      const session = sessionResp.items[0];
      if (!session) {
        throw new Error(`Session with CampMinder ID ${sessionCmId} not found for year ${year}`);
      }

      // Get bunk plans for this session using relation expansion
      const filter = `session.cm_id = ${session.cm_id} && year = ${year}`;
      const bunkPlans = await pb.collection('bunk_plans').getFullList({
        filter,
        expand: 'bunk'
      });
      
      if (bunkPlans.length === 0) return [];
      
      // Get unique bunk CampMinder IDs
      interface BunkPlanRecord {
        bunk_cm_id?: number;
      }
      const bunkCmIds = [...new Set(bunkPlans.map((bp) => (bp as BunkPlanRecord).bunk_cm_id).filter((id): id is number => id !== undefined))];
      
      // Batch fetch bunks
      if (bunkCmIds.length === 0) return [];
      
      const bunkFilter = bunkCmIds.map(id => `cm_id = ${id}`).join(' || ');
      const bunks = await pb.collection<Bunk>('bunks').getFullList({ filter: bunkFilter });
      
      // Sort bunks by name
      return bunks.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: isOpen,
  });

  // Initialize session bunks and current index when data is loaded
  useEffect(() => {
    if (allBunks && allBunks.length > 0 && bunkCmId) {
      // Determine bunk type (G, B, or AG)
      const currentBunk = allBunks.find(b => b.cm_id === bunkCmId);
      const getBunkType = (name: string): 'G' | 'B' | 'AG' => {
        if (!name) return 'B';
        if (name.includes('AG') || name.startsWith('AG')) return 'AG';
        if (name.startsWith('G-')) return 'G';
        if (name.startsWith('B-')) return 'B';
        return 'B'; // Default fallback
      };
      
      const currentBunkType = getBunkType(currentBunk?.name || '');
      
      // For AG bunks, no navigation
      if (currentBunkType === 'AG') {
        setSessionBunks([]);
        return;
      }

      // Extract level for sorting (handles Alph, Bet, and numbers)
      const extractSortKey = (name: string): { primary: number, secondary: string } => {
        if (name.includes('Alph')) return { primary: -2, secondary: name };
        if (name.includes('Bet')) return { primary: -1, secondary: name };
        
        const match = name.match(/[GB]-(\d+)/);
        if (match && match[1]) {
          return { primary: parseInt(match[1], 10), secondary: name };
        }
        return { primary: 999, secondary: name };
      };

      // Filter bunks by type and sort
      const sortedBunks = allBunks
        .filter(bunk => {
          const bunkType = getBunkType(bunk.name || '');
          return bunkType === currentBunkType;
        })
        .sort((a, b) => {
          const keyA = extractSortKey(a.name || '');
          const keyB = extractSortKey(b.name || '');
          
          if (keyA.primary !== keyB.primary) return keyA.primary - keyB.primary;
          // If same level, sort alphabetically (handles suffixes like G-1A, G-1B)
          return keyA.secondary.localeCompare(keyB.secondary);
        })
        .map(bunk => ({
          cm_id: bunk.cm_id,
          name: bunk.name || '',
          gender: getBunkType(bunk.name || '') === 'G' ? 'F' : 'M',
        }));

      setSessionBunks(sortedBunks);

      // Find current bunk index
      const index = sortedBunks.findIndex(b => b.cm_id === bunkCmId);
      if (index !== -1) {
        setCurrentBunkIndex(index);
      }
    }
  }, [allBunks, bunkCmId]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || !graphData || !isOpen) return;
    
    // Ensure previous instance is cleaned up
    if (cyRef.current && !cyRef.current.destroyed()) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: NodeSingular) => {
              // const nodeId = parseInt(ele.id().replace('node-', ''));
              const degree = ele.degree(false);
              return getNodeColor(degree);
            },
            'width': 40, // Fixed circular nodes
            'height': 40,
            'label': 'data(label)',
            'font-size': '14px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 8, // More spacing from node
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'color': 'data(gradeColor)', // Keep grade color for text
            'text-outline-width': 2,
            'text-outline-color': '#ffffff',
            'overlay-padding': '6px',
          }
        },
        {
          selector: 'node.isolated',
          style: {
            // Isolated nodes don't need special border styling
          }
        },
        {
          selector: 'node.first-year',
          style: {
            'border-width': 3,
            'border-color': '#9b59b6', // Purple border for first-year campers
            'border-style': 'solid',
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2, // Uniform width for all edges
            'line-color': (ele: EdgeSingular) => {
              const type = ele.data('type');
              return EDGE_COLORS[type] || '#95a5a6';
            },
            'target-arrow-shape': (ele: EdgeSingular) => {
              // Show arrows for request edges, none for sibling edges
              const type = ele.data('type');
              // Sibling edges never have arrows (they're always bidirectional)
              if (type === 'sibling') return 'none';
              // Request edges have arrows
              return type === 'request' ? 'triangle' : 'none';
            },
            'target-arrow-color': (ele: EdgeSingular) => {
              const type = ele.data('type');
              return EDGE_COLORS[type] || '#95a5a6';
            },
            'source-arrow-shape': (ele: EdgeSingular) => {
              // Show arrow at source for reciprocal requests
              const type = ele.data('type');
              const reciprocal = ele.data('reciprocal');

              // Sibling edges never have arrows
              if (type === 'sibling') return 'none';
              // Request edges have source arrow only if reciprocal
              return type === 'request' && reciprocal ? 'triangle' : 'none';
            },
            'source-arrow-color': (ele: EdgeSingular) => {
              const type = ele.data('type');
              return EDGE_COLORS[type] || '#95a5a6';
            },
            'line-opacity': (ele: EdgeSingular) => {
              const confidence = ele.data('confidence') || 0.5;
              // Opacity based on confidence: 0.3 to 0.9
              return Math.max(0.3, Math.min(0.9, confidence));
            },
            'curve-style': (ele: EdgeSingular) => {
              return ele.data('curveStyle') || 'straight';
            },
            'control-point-step-size': 40,
            'overlay-padding': '3px',
          }
        }
      ],
      // Don't set layout in initialization - we'll run it after adding elements
      // wheelSensitivity: 0.3, // Removed to avoid warning
      minZoom: 0.5,
      maxZoom: 3,
    });

    cyRef.current = cy;

    // Convert graph data to Cytoscape format
    const elements: cytoscape.ElementDefinition[] = [];
    const nodeDegrees: Record<string, number> = {};
    
    // Calculate node degrees first
    graphData.edges.forEach(edge => {
      const sourceId = `node-${edge.source}`;
      const targetId = `node-${edge.target}`;
      nodeDegrees[sourceId] = (nodeDegrees[sourceId] || 0) + 1;
      nodeDegrees[targetId] = (nodeDegrees[targetId] || 0) + 1;
    });
    
    // Calculate grade colors based on bunk structure (lower/upper grades)
    // For camp bunks, typically lower grades are the younger campers
    const grades = [...new Set(graphData.nodes.map(n => n.grade).filter(g => g !== null))] as number[];
    grades.sort((a, b) => a - b);
    const gradeColors: Record<number, string> = {};
    
    if (grades.length > 0) {
      // In camp bunks, lower number grades are younger (e.g., 3rd grade < 5th grade)
      if (grades.length === 2) {
        // 2-grade bunk: youngest = blue, oldest = red
        const [grade0, grade1] = grades;
        if (grade0 !== undefined) gradeColors[grade0] = '#3498db'; // Youngest - blue
        if (grade1 !== undefined) gradeColors[grade1] = '#e74c3c'; // Oldest - red
      } else if (grades.length === 3) {
        // 3-grade bunk: youngest = blue, middle = red, oldest = dark teal
        const [grade0, grade1, grade2] = grades;
        if (grade0 !== undefined) gradeColors[grade0] = '#3498db'; // Youngest - blue
        if (grade1 !== undefined) gradeColors[grade1] = '#e74c3c'; // Middle - red
        if (grade2 !== undefined) gradeColors[grade2] = '#16a085'; // Oldest - dark teal
      } else {
        // Single grade - just use blue
        const grade0 = grades[0];
        if (grade0 !== undefined) gradeColors[grade0] = '#3498db';
      }
    }
    
    // Add nodes with vertical randomization
    graphData.nodes.forEach((node, index) => {
      const nodeId = `node-${node.id}`;
      const degree = nodeDegrees[nodeId] || 0;
      
      // Add significant vertical randomization to reduce text overlap
      const verticalOffset = (Math.random() - 0.5) * 300; // -150 to +150 range
      
      const nodeClasses = [];
      if (degree === 0) nodeClasses.push('isolated');
      if (node.first_year) nodeClasses.push('first-year');
      
      elements.push({
        group: 'nodes',
        data: {
          ...node,
          id: nodeId, // Override node.id with string version
          // Display full name with grade and historical info
          label: `${node.name} (${formatGradeOrdinal(node.grade)})${node.first_year ? ' ①' : ''}${
            node.last_year_bunk && node.last_year_session
              ? `\n${getSessionShorthand(node.last_year_session)}: ${node.last_year_bunk}` 
              : ''
          }`,
          fullName: node.name,
          degree: degree,
          gradeColor: node.grade ? gradeColors[node.grade] : '#666666',
          firstYear: node.first_year || false,
        },
        position: { x: index * 100, y: verticalOffset }, // Even horizontal spacing, random vertical
        classes: nodeClasses.join(' '),
      });
    });

    // Process edges - backend sends separate edges for sibling and request relationships

    
    let edgeIndex = 0;
    const processedSiblingPairs = new Set<string>();
    
    // First pass: Build complete edge map and detect edge types per pair
    const edgesByKey: Record<string, GraphEdge> = {};
    const nodePairEdgeTypes: Record<string, Set<string>> = {};
    
    // Build complete edge map first
    graphData.edges.forEach((edge) => {
      const directionalKey = `${edge.source}-${edge.target}-${edge.type}`;
      edgesByKey[directionalKey] = edge;
      
      // Track edge types per node pair
      const pairKey = [edge.source, edge.target].sort().join('-');
      if (!nodePairEdgeTypes[pairKey]) {
        nodePairEdgeTypes[pairKey] = new Set();
      }
      nodePairEdgeTypes[pairKey].add(edge.type);
    });
    
    // Note: We don't need to detect reciprocals - the backend already provides this information
    
    // Third pass: Process edges
    graphData.edges.forEach((edge) => {
      // Skip duplicate sibling edges (they're bidirectional)
      if (edge.type === 'sibling') {
        const siblingKey = [edge.source, edge.target].sort().join('-');
        if (processedSiblingPairs.has(siblingKey)) {
          return;
        }
        processedSiblingPairs.add(siblingKey);
      }
      
      // Note: We're NOT skipping duplicate request edges anymore
      // The backend sends both directions of mutual requests and we need both
      // to show reciprocal arrows
      
      // Check if this node pair has multiple edge types
      const pairKey = [edge.source, edge.target].sort().join('-');
      const edgeTypes = nodePairEdgeTypes[pairKey];
      const hasMultipleTypes = edgeTypes ? edgeTypes.size > 1 : false;
      

      
      elements.push({
        group: 'edges',
        data: {
          ...edge, // Spread first to include all edge properties (including reciprocal from backend)
          id: `edge-${edgeIndex++}`, // Override with string version
          source: `node-${edge.source}`, // Override with string version
          target: `node-${edge.target}`, // Override with string version
          // Use bezier curves when there are multiple edge types between nodes
          curveStyle: hasMultipleTypes ? 'bezier' : 'straight',
          type: edge.type, // Ensure type is explicitly set
          // Don't override reciprocal - it's already in ...edge
        },
      });
    });

    cy.add(elements);
    
    // Run layout after adding elements
    // Use cola for better layout control
    const layout = cy.layout({
      name: 'cola'
    });
    
    layoutRef.current = layout;
    layout.run();

    // Add click handler for nodes
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const nodeId = node.data('id'); // This is "node-123"
      const camperId = nodeId.replace('node-', ''); // Extract just the numeric ID
      setSelectedCamperId(camperId);
    });

    return () => {
      // Stop layout if running
      if (layoutRef.current && typeof layoutRef.current.stop === 'function') {
        layoutRef.current.stop();
      }
      layoutRef.current = null;
      
      if (cy && !cy.destroyed()) {
        // Remove all event listeners first
        cy.removeAllListeners();
        cy.nodes().removeAllListeners();
        cy.edges().removeAllListeners();
        // Then destroy
        cy.destroy();
      }
      cyRef.current = null;
    };
  }, [graphData, isOpen]);

  // Handle resize when details panel opens/closes
  useEffect(() => {
    if (cyRef.current && !cyRef.current.destroyed()) {
      const cy = cyRef.current;
      setTimeout(() => {
        if (cy && !cy.destroyed()) {
          cy.resize();
          cy.fit();
        }
      }, 350); // After transition
    }
  }, [selectedCamperId]);

  // Export graph as PNG
  const handleExport = () => {
    if (!cyRef.current) return;
    
    const png = cyRef.current.png({
      output: 'blob',
      bg: 'white',
      scale: 2,
      full: true,
    });

    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bunkName.replace(/\s+/g, '_')}_social_network.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Navigate to previous bunk (circular)
  const handlePreviousBunk = () => {
    if (sessionBunks.length > 0) {
      // Wrap around to last bunk if at first
      const prevIndex = currentBunkIndex === 0 ? sessionBunks.length - 1 : currentBunkIndex - 1;
      const prevBunk = sessionBunks[prevIndex];
      if (prevBunk && onBunkChange) {
        onBunkChange(prevBunk.cm_id, prevBunk.name);
      } else {
        onClose();
      }
    }
  };

  // Navigate to next bunk (circular)
  const handleNextBunk = () => {
    if (sessionBunks.length > 0) {
      // Wrap around to first bunk if at last
      const nextIndex = currentBunkIndex === sessionBunks.length - 1 ? 0 : currentBunkIndex + 1;
      const nextBunk = sessionBunks[nextIndex];
      if (nextBunk && onBunkChange) {
        onBunkChange(nextBunk.cm_id, nextBunk.name);
      } else {
        onClose();
      }
    }
  };

  // Zoom controls for mobile
  const handleZoomIn = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom(cyRef.current.zoom() * 1.2);
    cyRef.current.center();
  };

  const handleZoomOut = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom(cyRef.current.zoom() * 0.8);
    cyRef.current.center();
  };

  const handleFit = () => {
    if (!cyRef.current) return;
    cyRef.current.fit();
  };

  // Check if this is an AG bunk or single bunk session
  const isAGBunk = bunkName.includes('AG') || bunkName.startsWith('AG');
  const hideNavigation = isAGBunk || sessionBunks.length === 0;
  


  // Use Activity to preserve state when hidden while unmounting effects
  // The backdrop transitions in/out based on isOpen
  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-start p-0 sm:p-4 transition-all duration-300",
        isOpen ? "bg-black/50 pointer-events-auto" : "bg-transparent pointer-events-none opacity-0"
      )}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Activity mode={isOpen ? 'visible' : 'hidden'}>
      <div className={`bg-card rounded-none sm:rounded-2xl shadow-lodge-xl overflow-hidden transition-all duration-300 sm:ml-4 ${
        selectedCamperId
          ? 'w-full h-full sm:w-[calc(95vw-20rem)] md:w-[calc(95vw-26rem)] sm:max-h-[95vh]'
          : 'w-full h-full sm:w-[95vw] sm:max-h-[95vh]'
      }`}>
        {/* Modal Header */}
        <div className="p-3 sm:p-4 border-b border-border safe-area-top">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:relative">
            <h2 className="text-lg sm:text-xl font-display font-semibold flex items-center gap-2 min-w-0 text-foreground">
              <Network className="w-5 h-5 flex-shrink-0 text-primary" />
              <span className="truncate">{bunkName} Social Network</span>
            </h2>
            
            {/* Navigation - responsive layout */}
            {!hideNavigation && sessionBunks.length > 1 && (
              <div className="flex items-center gap-1 sm:gap-2 sm:absolute sm:left-1/2 sm:transform sm:-translate-x-1/2">
                <button
                  onClick={handlePreviousBunk}
                  className="p-2 sm:p-1.5 rounded-xl transition-colors touch-manipulation hover:bg-forest-50/50 dark:hover:bg-forest-950/30 text-muted-foreground hover:text-foreground active:bg-forest-100 dark:active:bg-forest-900/40"
                  title="Previous bunk"
                >
                  <ChevronLeft className="w-6 h-6 sm:w-5 sm:h-5" />
                </button>
                <button
                  onClick={handleNextBunk}
                  className="p-2 sm:p-1.5 rounded-xl transition-colors touch-manipulation hover:bg-forest-50/50 dark:hover:bg-forest-950/30 text-muted-foreground hover:text-foreground active:bg-forest-100 dark:active:bg-forest-900/40"
                  title="Next bunk"
                >
                  <ChevronRight className="w-6 h-6 sm:w-5 sm:h-5" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto sm:ml-0">
              <button
                onClick={handleExport}
                className="p-2.5 sm:p-2 hover:bg-forest-50/50 dark:hover:bg-forest-950/30 rounded-xl touch-manipulation active:bg-forest-100 dark:active:bg-forest-900/40 transition-colors"
                title="Download as PNG"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2.5 sm:p-2 hover:bg-forest-50/50 dark:hover:bg-forest-950/30 rounded-xl touch-manipulation active:bg-forest-100 dark:active:bg-forest-900/40 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-3 sm:p-4 h-[calc(100%-4rem)] sm:h-auto overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 sm:h-96">
              <div className="text-gray-500 text-center px-4">Loading bunk social network...</div>
            </div>
          ) : graphData ? (
            graphData.nodes.length === 0 ? (
              <div className="flex items-center justify-center h-64 sm:h-96">
                <div className="text-gray-500 text-center px-4">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-medium mb-2">No Campers Found</h3>
                  <p className="text-sm">
                    {bunkName.includes('AG') || bunkName.startsWith('AG') 
                      ? 'This AG bunk does not have any assigned campers yet.'
                      : 'This bunk does not have any assigned campers for this session.'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Metrics Bar */}
                <div className="mb-3 sm:mb-4 grid grid-cols-3 gap-2 sm:gap-4">
                  <div className="bg-forest-50/40 dark:bg-forest-950/30 p-2 sm:p-3 rounded-xl">
                    <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Users className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span className="hidden sm:inline">Total Campers</span>
                      <span className="sm:hidden">Total</span>
                    </div>
                    <div className="text-lg sm:text-2xl font-semibold text-foreground">
                      {graphData.nodes.length}
                    </div>
                  </div>

                <div className="bg-forest-50/40 dark:bg-forest-950/30 p-2 sm:p-3 rounded-xl">
                  <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
                    <ActivityIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Grade Range</span>
                    <span className="sm:hidden">Grades</span>
                  </div>
                  <div className="text-sm sm:text-lg font-semibold">
                    {(() => {
                      const grades = graphData.nodes
                        .map(n => n.grade)
                        .filter(g => g !== null) as number[];
                      if (grades.length === 0) return 'N/A';
                      
                      // Count campers per grade
                      const gradeCounts: Record<number, number> = {};
                      grades.forEach(grade => {
                        gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
                      });
                      
                      const uniqueGrades = Object.keys(gradeCounts).map(Number).sort((a, b) => a - b);
                      const minGrade = uniqueGrades[0];
                      if (minGrade === undefined) {
                        return 'Unknown grade';
                      }
                      
                      // Format grade range with counts
                      if (uniqueGrades.length === 1) {
                        const count = gradeCounts[minGrade];
                        return `${formatGradeOrdinal(minGrade)} (${count || 0})`;
                      } else {
                        // Format as "3rd (4) - 4th (8)" instead of "3rd - 4th (4, 8)"
                        const formattedGrades = uniqueGrades.map(g => 
                          `${formatGradeOrdinal(g)} (${gradeCounts[g]})`
                        ).join(' - ');
                        return formattedGrades;
                      }
                    })()}
                  </div>
                </div>
                
                <div className="bg-forest-50/40 dark:bg-forest-950/30 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="w-4 h-4" />
                    Isolated
                  </div>
                  <div className={clsx(
                    "text-2xl font-semibold",
                    graphData.metrics.isolated_count === 0 ? "text-forest-600" : "text-destructive"
                  )}>
                    {graphData.metrics.isolated_count}
                  </div>
                </div>
              </div>


              {/* Graph Container */}
              <div className="relative bg-parchment-50/50 dark:bg-forest-950/20 rounded-xl border border-border">
                
                <div 
                  ref={containerRef} 
                  className="w-full h-[50vh] sm:h-[70vh]"
                />
                
                {/* Mobile Controls */}
                <div className="absolute top-2 right-2 flex flex-col gap-2 sm:hidden">
                  <button
                    onClick={handleZoomIn}
                    className="p-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lodge-sm touch-manipulation"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleZoomOut}
                    className="p-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lodge-sm touch-manipulation"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleFit}
                    className="p-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lodge-sm touch-manipulation"
                    title="Fit to screen"
                  >
                    <Maximize2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setShowLegend(!showLegend)}
                    className="p-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lodge-sm touch-manipulation"
                    title="Toggle legend"
                  >
                    <Info className="w-5 h-5" />
                  </button>
                </div>

                {/* Legend - Collapsible on mobile, fixed on desktop */}
                <div className={clsx(
                  "absolute bottom-2 left-2 bg-card/95 backdrop-blur-sm p-2 rounded-xl text-xs transition-all shadow-lodge-sm border border-border",
                  "hidden sm:block", // Always show on desktop
                  showLegend && "!block" // Show on mobile when toggled
                )}>
                  <div className="font-semibold mb-2 text-foreground">Graph Legend</div>

                  {/* Node Status */}
                  <div className="mb-2">
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">Connections</div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500 dark:bg-red-600 border border-gray-600 dark:border-gray-400"></div>
                        <span>Isolated (0)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-500 dark:bg-yellow-600 border border-gray-600 dark:border-gray-400"></div>
                        <span>Few (1-2)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500 dark:bg-green-600 border border-gray-600 dark:border-gray-400"></div>
                        <span>Good (3+)</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Edge Types */}
                  <div className="mb-2">
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">Relationships</div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <svg width="24" height="10" className="flex-shrink-0">
                          <defs>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                                    refX="9" refY="3.5" orient="auto">
                              <polygon points="0 0, 10 3.5, 0 7" fill="#3498db" />
                            </marker>
                          </defs>
                          <line x1="0" y1="5" x2="20" y2="5" stroke="#3498db" strokeWidth="2" 
                                markerEnd="url(#arrowhead)" />
                        </svg>
                        <span>Request</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-0.5 bg-red-500"></div>
                        <span>Siblings</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Directionality */}
                  <div className="mb-2">
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">Direction</div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]">→</span>
                        <span>One-way</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px]">↔</span>
                        <span>Mutual</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Grade Indicators */}
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">Grade Level</div>
                    <div className="space-y-0.5">
                      {(() => {
                        // Get grade counts
                        const allGrades = graphData.nodes.map(n => n.grade).filter(g => g !== null) as number[];
                        const gradeCounts: Record<number, number> = {};
                        allGrades.forEach(grade => {
                          gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
                        });
                        const uniqueGrades = Object.keys(gradeCounts).map(Number).sort((a, b) => a - b);
                        
                        if (uniqueGrades.length === 0) return null;
                        
                        if (uniqueGrades.length === 1) {
                          return (
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full border-2 border-blue-500"></div>
                              <span>{formatGradeOrdinal(uniqueGrades[0] || 0)} ({gradeCounts[uniqueGrades[0] || 0] || 0})</span>
                            </div>
                          );
                        } else if (uniqueGrades.length === 2) {
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-blue-500"></div>
                                <span>{formatGradeOrdinal(uniqueGrades[0] || 0)} ({gradeCounts[uniqueGrades[0] || 0] || 0})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-red-500"></div>
                                <span>{formatGradeOrdinal(uniqueGrades[1] || 0)} ({gradeCounts[uniqueGrades[1] || 0] || 0})</span>
                              </div>
                            </>
                          );
                        } else if (uniqueGrades.length === 3) {
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-blue-500"></div>
                                <span>{formatGradeOrdinal(uniqueGrades[0] || 0)} ({gradeCounts[uniqueGrades[0] || 0] || 0})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-red-500"></div>
                                <span>{formatGradeOrdinal(uniqueGrades[1] || 0)} ({gradeCounts[uniqueGrades[1] || 0] || 0})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-teal-600"></div>
                                <span>{formatGradeOrdinal(uniqueGrades[2] || 0)} ({gradeCounts[uniqueGrades[2] || 0] || 0})</span>
                              </div>
                            </>
                          );
                        }
                      })()}
                      {graphData.nodes.some(n => n.first_year) && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full border-[3px] border-purple-500"></div>
                          <span>First year ①</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              </>
            )
          ) : (
            <div className="flex items-center justify-center h-64 sm:h-96">
              <div className="text-gray-500 text-center px-4">No social network data available</div>
            </div>
          )}
        </div>
      </div>
      
      {/* Camper Details Panel */}
      {selectedCamperId && (
        <CamperDetailsPanel
          camperId={selectedCamperId}
          onClose={() => setSelectedCamperId(null)}
        />
      )}
      </Activity>
    </div>
  );
}