// frontend/src/utils/deriveSlicesFromSatisfactionMap.ts
import type { BunkRequest } from '../types/app-types'
import type { SatisfiedRequestInfo } from '../contexts/BunkRequestContext'
import type { SatisfactionMap } from '../hooks/camper/types'
import { computeSlicesFromPredicate } from './computeSlicesFromPredicate'

/**
 * Prod-aligned slice computation. Builds the satisfaction predicate from a
 * pre-computed SatisfactionMap (typically from useSatisfactionData) and
 * delegates to the shared aggregator for source classification + slice math.
 *
 * Used by BunkingStatusPanel where the satisfaction state is sourced from
 * persisted PocketBase assignments rather than the live in-memory scenario.
 */
export function deriveSlicesFromSatisfactionMap(
  personRequests: BunkRequest[],
  satisfactionMap: SatisfactionMap
): SatisfiedRequestInfo {
  return computeSlicesFromPredicate(
    personRequests,
    (req) => satisfactionMap[req.id]?.status === 'satisfied'
  )
}
