/**
 * GraphHelp component
 * Extracted from SocialNetworkGraph.tsx - displays help information
 */

import { HelpCircle } from 'lucide-react'

export default function GraphHelp() {
  return (
    <div className="bg-forest-50/50 dark:bg-forest-950/30 border-border rounded-b-2xl border-t p-4">
      <h4 className="text-forest-800 dark:text-forest-200 mb-2 flex items-center gap-2 font-medium">
        <HelpCircle className="text-forest-600 dark:text-forest-400 h-4 w-4" />
        Understanding the Social Network Graph
      </h4>
      <div className="text-forest-700 dark:text-forest-300 space-y-2 text-sm">
        <div>
          <strong className="text-forest-800 dark:text-forest-200">Edge Directionality:</strong>{' '}
          Arrows show the direction of requests. Dashed lines indicate bundled relationships
          (multiple types between same campers).
        </div>
        <div>
          <strong className="text-forest-800 dark:text-forest-200">Node Size:</strong> Larger nodes
          have more connections (higher centrality in the network).
        </div>
      </div>
    </div>
  )
}
