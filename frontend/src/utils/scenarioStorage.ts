// Storage format: { [sessionCmId]: scenarioId }
export const SCENARIO_STORAGE_KEY = 'kindred.scenarioBySession'

function readStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SCENARIO_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, string>): void {
  try {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Swallow storage errors (QuotaExceededError, SecurityError, etc.).
    // Persistence is best-effort; the app continues without it.
  }
}

export function getStoredScenarioId(sessionCmId: number): string | null {
  if (!sessionCmId) return null
  const store = readStore()
  return store[String(sessionCmId)] ?? null
}

export function setStoredScenarioId(sessionCmId: number, scenarioId: string): void {
  if (!sessionCmId) return
  const store = readStore()
  store[String(sessionCmId)] = scenarioId
  writeStore(store)
}

export function clearStoredScenarioId(sessionCmId: number): void {
  if (!sessionCmId) return
  const store = readStore()
  Reflect.deleteProperty(store, String(sessionCmId))
  writeStore(store)
}
