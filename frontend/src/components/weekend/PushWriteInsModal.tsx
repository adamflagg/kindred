/**
 * The write-in push queue's modal shell, report screen, decision deck, and
 * push/unpush execution (kindred#2477 Tasks 8/9/10). Entry is the board's
 * own "Push write-ins" toolbar button (`LodgingBoard.tsx`).
 *
 * ## The report vs. the deck vs. done
 *
 * Four stages tracked by `PushStage`, one component: `'report'` (this file,
 * the four class tiles), `'deck'` (this file wires `PushDecisionDeck.tsx` —
 * one card per building that needs a verdict), and `'done'` (what the push,
 * and then the unpush, actually did — Task 10). Kept in ONE component rather
 * than several, because the stages share the same preview fetch and the same
 * `decisions` record building up across them, and splitting that state
 * across sibling components would need to thread it back up through props
 * for no reader this modal has today.
 *
 * `decisions: Record<string, Decision>` is keyed on `PushBuildingReport.key`
 * and carries a verdict ONLY for a building the report classed `conflict` or
 * `remove` — an `add` or `match` building is shown here for audit and is
 * never queued (kindred#2477 design contract). This file declares the shape,
 * resets it on open, and filters `preview.buildings` down to the two classes
 * that need one before handing them to `PushDecisionDeck`, which is what
 * actually writes into it via `onDecide`.
 *
 * ## The digest, not a staleTime tier — but staleTime IS 0, deliberately
 *
 * `useQuery` sets `staleTime: 0` alongside `refetchOnMount: 'always'`. This
 * is a real divergence from the app's 30-minute default (CLAUDE.md §4's
 * "Family Camp Models Summer" caching row), and it earns it: this modal
 * STAYS MOUNTED across opens — `LodgingBoard` renders it unconditionally,
 * gated only by `isOpen` — so there is no fresh "mount" for
 * `refetchOnMount: 'always'` to catch on reopen, only an existing observer's
 * `enabled` flipping true again. Under the 30-minute default that reopen
 * would keep serving the FIRST open's cached report until the digest 409
 * bounced a stale push, which defeats the point of a "look right before you
 * act" screen. `staleTime: 0` is what makes every open actually re-ask.
 * `PushPreview.digest` remains the correctness backstop regardless —
 * `executeWriteInPush` echoes it back and the server refuses a push made
 * against a report the live board or the scenario has since moved past —
 * but the freshness of what staff SEE on open is this staleTime, not the
 * digest; the digest only catches what slips through.
 *
 * ## 409 stale is not an error
 *
 * `executeWriteInPush`'s 409 `{reason: 'stale', report}` means the board or
 * the scenario moved between the preview fetch and the push click — a normal
 * thing to hit, not a fault. The fresh report replaces the cached preview
 * (`queryClient.setQueryData`, keeping this component and `useQuery` as the
 * single source of the rendered report rather than a second copy in local
 * state), decisions are dropped since they were made against buildings that
 * may no longer exist in the same shape, and the modal returns to `'report'`
 * with a one-line explanation. No toast — a toast reads as "something broke".
 *
 * ## Unpush lives only on the success screen (v1, ruled)
 *
 * There is no Unpush entry point anywhere else in this modal or on the
 * board. `pushResult.push_id` is the only handle Unpush needs, and it only
 * exists once a push has actually run in this session.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import {
  executeWriteInPush,
  fetchPushPreview,
  LodgingApiError,
  unpushWriteIns,
  type PushBuildingReport,
  type PushPreview,
  type PushResult,
} from '../../services/lodgingApi'
import { invalidateLodgingRegistryQueries, queryKeys } from '../../utils/queryKeys'
import { QueryGuard } from '../QueryGuard'
import { Modal } from '../ui/Modal'
import { PushDecisionDeck } from './PushDecisionDeck'

/** Which screen the modal is showing. */
export type PushStage = 'report' | 'deck' | 'done'

/**
 * One verdict per building the report classed `conflict` or `remove` — the
 * only two classes a push cannot apply without staff choosing a side.
 * `'live'`/`'scenario'` resolve a CONFLICT (keep the live occupant or take
 * the scenario's); `'keep'`/`'remove'` resolve a building the scenario no
 * longer writes into at all.
 */
export type Decision = 'live' | 'scenario' | 'keep' | 'remove'

