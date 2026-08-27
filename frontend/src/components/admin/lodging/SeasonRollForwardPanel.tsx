/**
 * Carry the lodging registry into a new season.
 *
 * Modelled on PopulateFromPreviousYear (ManageRegistrationPage), which does the
 * same job for registration dates and session availability: preview, then
 * apply, idempotent by existence check rather than a flag.
 *
 * THE WRITE IS SERVER-SIDE, which is where this diverges from that component.
 * It applies a few dozen flat config rows through the JS SDK; this is ~10 areas
 * plus ~118 units plus parent relinking, in an order that matters, and a
 * half-applied roll-forward is a broken registry.
 *
 * Values and `code` carry forward; `is_confirmed` does NOT (kindred#2500) — it
 * means "someone walked this cabin THIS season", so every unit a roll creates
 * lands unconfirmed regardless of direction, for staff to re-verify. A
 * demolished building is carried and then edited to `is_active: false` —
 * there is no exclusion step for that, because inventing one here would be a
 * second way to express a state the registry already has.
 */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'

import { useApiWithAuth } from '../../../hooks/useApiWithAuth'
import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { invalidateLodgingRegistryQueries, queryKeys } from '../../../utils/queryKeys'
import { QueryGuard } from '../../QueryGuard'
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './lodgingStyles'

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

const BASE = '/api/custom/lodging/roll-forward'

/** Ties the Details disclosure to the list it expands, for assistive tech. */
const UNIT_CODES_ID = 'roll-forward-unit-codes'

/**
 * What both the preview and apply endpoints return — a dry run and a real one
 * render identically.
 *
 * `unit_codes` / `skipped_codes` are typed nullable because the Go side only
 * ever grows them with `append` (pocketbase/lodging/rollforward.go); a source
 * year that copies and skips nothing never runs either append, and an
 * uninitialized `[]string` field marshals as `null`, not `[]` (#2182). The Go
 * fix initializes both to `[]string{}`, but this type stays nullable and the
 * two call sites below keep their `?? []` guard as insurance against the same
 * class from any other nil slice on this endpoint — not the fix itself.
 */
export interface RollForwardPlan {
  from_year: number
  to_year: number
  areas_to_create: number
  units_to_create: number
  areas_present: number
  units_present: number
  unit_codes: string[] | null
  skipped_codes: string[] | null
}

/** This is a PocketBase custom route, not FastAPI — errors carry `error`, not `detail`. */
async function toError(response: Response, fallback: string): Promise<Error> {
  let message: unknown
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      message = (body as { error?: unknown }).error
    }
  } catch {
    message = undefined
  }
  if (typeof message === 'string' && message.length > 0) return new Error(message)
  return new Error(`${fallback} (HTTP ${String(response.status)})`)
}

async function fetchRollForwardPreview(
  fetchWithAuth: FetchWithAuth,
  from: number,
  to: number
): Promise<RollForwardPlan> {
  const response = await fetchWithAuth(`${BASE}/preview?from=${String(from)}&to=${String(to)}`)
  if (!response.ok) throw await toError(response, 'Failed to preview the roll-forward')
  return response.json() as Promise<RollForwardPlan>
}

async function applyRollForward(
  fetchWithAuth: FetchWithAuth,
  from: number,
  to: number
): Promise<RollForwardPlan> {
  const response = await fetchWithAuth(`${BASE}?from=${String(from)}&to=${String(to)}`, {
    method: 'POST',
  })
  if (!response.ok) throw await toError(response, 'Failed to carry the registry forward')
  return response.json() as Promise<RollForwardPlan>
}

