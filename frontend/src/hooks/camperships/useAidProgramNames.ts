import { useMemo } from 'react'

import { programRank, programWords } from '../../components/camperships/requests/programLabel'
import { useAidApprovedRules } from './useAidRules'

/**
 * The season's program words: the shared family words the approved read sends (`programWords`; At Camp, Quests,
 * Teen Programs, TBM, Family Camp, Adult Weekends; owner 2026-10-10). Show a key through `programLabel(names, key)`,
 * never `keyWords`: while the rules load, fail or 404, `programLabel` spells the key out. Shares the rules read's
 * cache entry.
 */
export function useAidProgramNames(): Readonly<Record<string, string>> {
  const rules = useAidApprovedRules(null)
  return useMemo(() => programWords(rules.data), [rules.data])
}

/** Where each program sits in the rules' pool order (`programRank`); shares the rules read's cache entry. */
export function useAidProgramRank(): (program: string) => number {
  const rules = useAidApprovedRules(null)
  return useMemo(() => programRank(rules.data), [rules.data])
}
