/**
 * The write-in push queue's modal shell and report screen (kindred#2477 Task
 * 8). Entry is the board's own "Push write-ins" toolbar button
 * (`LodgingBoard.tsx`).
 *
 * ## The report vs. the deck vs. done
 *
 * Three stages, one component: `'report'` (this file, the four class
 * tiles), `'deck'` (Task 9 — one card per building that needs a verdict),
 * and `'done'` (Task 10 — what the push actually did). Kept in ONE component
 * rather than three, because the stages share the same preview fetch and the
 * same `decisions` record building up across them, and splitting that state
 * across sibling components would need to thread it back up through props
 * for no reader this modal has today.
 *
 * `decisions: Record<string, Decision>` is keyed on `PushBuildingReport.key`
 * and carries a verdict ONLY for a building the report classed `conflict` or
 * `remove` — an `add` or `match` building is shown here for audit and is
 * never queued (kindred#2477 design contract). Task 8 declares the shape and
 * resets it on open; Task 9's deck is what actually writes into it.
 *
 * ## The digest, not a staleTime
 *
 * `useQuery` carries no staleness tuning beyond `refetchOnMount: 'always'`.
 * `PushPreview.digest` is what makes freshness explicit — `executeWriteInPush`
 * (Task 10) echoes it back and the server refuses a push made against a
 * report the live board or the scenario has since moved past, so there is no
 * correctness reason to guard this read with a short `staleTime` the way
 * `userDataOptions` would. Every OPEN re-asks instead: reviewing a push is a
 * "look right before you act" screen, not a background list.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import {
  fetchPushPreview,
  type PushBuildingReport,
  type PushPreview,
} from '../../services/lodgingApi'
import { queryKeys } from '../../utils/queryKeys'
import { QueryGuard } from '../QueryGuard'
import { Modal } from '../ui/Modal'

/** Which screen the modal is showing. Task 9 builds `'deck'`, Task 10 `'done'`. */
export type PushStage = 'report' | 'deck' | 'done'

/**
 * One verdict per building the report classed `conflict` or `remove` — the
 * only two classes a push cannot apply without staff choosing a side.
 * `'live'`/`'scenario'` resolve a CONFLICT (keep the live occupant or take
 * the scenario's); `'keep'`/`'remove'` resolve a building the scenario no
 * longer writes into at all.
 */
export type Decision = 'live' | 'scenario' | 'keep' | 'remove'

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
        <p className="truncate text-xs opacity-80">{buildings.map((b) => b.label).join(', ')}</p>
      )}
    </div>
  )
}

function ReportScreen({
  preview,
  onReview,
  onPush,
}: {
  preview: PushPreview
  onReview: () => void
  onPush: () => void
}) {
  if (preview.buildings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        This scenario&rsquo;s write-ins already match the live board. Nothing to push.
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
  // What a push with NO decisions to make would actually write — every
  // building's draft rows, add and match alike (a match still gets written,
  // it simply reports as `matched` rather than `added` in `PushResult`).
  const pushCount = preview.buildings.reduce((total, building) => total + building.draft.length, 0)

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
          <button type="button" className="btn-primary" onClick={onPush}>
            {`Push ${String(pushCount)} write-in${pushCount === 1 ? '' : 's'}`}
          </button>
        )}
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

  const [stage, setStage] = useState<PushStage>('report')
  // Task 9's deck is the only writer; Task 8 only declares the shape and
  // resets it below.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})

  // Render-time reset, the same idiom `LodgingBoard`'s own `lastSessionCmId`
  // uses: the modal stays mounted across opens (`ui/Modal`'s exit fade needs
  // that), so without this a staff member who reached the deck reviewing one
  // scenario would reopen the modal on a DIFFERENT scenario still sitting in
  // stage 'deck' with the previous scenario's decisions attached.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setStage('report')
      setDecisions({})
    }
  }

  const query = useQuery<PushPreview>({
    queryKey: queryKeys.pushPreview(year, sessionCmId, scenario),
    queryFn: () => fetchPushPreview(fetchWithAuth, { year, sessionCmId, scenario }),
    enabled: isOpen,
    // No staleTime tuning beyond this — see the module doc's "digest, not a
    // staleTime" section.
    refetchOnMount: 'always',
  })

  // Task 10 wires the real `executeWriteInPush` call here, keyed off
  // `preview.digest`. Task 8 ships the report screen and the button that
  // reaches it; nothing writes yet.
  const handlePush = () => {
    setStage('done')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Push write-ins" size="2xl">
      <QueryGuard<PushPreview>
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        label="push preview"
        emptyMessage="This scenario's write-ins already match the live board. Nothing to push."
      >
        {(preview) => {
          if (stage === 'report') {
            return (
              <ReportScreen
                preview={preview}
                onReview={() => {
                  setStage('deck')
                }}
                onPush={handlePush}
              />
            )
          }
          if (stage === 'deck') {
            // Task 9 replaces this with the conflict/remove decision deck,
            // reading and writing `decisions` above. Read here only enough
            // to keep the state live for Task 9 to build on.
            const decided = Object.keys(decisions).length
            return (
              <div data-testid="push-deck-placeholder" className="text-muted-foreground text-sm">
                {`Decision deck coming in Task 9. ${String(decided)} decision${decided === 1 ? '' : 's'} recorded so far.`}
              </div>
            )
          }
          // Task 10 replaces this with what the push actually did
          // (`PushResult`).
          return (
            <div data-testid="push-done-placeholder" className="text-muted-foreground text-sm">
              Push complete.
            </div>
          )
        }}
      </QueryGuard>
    </Modal>
  )
}

export default PushWriteInsModal