export function SeasonRollForwardPanel() {
  const { currentYear } = useCurrentYear()
  const fromYear = currentYear - 1
  const toYear = currentYear
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  // Gates the fetch AND the render below. Gating only the fetch left the prose
  // interpolating the unresolved years straight onto the screen — "Copy -1's
  // areas and units forward as a starting point for 0."
  const yearReady = toYear > 0

  const previewQuery = useQuery({
    queryKey: queryKeys.lodgingRollForwardPreview(fromYear, toYear),
    queryFn: () => fetchRollForwardPreview(fetchWithAuth, fromYear, toYear),
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year. PocketBase-backed routes like this one do not 422 on a
    // bad year the way the FastAPI routers do, so without this gate a cold
    // load would fire `from=-1&to=0` and render a confident "nothing to carry
    // forward". Convention: useWeekendRoster.ts:30-37.
    //
    // isAuthLoading is the second half: this is the only lodging panel that
    // reaches the network through fetchWithAuth rather than the PocketBase SDK,
    // so it is the only one for which frontend/CLAUDE.md's "check
    // useAuth().isLoading before authenticated calls" has anything to say.
    enabled: yearReady && !isAuthLoading,
  })

  const applyMutation = useMutation({
    mutationFn: () => applyRollForward(fetchWithAuth, fromYear, toYear),
    onSuccess: (plan) => {
      // Registry-key-only invalidation leaves the weekend roster stale for the
      // length of its staleTime — this reaches weekend-roster/-summary/
      // -sessions too, not just lodging-units/-areas. It also carries this
      // panel's own preview key, so there is nothing extra to remember here.
      invalidateLodgingRegistryQueries(queryClient)
      toast.success(
        `Carried forward ${String(plan.units_to_create)} units and ${String(plan.areas_to_create)} areas from ${String(fromYear)}`
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to carry the registry forward')
    },
  })

  const preview = previewQuery.data
  const toCreate = (preview?.units_to_create ?? 0) + (preview?.areas_to_create ?? 0)
  const alreadyPresent = (preview?.units_present ?? 0) + (preview?.areas_present ?? 0)
  const nothingToCarry = preview !== undefined && toCreate === 0

  // Before the season resolves there is no honest sentence to write: every
  // line below names fromYear and toYear.
  if (!yearReady) {
    return <p className="text-muted-foreground text-sm">Loading the season…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm">
        Copy {fromYear}&apos;s areas and units forward as a starting point for {toYear}. Values and
        codes carry forward, but confirmation does not — every unit lands unconfirmed so staff
        re-verify it for {toYear}. A demolished building carries too, and gets marked inactive by
        hand afterward.
      </p>

      {/* The same QueryGuard the other three lodging panels use, rather than a
          fourth hand-rolled loading/error/empty triple (CLAUDE.md, "Family Camp
          Models Summer").

          `isAuthLoading` is folded into isLoading rather than left to `enabled`
          alone: a DISABLED TanStack query reports `isLoading === false` with
          `data === undefined`, which is exactly the shape QueryGuard reads as
          "settled, nothing here". Gating only the fetch would therefore trade a
          spinner for a confident empty state — the identical trap the sibling
          panels fixed with `yearReady`, arriving here through auth instead. */}
      <QueryGuard
        isLoading={previewQuery.isLoading || isAuthLoading}
        error={previewQuery.error}
        data={preview}
        label="roll-forward preview"
        emptyMessage={`Could not read what would carry forward from ${String(fromYear)}.`}
      >
        {(plan) => (
          <div className="card-lodge flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                {plan.areas_to_create} areas and {plan.units_to_create} units will be created in{' '}
                {toYear}.
                {alreadyPresent > 0 && (
                  <span className="text-muted-foreground"> {alreadyPresent} already present.</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setExpanded((e) => !e)
                }}
                aria-expanded={expanded}
                aria-controls={UNIT_CODES_ID}
                className={BUTTON_SECONDARY}
              >
                Details
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {(plan.skipped_codes ?? []).length > 0 && (
              <p className="text-muted-foreground text-xs">
                Left as-is, already present in {toYear}: {(plan.skipped_codes ?? []).join(', ')}
              </p>
            )}

            {expanded && (plan.unit_codes ?? []).length > 0 && (
              <ul
                id={UNIT_CODES_ID}
                className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3"
              >
                {(plan.unit_codes ?? []).map((code) => (
                  <li key={code} className="font-mono">
                    {code}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => applyMutation.mutate()}
                disabled={nothingToCarry || applyMutation.isPending}
                // No aria-label: it would override the visible text, so the
                // pending state would render "Carrying forward…" while still
                // announcing "Carry N forward". The visible text already says
                // everything the label did.
                className={BUTTON_PRIMARY}
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Carrying forward…
                  </>
                ) : nothingToCarry ? (
                  'Nothing to carry forward'
                ) : (
                  <>
                    <Check className="h-4 w-4" /> Carry {toCreate} forward
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </QueryGuard>
    </div>
  )
}
