/**
 * localStorage helpers for last-active-scenario persistence.
 *
 * Stores scenario selections per session so:
 *  - switching sessions doesn't lose your choice for another session
 *  - refreshing the page restores the last selected scenario
 *
 * Storage format: { [sessionCmId: string]: scenarioId }
 * Key: SCENARIO_STORAGE_KEY
 */

export const SCENARIO_STORAGE_KEY = 'kindred.scenarioBySession'

function readStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SCENARIO_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * Returns the stored scenario id for the given session, or null if none.
 */
export function getStoredScenarioId(sessionCmId: number): string | null {
  if (!sessionCmId) return null
  const store = readStore()
  return store[String(sessionCmId)] ?? null
}

/**
 * Persists the selected scenario id for the given session.
 */
export function setStoredScenarioId(sessionCmId: number, scenarioId: string): void {
  if (!sessionCmId) return
  const store = readStore()
  store[String(sessionCmId)] = scenarioId
  localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(store))
}

/**
 * Removes the stored scenario id for the given session (user switched to production mode).
 */
export function clearStoredScenarioId(sessionCmId: number): void {
  if (!sessionCmId) return
  const store = readStore()
  Reflect.deleteProperty(store, String(sessionCmId))
  localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(store))
}
