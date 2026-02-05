/**
 * GraphMetrics component
 * Extracted from SocialNetworkGraph.tsx - displays network metrics
 */

import type { GraphData } from '../../types/graph'

export interface GraphMetricsProps {
  /** Graph data containing metrics */
  graphData: GraphData
}

export default function GraphMetrics({ graphData }: GraphMetricsProps) {
  if (!graphData.metrics) {
    return null
  }

  return (
    <div className="bg-card/95 border-border shadow-lodge-sm absolute bottom-4 left-4 rounded-xl border p-3 text-sm backdrop-blur-sm">
      <div className="text-foreground mb-2 font-medium">Network Metrics</div>
      <div className="text-muted-foreground space-y-1 text-xs">
        <div>
          Nodes: <span className="text-foreground">{graphData.nodes.length}</span>
        </div>
        <div>
          Edges: <span className="text-foreground">{graphData.edges.length}</span>
        </div>
        <div>
          Density:{' '}
          <span className="text-foreground">{(graphData.metrics.density * 100).toFixed(1)}%</span>
        </div>
        <div>
          Avg Clustering:{' '}
          <span className="text-foreground">{graphData.metrics.average_clustering.toFixed(3)}</span>
        </div>
        <div>
          Communities:{' '}
          <span className="text-foreground">{graphData.metrics['num_communities']}</span>
        </div>
        <div>
          Isolated:{' '}
          <span className="text-foreground">{graphData.metrics['isolated_nodes']} nodes</span>
        </div>
      </div>
    </div>
  )
}
