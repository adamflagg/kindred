import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './queryKeys'

/** Invalidate every cache derived from session-scoped bunk requests / assignments. */
export function invalidateAssignmentDerivedQueries(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.socialGraphPrefix() })
  void qc.invalidateQueries({ queryKey: queryKeys.bunkSocialGraphPrefix() })
  void qc.invalidateQueries({ queryKey: queryKeys.satisfactionPrefix() })
}