/**
 * Every `conflict`/`remove` building defaults to its ACTIONABLE side — owner
 * ruling 2026-08-24 (visual round 2, item 6): decisions arrive pre-populated
 * the instant the preview loads, never blank. `conflict` defaults to
 * `'scenario'` (take what this scenario proposes) and `remove` defaults to
 * `'remove'` (the scenario carries nothing here, so the push removes it) —
 * both are the change a push actually makes if staff never touch the deck at
 * all, which is what "actionable" means here. Staff review-and-override from
 * this pre-picked state rather than building it up from nothing.
 */
function defaultDecisionsFor(buildings: readonly PushBuildingReport[]): Record<string, Decision> {
  const decisions: Record<string, Decision> = {}
  for (const building of buildings) {
    if (building.cls === 'conflict') decisions[building.key] = 'scenario'
    else if (building.cls === 'remove') decisions[building.key] = 'remove'
  }
  return decisions
}

export interface PushWriteInsModalProps {
  year: number
  sessionCmId: number
  scenario: string
  isOpen: boolean
  onClose: () => void
}

const CLASS_ORDER: ReadonlyArray<PushBuildingReport['cls']> = ['add', 'match', 'conflict', 'remove']

/**
 * Label and accent per class, in the board's `rounded-2xl border-2` +
 * semantic-color vocabulary (`unitBadges.ts`'s amber conflict chip,
 * `CamperDetail.tsx`'s amber panel). `'remove'` reads "Not in scenario"
 * rather than "Will remove": the scenario never asked to remove anything —
 * it simply carries no draft row for a building the live board still holds
 * one for, and pushing is what would turn that absence into a removal.
 */
const TILE_META: Record<PushBuildingReport['cls'], { label: string; className: string }> = {
  add: {
    label: 'Will add',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  },
  match: {
    label: 'Already matches',
    className: 'border-border bg-muted/40 text-muted-foreground',
  },
  conflict: {
    label: 'Conflicts',
    className:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
  },
  remove: {
    label: 'Not in scenario',
    className:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200',
  },
}

/**
 * `add`/`remove` tiles name the occupant the push will create or delete,
 * not just the building — owner ruling 2026-08-24 (visual round 2, item 5):
 * staff approving an add or a removal need to see WHO, not just WHERE. A
 * building can carry more than one row (kindred#2477's Yurt 5 fixture: two
 * write-ins added to one building), so this is per-ROW, not per-building.
 * `match`/`conflict` tiles are audit-only here and keep the building-label
 * list — the deck is where a conflict's occupants get named.
 */
function tileSummaryLines(
  cls: PushBuildingReport['cls'],
  buildings: readonly PushBuildingReport[]
): string[] {
  if (cls === 'add') {
    return buildings.flatMap((b) => b.draft.map((row) => `${row.occupant_name} — ${b.label}`))
  }
  if (cls === 'remove') {
    return buildings.flatMap((b) => b.live.map((row) => `${row.occupant_name} — ${b.label}`))
  }
  return buildings.map((b) => b.label)
}

