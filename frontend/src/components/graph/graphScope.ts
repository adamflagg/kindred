/**
 * Pure resolvers for the session graph's effective scope + graceful degradation.
 * Kept free of React so they can be unit-tested in isolation.
 */
import {
  filterBunksByGender,
  scopeToTab,
  type GenderScope,
  type BunkSummaryWithGender,
} from './genderFilter'

export interface ScopeInput {
  gender: GenderScope
  manualUnits: string[]
  manualBunks: string[]
  /** Bunk codes the user dropped from the gender-derived set (ephemeral). */
  dropped: ReadonlySet<string>
  /** Roster of the CURRENT data-session (main, or AG when gender==='ag'). */
  roster: BunkSummaryWithGender[]
}

export interface ResolvedScope {
  units: string[]
  bunks: string[]
  /** True when the resolved scope is meant to filter (gender on, or manual selection). */
  active: boolean
}

/**
 * Resolve the units/bunks to fetch.
 * - gender !== 'all': derive that gender's cabins from the roster, minus dropped.
 *   `active` is true even if the derived set is empty (so an empty result degrades).
 * - gender === 'all': pass the manual units/bunks through; active iff anything selected.
 */
export function resolveEffectiveScope(input: ScopeInput): ResolvedScope {
  if (input.gender !== 'all') {
    const derived = filterBunksByGender(input.roster, scopeToTab(input.gender))
    const bunks = derived.filter((code) => !input.dropped.has(code))
    return { units: [], bunks, active: true }
  }
  const active = input.manualUnits.length > 0 || input.manualBunks.length > 0
  return { units: input.manualUnits, bunks: input.manualBunks, active }
}

export function shouldDegrade(args: {
  scopeActive: boolean
  isLoading: boolean
  hasError: boolean
  nodeCount: number
}): boolean {
  return args.scopeActive && !args.isLoading && !args.hasError && args.nodeCount === 0
}

export function genderBannerText(gender: GenderScope): string {
  switch (gender) {
    case 'boys':
      return 'No boys bunked in this session yet — showing everyone.'
    case 'girls':
      return 'No girls bunked in this session yet — showing everyone.'
    case 'ag':
      return 'No AG campers bunked yet — showing everyone.'
    default:
      return ''
  }
}
