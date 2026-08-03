/**
 * Resolving which scenario a weekend is being read in.
 *
 * `ScenarioContext` holds ONE selection globally — `currentSessionId` is a
 * single slot — so the selection has to be checked against the weekend on
 * screen before it is used, not merely read.
 */

/** The minimum a caller needs to know about a selection. */
export interface ScenarioRef {
  id: string
  session_cm_id: number
}

/**
 * The scenario id to read this weekend with; `''` means the CampMinder mirror.
 *
 * A scenario belonging to a DIFFERENT session resolves to the mirror rather
 * than being passed through. Navigating between two weekends leaves the
 * previous weekend's selection in context for a render, and summer's session
 * view shares the same slot — so without this check a weekend could be read
 * against a scenario that has nothing to do with it. The server would not
 * catch it: `scenario` is a free-text id, and a scenario with no placements
 * for this weekend reads as a legitimately empty plan.
 */
export function scenarioForWeekend(
  currentScenario: ScenarioRef | null,
  sessionCmId: number | null
): string {
  if (currentScenario === null || sessionCmId === null) return ''
  return currentScenario.session_cm_id === sessionCmId ? currentScenario.id : ''
}

/**
 * Whether to offer the CampMinder seed.
 *
 * Only inside a scenario (the mirror has nothing to seed INTO), only when the
 * plan holds no placements, and only when the weekend actually has families —
 * an empty board is the correct rendering of a weekend nobody registered for,
 * and seeding it would copy nothing while implying the board was broken.
 */
export function shouldOfferSeed(
  scenario: string,
  counts: { parties_total?: number; parties_assigned?: number } | undefined
): boolean {
  if (scenario === '') return false
  const total = counts?.parties_total ?? 0
  const assigned = counts?.parties_assigned ?? 0
  return total > 0 && assigned === 0
}
