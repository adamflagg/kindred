/**
 * GraphHelp component
 * Extracted from SocialNetworkGraph.tsx - displays help information
 */

import { HelpCircle } from 'lucide-react';

export default function GraphHelp() {
  return (
    <div className="bg-forest-50/50 dark:bg-forest-950/30 rounded-b-2xl p-4 border-t border-border">
      <h4 className="font-medium mb-2 flex items-center gap-2 text-forest-800 dark:text-forest-200">
        <HelpCircle className="w-4 h-4 text-forest-600 dark:text-forest-400" />
        Understanding the Social Network Graph
      </h4>
      <div className="text-sm space-y-2 text-forest-700 dark:text-forest-300">
        <div>
          <strong className="text-forest-800 dark:text-forest-200">
            View Modes:
          </strong>
          <ul className="ml-4 mt-1 space-y-1 list-disc list-inside">
            <li>
              <strong className="text-forest-800 dark:text-forest-200">
                All Connections:
              </strong>{' '}
              Shows the complete social network with all request types
            </li>
            <li>
              <strong className="text-forest-800 dark:text-forest-200">
                Ego Network:
              </strong>{' '}
              Click on any camper to see only their direct connections (1-hop
              network)
            </li>
          </ul>
        </div>
        <div>
          <strong className="text-forest-800 dark:text-forest-200">
            Edge Directionality:
          </strong>{' '}
          Arrows show the direction of requests. More opaque lines = higher
          confidence. Dashed lines indicate bundled relationships (multiple
          types between same campers).
        </div>
        <div>
          <strong className="text-forest-800 dark:text-forest-200">
            Node Size:
          </strong>{' '}
          Larger nodes have more connections (higher centrality in the network).
        </div>
      </div>
    </div>
  );
}
