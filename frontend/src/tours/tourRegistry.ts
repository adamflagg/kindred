import type { TourId, TourDefinition } from './types'

/** Map route patterns to tour IDs */
const routeToTour: Record<string, TourId> = {
  '/summer/debug': 'debug',
  '/summer/debug/pipeline': 'debug',
  '/summer/debug/prompts': 'debug',
  '/analytics/retention': 'retention-overview',
  '/analytics/retention/flow': 'retention-flow',
  '/analytics/retention/bunks': 'retention-bunks',
  '/analytics/retention/staff': 'retention-staff',
}

/** Look up the tour ID for a given route pathname */
export function getTourIdForRoute(pathname: string): TourId | null {
  // Normalize trailing slash
  const normalized = pathname.replace(/\/$/, '') || '/'
  return routeToTour[normalized] ?? null
}

/** Lazy-load a tour definition by ID */
export async function loadTourDefinition(tourId: TourId): Promise<TourDefinition> {
  const loaders: Record<TourId, () => Promise<{ default: TourDefinition }>> = {
    debug: () => import('./definitions/debugTour'),
    'retention-overview': () => import('./definitions/retentionOverviewTour'),
    'retention-flow': () => import('./definitions/retentionFlowTour'),
    'retention-bunks': () => import('./definitions/retentionBunksTour'),
    'retention-staff': () => import('./definitions/retentionStaffTour'),
  }

  const loader = loaders[tourId]
  const module = await loader()
  return module.default
}
