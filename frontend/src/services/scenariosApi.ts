/**
 * Scenario creation and clearing — the backend path kindred#2021 built.
 *
 * Creation and clearing used to be client-side: `useCreateScenario` wrote
 * `saved_scenarios` through the raw PocketBase SDK and then copied
 * assignments itself (`copyProductionToScenario` / `copyScenarioToScenario`,
 * `bunk_assignments_draft` only), and `useClearScenario` deleted
 * `bunk_assignments_draft` rows directly. Both were summer-only in
 * substance: a weekend scenario has no `bunk_assignments_draft` rows, so
 * "copy from CampMinder" silently copied zero rows and Clear reported
 * success while deleting nothing — the bug kindred#2021 is titled after.
 *
 * `POST /api/scenarios` and `POST /api/scenarios/{id}/clear` are
 * program-aware server-side: they read `session.session_type` and choose
 * `bunk_assignments(_draft)` or `lodging_assignments(_draft)` accordingly.
 * One backend path is what lets the modal offer the same three choices,
 * worded and laid out identically, for both programs (the owner's actual
 * requirement — see the newest comment on kindred#2021).
 *
 * Every function takes `fetchWithAuth` as its first parameter, matching
 * `lodgingApi.ts` — the PocketBase JWT lives in localStorage, so a raw
 * fetch silently 401s (frontend/CLAUDE.md).
 */

import type { FetchWithAuth } from './lodgingApi'
import type { Scenario } from '../hooks/useScenario'
import { ApiError, toApiError } from './apiError'

const API_BASE = '/api/scenarios'

/** An API failure that still knows its HTTP status. See `apiError.ts` for
 * why this stays its own subclass rather than a shared `ApiError`. */
export class ScenarioApiError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status)
    this.name = 'ScenarioApiError'
  }
}

async function toError(response: Response, fallback: string): Promise<ScenarioApiError> {
  return toApiError(response, fallback, ScenarioApiError)
}

/** What the create modal asks the backend to seed the new scenario with. */
export type ScenarioCopySource = { fromProduction: boolean } | { fromScenario: string }

export interface CreateScenarioParams {
  name: string
  sessionCmId: number
  year: number
  description?: string
  copyFrom?: ScenarioCopySource
}

/**
 * Create a scenario: blank, copied from production, or copied from another
 * scenario — program-aware server-side. The response is already
 * `Scenario`-shaped (`session_cm_id` flat, resolved from the `session`
 * relation server-side), unlike a raw PocketBase record, so no
 * `savedScenarioToScenario` unwrap is needed here.
 */
export async function createScenario(
  fetchWithAuth: FetchWithAuth,
  { name, sessionCmId, year, description, copyFrom }: CreateScenarioParams
): Promise<Scenario> {
  const copyFields =
    copyFrom === undefined
      ? {}
      : 'fromProduction' in copyFrom
        ? { copy_from_production: copyFrom.fromProduction }
        : { copy_from_scenario: copyFrom.fromScenario }

  const response = await fetchWithAuth(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      session_cm_id: sessionCmId,
      year,
      ...(description !== undefined && { description }),
      ...copyFields,
    }),
  })
  if (!response.ok) throw await toError(response, 'Failed to create the scenario')
  return response.json() as Promise<Scenario>
}

/** What a clear reports — the message the server already composed. */
export interface ClearScenarioResult {
  message: string
}

/**
 * Clear every assignment in a scenario — program-aware server-side
 * (`bunk_assignments_draft` for summer, `lodging_assignments_draft` for a
 * weekend). Before this routed through the backend, the client-side
 * version only ever deleted `bunk_assignments_draft`, so a weekend Clear
 * reported success while deleting nothing.
 */
export async function clearScenario(
  fetchWithAuth: FetchWithAuth,
  scenarioId: string,
  year: number
): Promise<ClearScenarioResult> {
  const response = await fetchWithAuth(`${API_BASE}/${encodeURIComponent(scenarioId)}/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year }),
  })
  if (!response.ok) throw await toError(response, 'Failed to clear the scenario')
  return response.json() as Promise<ClearScenarioResult>
}
