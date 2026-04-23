import type { Scenario } from '../hooks/useScenario'
import type { SavedScenario } from '../types/app-types'

// Convert SavedScenario to Scenario format.
// Must tolerate records created without `{ expand: 'session' }` (e.g. older
// flows) — missing expand must not throw.
export function savedScenarioToScenario(saved: SavedScenario): Scenario {
  // Get the session CM ID from the expanded relation if available.
  // Defensive: the generated PB type declares `expand` as required, but the
  // runtime record omits it when callers didn't pass `{ expand: 'session' }`
  // to the request. Treat as possibly-undefined so we fall back to 0 instead
  // of throwing "Cannot read properties of undefined (reading 'session')".
  const expand = saved.expand as { session?: { cm_id?: number } } | undefined
  const sessionCmId = expand?.session?.cm_id ?? 0

  return {
    id: saved.id,
    name: saved.name,
    session_cm_id: sessionCmId,
    created: saved.created,
    updated: saved.updated,
    is_active: saved.is_active,
    description: saved.description || '',
  }
}