function ReportTile({
  cls,
  buildings,
}: {
  cls: PushBuildingReport['cls']
  buildings: readonly PushBuildingReport[]
}) {
  const meta = TILE_META[cls]
  return (
    <div className={`flex flex-col gap-1 rounded-2xl border-2 p-3 ${meta.className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold tracking-wider uppercase opacity-80">{meta.label}</span>
        <span className="text-xl font-bold tabular-nums">{buildings.length}</span>
      </div>
      {buildings.length > 0 && (
        <p className="truncate text-xs opacity-80">{tileSummaryLines(cls, buildings).join(', ')}</p>
      )}
    </div>
  )
}

function ReportScreen({
  preview,
  onReview,
  onPush,
  isPushing,
}: {
  preview: PushPreview
  onReview: () => void
  onPush: () => void
  isPushing: boolean
}) {
  if (preview.buildings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This scenario&rsquo;s write-ins already match CampMinder. Nothing to push.
      </p>
    )
  }

  const byClass: Record<PushBuildingReport['cls'], PushBuildingReport[]> = {
    add: [],
    match: [],
    conflict: [],
    remove: [],
  }
  for (const building of preview.buildings) byClass[building.cls].push(building)

  // What staff must decide before a push can apply — a conflicting occupant
  // or a building the scenario no longer covers. Add/match need no decision
  // and are never counted here, matching the "shown for audit, never queued"
  // rule above.
  const decisionCount = byClass.conflict.length + byClass.remove.length
  // What a push with NO decisions to make would actually write. `add`-class
  // draft rows only: `execute_push`'s `match` branch writes NOTHING — it
  // only increments `matched` in the result, never extends `adds` or
  // `removes` — and matches are the common case, not the exception, so
  // summing every building's draft rows overcounted almost every push.
  const pushCount = byClass.add.reduce((total, building) => total + building.draft.length, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CLASS_ORDER.map((cls) => (
          <ReportTile key={cls} cls={cls} buildings={byClass[cls]} />
        ))}
      </div>
      <div className="flex justify-end">
        {decisionCount > 0 ? (
          <button type="button" className="btn-primary" onClick={onReview}>
            {`Review ${String(decisionCount)} decision${decisionCount === 1 ? '' : 's'} →`}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPushing}
            onClick={onPush}
          >
            {isPushing
              ? 'Pushing…'
              : `Push ${String(pushCount)} write-in${pushCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  )
}

type ResultField = 'added' | 'removed' | 'replaced' | 'kept' | 'matched'

/** Reuses the report tiles' semantic colors — added~add, removed~remove,
 * replaced~conflict (a replace IS a resolved conflict), kept/matched share
 * the report's neutral "nothing to decide" look. */
const RESULT_TILE_META: Record<ResultField, { label: string; className: string }> = {
  added: { label: 'Added', className: TILE_META.add.className },
  removed: { label: 'Removed', className: TILE_META.remove.className },
  replaced: { label: 'Replaced', className: TILE_META.conflict.className },
  kept: { label: 'Kept', className: TILE_META.match.className },
  matched: { label: 'Matched', className: TILE_META.match.className },
}

const RESULT_FIELDS: ReadonlyArray<ResultField> = [
  'added',
  'removed',
  'replaced',
  'kept',
  'matched',
]

function ResultTile({ field, value }: { field: ResultField; value: number }) {
  const meta = RESULT_TILE_META[field]
  return (
    <div className={`flex flex-col gap-1 rounded-2xl border-2 p-3 ${meta.className}`}>
      <span className="text-xs font-bold tracking-wider uppercase opacity-80">{meta.label}</span>
      <span className="text-xl font-bold tabular-nums">{value}</span>
    </div>
  )
}

/** One label + names group under the result tiles — owner ruling 2026-08-24
 * (visual round 2, item 5): staff see WHO was added and WHO was removed,
 * not just the counts. One line per person, no group when there's nobody
 * to name. */
function NameList({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-bold tracking-wider uppercase opacity-80">
        {label}
      </span>
      {names.map((name, i) => (
        <p key={`${name}-${String(i)}`} className="text-sm">
          {name}
        </p>
      ))}
    </div>
  )
}

function PushSuccessScreen({
  result,
  addedNames,
  removedNames,
  onUnpush,
  isUnpushing,
  driftBuildings,
}: {
  result: PushResult
  addedNames: readonly string[]
  removedNames: readonly string[]
  onUnpush: () => void
  isUnpushing: boolean
  driftBuildings: readonly string[] | null
}) {
  if (result.no_op) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing to push — every write-in already matches.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {RESULT_FIELDS.map((field) => (
          <ResultTile key={field} field={field} value={result[field]} />
        ))}
      </div>
      {(addedNames.length > 0 || removedNames.length > 0) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
          {/* "Occupants added/removed", not the bare "Added"/"Removed" the
              tiles above already use — a duplicate label would make every
              `getByText('Added')` query in this screen ambiguous. */}
          <NameList label="Occupants added" names={addedNames} />
          <NameList label="Occupants removed" names={removedNames} />
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        One event: the push records its adds and removes together, so Unpush deletes what it added
        and restores what it removed.
      </p>
      {driftBuildings !== null && (
        <p className="text-sm text-red-700 dark:text-red-300">
          {`These changed since the push — resolve on the board: ${driftBuildings.join(', ')}`}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isUnpushing}
          onClick={onUnpush}
        >
          {isUnpushing ? 'Unpushing…' : 'Unpush'}
        </button>
      </div>
    </div>
  )
}

function UnpushSuccessScreen({
  result,
  onBackToReport,
}: {
  result: { restored: number; deleted: number }
  onBackToReport: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {`Unpushed — restored ${String(result.restored)}, deleted ${String(result.deleted)}.`}
      </p>
      <div className="flex justify-end">
        <button type="button" className="btn-secondary" onClick={onBackToReport}>
          Back to report
        </button>
      </div>
    </div>
  )
}

export function PushWriteInsModal({
  year,
  sessionCmId,
  scenario,
  isOpen,
  onClose,
}: PushWriteInsModalProps) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const previewKey = queryKeys.pushPreview(year, sessionCmId, scenario)

  const [stage, setStage] = useState<PushStage>('report')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [unpushResult, setUnpushResult] = useState<{ restored: number; deleted: number } | null>(
    null
  )
  const [driftBuildings, setDriftBuildings] = useState<readonly string[] | null>(null)
  // Set only by the 409-stale recovery path below; cleared on every open and
  // every push attempt, so it never survives to describe a LATER report.
  const [staleNotice, setStaleNotice] = useState(false)

  // Render-time reset, the same idiom `LodgingBoard`'s own `lastSessionCmId`
  // uses: the modal stays mounted across opens (`ui/Modal`'s exit fade needs
  // that), so without this a staff member who reached the deck reviewing one
  // scenario would reopen the modal on a DIFFERENT scenario still sitting in
  // stage 'deck' with the previous scenario's decisions attached.
  //
  // `decisions` re-derives from whatever preview is CURRENTLY cached for this
  // key (owner ruling 2026-08-24, visual round 2, item 6: reset-on-reopen
  // must re-derive the actionable defaults, never blank to `{}`) rather than
  // waiting for the fresh fetch below to land — the `useEffect` right after
  // this block re-derives again once that fetch actually resolves, which is
  // what corrects this if the cached preview turns out to be stale.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setStage('report')
      setDecisions(
        defaultDecisionsFor(queryClient.getQueryData<PushPreview>(previewKey)?.buildings ?? [])
      )
      setPushResult(null)
      setUnpushResult(null)
      setDriftBuildings(null)
      setStaleNotice(false)
    }
  }

  const query = useQuery<PushPreview>({
    queryKey: previewKey,
    queryFn: () => fetchPushPreview(fetchWithAuth, { year, sessionCmId, scenario }),
    enabled: isOpen,
    // staleTime 0 (opted DOWN from the app's 30-minute default) plus
    // refetchOnMount: 'always' — see the module doc's "digest, not a
    // staleTime tier — but staleTime IS 0" section for why the mount-based
    // option alone can't do this modal's job.
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // The other half of "re-derive from the fresh preview": whenever a NEW
  // preview object lands for this key — the first successful fetch, a
  // reopen's refetch resolving with different content, or the 409-stale
  // handler below swapping in a fresh report — repopulate `decisions` to the
  // actionable defaults for THAT preview. React Query's structural sharing
  // keeps `query.data` referentially stable when a refetch returns content
  // identical to what's already cached, so this does not re-fire (and does
  // not fight a staff override) on every render, only on an actual change.
  useEffect(() => {
    if (query.data === undefined) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing decisions with a fetched preview object we don't own the identity of; re-derives only when React Query hands us a genuinely different `query.data` reference (see comment above)
    setDecisions(defaultDecisionsFor(query.data.buildings))
  }, [query.data])

  const pushMutation = useMutation<
    PushResult,
    Error,
    { digest: string; decisions: Record<string, Decision> }
  >({
    mutationFn: (vars) =>
      executeWriteInPush(fetchWithAuth, {
        year,
        sessionCmId,
        scenario,
        digest: vars.digest,
        decisions: vars.decisions,
      }),
    onSuccess: (result) => {
      setPushResult(result)
      setUnpushResult(null)
      setDriftBuildings(null)
      setStage('done')
      invalidateLodgingRegistryQueries(queryClient)
    },
    onError: (error) => {
      // See the module doc's "409 stale is not an error" section.
      if (
        error instanceof LodgingApiError &&
        error.detail !== undefined &&
        error.detail.reason === 'stale'
      ) {
        queryClient.setQueryData(previewKey, error.detail.report)
        // Set directly from the fresh report rather than waiting on the
        // `useEffect` above to catch `query.data`'s change — same result,
        // no gap where the (about-to-be-replaced) report screen would need
        // to render blank decisions first.
        setDecisions(defaultDecisionsFor(error.detail.report.buildings))
        setStage('report')
        setStaleNotice(true)
        return
      }
      toast.error(error.message)
    },
  })

  const unpushMutation = useMutation<
    { push_id: string; restored: number; deleted: number },
    Error,
    string
  >({
    mutationFn: (pushId) => unpushWriteIns(fetchWithAuth, { pushId, year, sessionCmId }),
    onSuccess: (result) => {
      setUnpushResult({ restored: result.restored, deleted: result.deleted })
      setDriftBuildings(null)
      invalidateLodgingRegistryQueries(queryClient)
    },
    onError: (error) => {
      if (
        error instanceof LodgingApiError &&
        error.detail !== undefined &&
        error.detail.reason === 'drift'
      ) {
        setDriftBuildings(error.detail.buildings)
        return
      }
      toast.error(error.message)
    },
  })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Push write-ins"
      // Dropped one step (owner ruling 2026-08-24, visual round 2, item 1):
      // "2xl" (max-w-6xl) read too wide for a screen whose content is four
      // small tiles or a single deck card. "xl" (max-w-4xl) still fits the
      // report tiles (they wrap 2x2 at this width, which is fine) and the
      // deck card comfortably.
      size="xl"
      // spec §7: the three stages (report, deck, done) change content
      // height — exactly the defect `anchor="top"` exists for (`ui/Modal`'s
      // own doc). Centred, a height change re-centres the whole card and
      // everything above the changed region moves with it.
      anchor="top"
    >
      <QueryGuard<PushPreview>
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        label="push preview"
        emptyMessage="This scenario's write-ins already match CampMinder. Nothing to push."
      >
        {(preview) => {
          const handlePush = () => {
            setStaleNotice(false)
            pushMutation.mutate({ digest: preview.digest, decisions })
          }

          if (stage === 'report') {
            return (
              <div className="flex flex-col gap-3">
                {staleNotice && (
                  <p className="rounded-xl border-2 border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    The board changed while you were reviewing — here&rsquo;s the fresh comparison.
                  </p>
                )}
                <ReportScreen
                  preview={preview}
                  onReview={() => {
                    setStage('deck')
                  }}
                  onPush={handlePush}
                  isPushing={pushMutation.isPending}
                />
              </div>
            )
          }
          if (stage === 'deck') {
            // Only conflict/remove buildings ever need a verdict — add/match
            // are shown on the report screen for audit and are never queued
            // (module doc's "the digest, not a staleTime" section covers the
            // rest of the report/deck split).
            const deckBuildings = preview.buildings.filter(
              (b) => b.cls === 'conflict' || b.cls === 'remove'
            )
            const decidedCount = deckBuildings.filter((b) => decisions[b.key] !== undefined).length
            return (
              <PushDecisionDeck
                buildings={deckBuildings}
                decisions={decisions}
                onDecide={(key, decision) => {
                  setDecisions((prev) => ({ ...prev, [key]: decision }))
                }}
                onPush={handlePush}
                pushDisabled={deckBuildings.length > decidedCount || pushMutation.isPending}
              />
            )
          }

          // stage === 'done'
          if (unpushResult !== null) {
            return (
              <UnpushSuccessScreen
                result={unpushResult}
                onBackToReport={() => {
                  setPushResult(null)
                  setUnpushResult(null)
                  setDriftBuildings(null)
                  setStage('report')
                  void query.refetch()
                }}
              />
            )
          }
          if (pushResult === null) return null
          // Named from the SAME `preview`/`decisions` the push was made
          // with — `invalidateLodgingRegistryQueries` never touches the
          // push-preview key, so `preview` is still the exact report that
          // was pushed (owner ruling 2026-08-24, visual round 2, item 5).
          // `add` buildings always write their draft rows unconditionally;
          // `remove` buildings only write a removal when staff decided
          // 'remove' (their actionable default, but staff may have flipped
          // it to 'keep'). `conflict`-class replacements are deliberately
          // NOT named here — the ruling scopes naming to unconditional
          // creates/deletes, not to a resolved conflict.
          const addedNames = preview.buildings
            .filter((b) => b.cls === 'add')
            .flatMap((b) => b.draft.map((row) => row.occupant_name))
          const removedNames = preview.buildings
            .filter((b) => b.cls === 'remove' && decisions[b.key] === 'remove')
            .flatMap((b) => b.live.map((row) => row.occupant_name))
          return (
            <PushSuccessScreen
              result={pushResult}
              addedNames={addedNames}
              removedNames={removedNames}
              driftBuildings={driftBuildings}
              isUnpushing={unpushMutation.isPending}
              onUnpush={() => {
                if (pushResult.push_id === '') return
                unpushMutation.mutate(pushResult.push_id)
              }}
            />
          )
        }}
      </QueryGuard>
    </Modal>
  )
}

export default PushWriteInsModal
