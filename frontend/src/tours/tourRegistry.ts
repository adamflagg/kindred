import type { TourId, TourDefinition, LayerId, LayerDefinition } from './types'

/** Map route patterns to tour IDs */
const routeToTour: Record<string, TourId> = {
  '/summer/debug': 'debug',
  '/summer/debug/pipeline': 'debug',
  '/summer/debug/parse-analysis': 'debug',
  '/summer/debug/prompt-editor': 'debug',
  '/summer/debug/solver': 'debug',
  // Retention
  '/analytics/retention': 'retention-overview',
  '/analytics/retention/flow': 'retention-flow',
  '/analytics/retention/bunks': 'retention-bunks',
  '/analytics/retention/staff': 'retention-staff',
  // Registration
  '/analytics/registration/overview': 'registration-overview',
  '/analytics/registration/geo': 'registration-geo',
  '/analytics/registration/waitlist': 'registration-waitlist',
  '/analytics/registration/availability': 'registration-availability',
  '/analytics/registration/forecast': 'registration-forecast',
  '/analytics/registration/cancellations': 'registration-cancellations',
  '/analytics/registration/day1': 'registration-day1',
  // Trends
  '/analytics/trends': 'trends-overview',
  '/analytics/trends/velocity': 'trends-velocity',
  '/analytics/trends/cancellations': 'trends-cancellations',
}

/** Look up the tour ID for a given route pathname */
export function getTourIdForRoute(pathname: string): TourId | null {
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
    'registration-overview': () => import('./definitions/registrationOverviewTour'),
    'registration-geo': () => import('./definitions/registrationGeoTour'),
    'registration-waitlist': () => import('./definitions/registrationWaitlistTour'),
    'registration-availability': () => import('./definitions/registrationAvailabilityTour'),
    'registration-forecast': () => import('./definitions/registrationForecastTour'),
    'registration-cancellations': () => import('./definitions/registrationCancellationsTour'),
    'registration-day1': () => import('./definitions/registrationDay1Tour'),
    'trends-overview': () => import('./definitions/trendsOverviewTour'),
    'trends-velocity': () => import('./definitions/trendsVelocityTour'),
    'trends-cancellations': () => import('./definitions/trendsCancellationsTour'),
  }

  const loader = loaders[tourId]
  const module = await loader()
  return module.default
}

/** Lazy-load a layer definition by ID */
export async function loadLayerDefinition(layerId: LayerId): Promise<LayerDefinition> {
  const loaders: Record<LayerId, () => Promise<{ default: LayerDefinition }>> = {
    'metrics-header': () => import('./layers/metricsHeaderLayer'),
    'registration-intro': () => import('./layers/registrationIntroLayer'),
    'trends-intro': () => import('./layers/trendsIntroLayer'),
  }

  const loader = loaders[layerId]
  const module = await loader()
  return module.default
}
