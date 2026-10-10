import { useMemo } from 'react'

import { programLabels, programRank } from '../../components/camperships/requests/programLabel'
import { useAidApprovedRules } from './useAidRules'

/**
 * The season's program words, from the approved rules (each program names itself; owner title
 * case 10-03). Show a key through `programLabel(names, key)`, never `keyWords`: while the rules load,
 * fail or 404, `programLabel` spells the key out. Shares the rules read's cache entry.
 */
export function useAidProgramNames(): Readonly<Record<string, string>> {
  const rules = useAidApprovedRules(null)
  return useMemo(() => programLabels(rules.data), [rules.data])
}

/** Where each program sits in the rules' pool order (`programRank`); shares the rules read's cache entry. */
export function useAidProgramRank(): (program: string) => number {
  const rules = useAidApprovedRules(null)
  return useMemo(() => programRank(rules.data), [rules.data])
}
