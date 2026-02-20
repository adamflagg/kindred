/**
 * QueryGuard - App-wide loading/error/empty state handler.
 *
 * Re-exports MetricsQueryGuard under a general-purpose name so it can be
 * used in any data-fetching component, not just metrics pages.
 */

export { MetricsQueryGuard as QueryGuard } from './metrics/MetricsQueryGuard'
