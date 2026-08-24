/**
 * The write-in push queue's decision deck (kindred#2477 Task 9) — one card
 * at a time for every building `PushWriteInsModal`'s report classed
 * `conflict` or `remove`. The caller (`PushWriteInsModal`, stage `'deck'`)
 * pre-filters `buildings` to those two classes; this component never reads
 * `'add'`/`'match'` buildings and has nothing to say about them.
 *
 * ## Three card shapes, chosen by row count and class
 *
 * `cls === 'remove'` always renders the remove card — a `remove` building
 * carries no draft rows (`classify_push`'s definition: the scenario writes
 * nothing here at all), so its total row count is just its live rows, and
 * in practice that is one. `cls === 'conflict'` splits on total row count:
 * exactly one live row and one draft row is the PAIRWISE card (a per-field
 * diff); more than two total rows is the WHOLE-BUILDING SET card (a
 * composed after-list) — a scenario that rewrote a multi-room building
 * wholesale, or split one draft row across several live ones.
 *
 * ## Decision vocabulary
 *
 * Every card offers exactly two choices, and both are keyed 1 (left) / 2
 * (right) the same way regardless of shape: a conflict card's left/right are
 * `'live'`/`'scenario'`; a remove card's are `'keep'`/`'remove'`
 * (`PushWriteInsModal`'s `Decision` union). `sideDecision` is the single
 * place that mapping lives, so the pairwise card, the whole-building card,
 * and the keyboard handler can't drift from each other.
 *
 * ## The composed after-view defaults to previewing `scenario`
 *
 * A whole-building card falls back to showing what "use this scenario's"
 * would do — live rows `gone` (struck), draft rows `new` — whenever
 * `decision` isn't `'live'`. In the real product this branch is never
 * actually reached undecided any more: the caller (`PushWriteInsModal`)
 * pre-populates every `conflict`/`remove` building to its actionable side
 * before the deck ever renders (owner ruling 2026-08-24, visual round 2,
 * item 6) — the "staff hasn't decided yet, so preview the likely outcome"
 * UX this section used to describe no longer exists. The ternary stays as
 * the simplest correct fallback rather than being narrowed to a case that
 * can't happen through the app; nothing here needed to change to keep
 * behaving the same way.
 *
 * ## Advance animation
 *
 * WAAPI (`element.animate`), not GSAP — this deck has no shared elements to
 * FLIP across cards, just one card sliding out and the next sliding in.
 * jsdom implements no `Element.prototype.animate`, so every call is guarded
 * behind `typeof el.animate === 'function'`; the guard is the only reason
 * this component's tests run at all.
 */
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { PushBuildingReport, PushRowPayload } from '../../services/lodgingApi'
import type { Decision } from './PushWriteInsModal'

export interface PushDecisionDeckProps {
  /** Pre-filtered by the caller to `cls === 'conflict' || cls === 'remove'`. */
  buildings: readonly PushBuildingReport[]
  decisions: Record<string, Decision>
  onDecide: (key: string, decision: Decision) => void
  onPush: () => void
  /** D33: block until every building in `buildings` has a decision. */
  pushDisabled: boolean
}

/** Which building this card is FOR, resolved from `cls` and row count. */
type CardShape = 'pairwise' | 'whole-building' | 'remove'

function cardShapeOf(building: PushBuildingReport): CardShape {
  if (building.cls === 'remove') return 'remove'
  return building.live.length + building.draft.length > 2 ? 'whole-building' : 'pairwise'
}

/** The decision the left (`'1'`) / right (`'2'`) choice writes for `building`. */
function sideDecision(building: PushBuildingReport, side: 'left' | 'right'): Decision {
  if (building.cls === 'remove') return side === 'left' ? 'keep' : 'remove'
  return side === 'left' ? 'live' : 'scenario'
}

const partySizeText = (partySize: number | null): string =>
  partySize === null ? '—' : String(partySize)

/**
 * One SIDE's bed line — `takes the whole space — all N beds` when any of
 * `rows` occupies the whole space with no headcount recorded
 * (`party_size === null`), else `<summed party_size> of N beds`. `N` sums
 * `sleeps` across `rows` deduped by `unit_id` (a side's
 * rows never repeat a unit in practice — cheap insurance rather than a
 * live case).
 *
 * SIDE-SCOPED ON PURPOSE — never called across live+draft together. A
 * whole-building card's draft can carry a whole-house CONTAINER row
 * alongside live's per-room rows; those are the same physical beds counted
 * at two different grains; not two different pools. Summing across both
 * sides double-counts them: kindred#2477 review caught this as `bedLine`
 * unioning `[...live, ...draft]` before dedupe, which for a 2-room live
 * side (4 + 3) plus a whole-house draft row (9) rendered "all 16 beds" — a
 * number matching no real state. Ruled fix: compute each side on its own
 * `bedSideLine(building.live)` / `bedSideLine(building.draft)` and show
 * both, never combine them into one dedupe pass.
 */
function bedSideLine(rows: readonly PushRowPayload[]): string {
  const sleepsByUnit = new Map<string, number>()
  for (const row of rows) {
    if (!sleepsByUnit.has(row.unit_id)) sleepsByUnit.set(row.unit_id, row.sleeps ?? 0)
  }
  const totalBeds = Array.from(sleepsByUnit.values()).reduce((sum, n) => sum + n, 0)
  const takesWholeSpace = rows.some((row) => row.party_size === null)
  if (takesWholeSpace) return `takes the whole space — all ${String(totalBeds)} beds`
  const totalPeople = rows.reduce((sum, row) => sum + (row.party_size ?? 0), 0)
  return `${String(totalPeople)} of ${String(totalBeds)} beds`
}

/**
 * The card's full bed summary. A conflict card (pairwise or whole-building)
 * shows both sides, since both are options staff can pick between; a remove
 * card has no scenario side to show — there is nothing in the scenario for
 * this building at all — so it shows the CampMinder side alone.
 *
 * "On CampMinder now" / "This scenario" (never "live") — owner ruling
 * 2026-08-24, visual round 2, item 2: staff think of the live board as
 * "CampMinder".
 */
function bedSummary(building: PushBuildingReport): string {
  const liveLine = bedSideLine(building.live)
  if (building.cls === 'remove') return liveLine
  return `On CampMinder now: ${liveLine} → This scenario: ${bedSideLine(building.draft)}`
}

function pickColumnClass(picked: boolean): string {
  return `flex flex-1 flex-col gap-2 rounded-xl border-2 p-3 text-left transition-colors ${
    picked
      ? 'border-primary ring-primary/30 bg-primary/5 ring-2'
      : 'border-border hover:border-primary/40 bg-card'
  }`
}

function FieldRow({
  label,
  value,
  differs,
  title,
}: {
  label: string
  value: string
  differs: boolean
  /** Set only on the People row's em dash — "no headcount recorded", not a
   * missing value (kindred#2540). Cheap accessibility-adjacent hint, not a
   * behavior change. */
  title?: string | undefined
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-sm ${
        differs ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' : ''
      }`}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate font-medium" title={title}>
        {value || '—'}
      </span>
    </div>
  )
}

function ColumnHeader({ label, picked }: { label: string; picked: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-bold tracking-wider uppercase opacity-80">{label}</span>
      {picked && <Check className="text-primary h-4 w-4" />}
    </div>
  )
}

const NO_HEADCOUNT_TITLE = 'No headcount recorded'

function PairwiseConflictCard({
  building,
  decision,
  onPick,
}: {
  building: PushBuildingReport
  decision: Decision | undefined
  onPick: (decision: Decision) => void
}) {
  const live = building.live[0]
  const draft = building.draft[0]
  if (live === undefined || draft === undefined) return null

  const fields = [
    {
      label: 'Occupant',
      liveValue: live.occupant_name,
      scenarioValue: draft.occupant_name,
      differs: live.occupant_name !== draft.occupant_name,
    },
    {
      label: 'Note',
      liveValue: live.note,
      scenarioValue: draft.note,
      differs: live.note !== draft.note,
    },
    {
      label: 'People',
      liveValue: partySizeText(live.party_size),
      scenarioValue: partySizeText(draft.party_size),
      differs: live.party_size !== draft.party_size,
      liveTitle: live.party_size === null ? NO_HEADCOUNT_TITLE : undefined,
      scenarioTitle: draft.party_size === null ? NO_HEADCOUNT_TITLE : undefined,
    },
  ]

  // Column headers + button names speak staff language, never "live" (owner
  // ruling 2026-08-24, visual round 2, item 2). Both aria-label and the
  // visible ColumnHeader carry the same text — the aria-label exists only so
  // a test can query the whole column by name without matching every
  // FieldRow's text too (frontend/CLAUDE.md's "test infrastructure" a11y
  // policy).
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Same space, two different write-ins. Choose which one CampMinder should have.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          aria-label="On CampMinder now"
          onClick={() => {
            onPick('live')
          }}
          className={pickColumnClass(decision === 'live')}
        >
          <ColumnHeader label="On CampMinder now" picked={decision === 'live'} />
          {fields.map((field) => (
            <FieldRow
              key={field.label}
              label={field.label}
              value={field.liveValue}
              differs={field.differs}
              title={field.liveTitle}
            />
          ))}
        </button>
        <button
          type="button"
          aria-label="This scenario"
          onClick={() => {
            onPick('scenario')
          }}
          className={pickColumnClass(decision === 'scenario')}
        >
          <ColumnHeader label="This scenario" picked={decision === 'scenario'} />
          {fields.map((field) => (
            <FieldRow
              key={field.label}
              label={field.label}
              value={field.scenarioValue}
              differs={field.differs}
              title={field.scenarioTitle}
            />
          ))}
        </button>
      </div>
    </div>
  )
}

const AFTER_STATE_CLASS: Record<'stay' | 'gone' | 'new', string> = {
  stay: 'border-border bg-card',
  gone: 'border-border/60 bg-muted/40 text-muted-foreground line-through decoration-1',
  new: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
}

/**
 * A composed after-view row — occupant, unit, note (when present), and
 * People, exactly the fields the pairwise card shows (owner ruling
 * 2026-08-24, visual round 2, item 4). Previously this row showed only
 * occupant + unit name, which hid what a whole-building "use this
 * scenario's" decision was actually about to write.
 */
function AfterRow({ row, state }: { row: PushRowPayload; state: 'stay' | 'gone' | 'new' }) {
  return (
    <div
      data-after-state={state}
      className={`flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-sm ${AFTER_STATE_CLASS[state]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{row.occupant_name}</span>
        <span className="text-xs opacity-80">{row.unit_name}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs opacity-80">
        <span className="truncate">{row.note !== '' ? row.note : null}</span>
        <span title={row.party_size === null ? NO_HEADCOUNT_TITLE : undefined}>
          {partySizeText(row.party_size)} people
        </span>
      </div>
    </div>
  )
}

function WholeBuildingCard({
  building,
  decision,
  onPick,
}: {
  building: PushBuildingReport
  decision: Decision | undefined
  onPick: (decision: Decision) => void
}) {
  // Previewing "scenario" when nobody has decided yet — see module doc.
  const effective = decision === 'live' ? 'live' : 'scenario'
  const rows: Array<{ key: string; row: PushRowPayload; state: 'stay' | 'gone' | 'new' }> =
    effective === 'scenario'
      ? [
          ...building.live.map((row, i) => ({
            key: `live-${String(i)}`,
            row,
            state: 'gone' as const,
          })),
          ...building.draft.map((row, i) => ({
            key: `draft-${String(i)}`,
            row,
            state: 'new' as const,
          })),
        ]
      : building.live.map((row, i) => ({ key: `live-${String(i)}`, row, state: 'stay' as const }))

  // Button copy states what CampMinder ends up with (owner ruling
  // 2026-08-24, visual round 2, item 2) — no separate aria-label needed
  // here, unlike the pairwise card: each button's only content IS its
  // ColumnHeader label, so the accessible name already reads clean.
  const keepCount = building.live.length
  const keepLabel = `Keep what CampMinder has (${String(keepCount)} write-in${keepCount === 1 ? '' : 's'})`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            onPick('live')
          }}
          className={pickColumnClass(decision === 'live')}
        >
          <ColumnHeader label={keepLabel} picked={decision === 'live'} />
        </button>
        <button
          type="button"
          onClick={() => {
            onPick('scenario')
          }}
          className={pickColumnClass(decision === 'scenario')}
        >
          <ColumnHeader
            label="Use this scenario's (replaces them)"
            picked={decision === 'scenario'}
          />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(({ key, row, state }) => (
          <AfterRow key={key} row={row} state={state} />
        ))}
      </div>
    </div>
  )
}

function RemoveCard({
  building,
  decision,
  onPick,
}: {
  building: PushBuildingReport
  decision: Decision | undefined
  onPick: (decision: Decision) => void
}) {
  // ALL of `building.live`, not just the first row: `execute_push` removes
  // every live row for a `remove` building (a multi-room building the
  // scenario dropped entirely), and the approval card must show staff
  // everything that decision takes with it.
  if (building.live.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        This scenario doesn&rsquo;t place anyone here.
      </p>
      {building.live.map((live, i) => (
        <div key={`live-${String(i)}`} className="border-border bg-muted/30 rounded-xl border p-3">
          <p className="font-semibold">{live.occupant_name}</p>
          {live.note !== '' && <p className="text-muted-foreground text-sm">{live.note}</p>}
          <p className="text-muted-foreground text-sm">
            <span title={live.party_size === null ? NO_HEADCOUNT_TITLE : undefined}>
              {partySizeText(live.party_size)}
            </span>{' '}
            people
          </p>
        </div>
      ))}
      <p className="text-muted-foreground text-xs">Pushing can be undone in one step afterwards.</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            onPick('keep')
          }}
          className={pickColumnClass(decision === 'keep')}
        >
          <ColumnHeader label="Leave on CampMinder" picked={decision === 'keep'} />
        </button>
        <button
          type="button"
          onClick={() => {
            onPick('remove')
          }}
          className={pickColumnClass(decision === 'remove')}
        >
          <ColumnHeader label="Remove from CampMinder" picked={decision === 'remove'} />
        </button>
      </div>
    </div>
  )
}

const DOT_CLASS: Record<PushBuildingReport['cls'], string> = {
  add: 'bg-emerald-500',
  match: 'bg-muted-foreground/40',
  conflict: 'bg-amber-500',
  remove: 'bg-red-500',
}

const ANIMATE_DURATION_MS = 260
const AUTO_ADVANCE_DELAY_MS = 150

export function PushDecisionDeck({
  buildings,
  decisions,
  onDecide,
  onPush,
  pushDisabled,
}: PushDecisionDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const safeIndex = buildings.length === 0 ? 0 : Math.min(currentIndex, buildings.length - 1)
  const building = buildings[safeIndex]

  // Kept live for the auto-advance timeout, which reads them after React may
  // have re-rendered with a fresh `decisions` (from `onDecide` completing) —
  // or may not have, if the caller's state update hasn't landed by 150ms.
  // Synced in an effect, not during render: refs are for event
  // handlers/effects, and writing `.current` mid-render is what
  // `react-hooks/refs` flags.
  const decisionsRef = useRef(decisions)
  const buildingsRef = useRef(buildings)
  useEffect(() => {
    decisionsRef.current = decisions
    buildingsRef.current = buildings
  }, [decisions, buildings])

  const cardRef = useRef<HTMLDivElement>(null)
  const prevIndexRef = useRef(safeIndex)
  useEffect(() => {
    const el = cardRef.current
    const direction = safeIndex >= prevIndexRef.current ? 1 : -1
    const moved = safeIndex !== prevIndexRef.current
    prevIndexRef.current = safeIndex
    if (moved && el !== null && typeof el.animate === 'function') {
      el.animate(
        [
          { opacity: 0, transform: `translateX(${String(direction * 44)}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: ANIMATE_DURATION_MS, easing: 'cubic-bezier(0.16,1,0.3,1)' }
      )
    }
  }, [safeIndex])

  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current)
    },
    []
  )

  const goTo = (index: number) => {
    setCurrentIndex(Math.max(0, Math.min(buildingsRef.current.length - 1, index)))
  }

  // The single path every decision goes through — a card's own pick button
  // AND the keyboard's `1`/`2` both call this, so auto-advance never depends
  // on which input made the choice.
  const applyDecision = (decision: Decision) => {
    if (building === undefined) return
    onDecide(building.key, decision)
    const decidedKey = building.key
    if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null
      setCurrentIndex((i) => {
        const list = buildingsRef.current
        const isUndecided = (idx: number): boolean => {
          const candidate = list[idx]
          if (candidate === undefined) return false
          if (candidate.key === decidedKey) return false
          return decisionsRef.current[candidate.key] === undefined
        }
        for (let next = i + 1; next < list.length; next++) {
          if (isUndecided(next)) return next
        }
        for (let next = 0; next < i; next++) {
          if (isUndecided(next)) return next
        }
        return i
      })
    }, AUTO_ADVANCE_DELAY_MS)
  }

  const decide = (side: 'left' | 'right') => {
    if (building === undefined) return
    applyDecision(sideDecision(building, side))
  }

  // Document-level arrow-key navigation is scan-flagged against
  // frontend/CLAUDE.md's "DO NOT add ... arrow-key navigation" list, but this
  // one stays: it is the owner's explicit ruled product ask for this queue
  // screen (2026-08-22 — "staff could click next/previous or arrow right/left
  // ... to wheel through"), not unrequested accessibility scaffolding, which
  // is what that list targets. Escape is deliberately left untouched above.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goTo(safeIndex - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        goTo(safeIndex + 1)
        return
      }
      if (e.key === '1') {
        decide('left')
        return
      }
      if (e.key === '2') {
        decide('right')
      }
      // Every other key (Escape included) is left alone — the modal's own
      // document-level listener (`ui/Modal.tsx`) handles Escape, and this
      // handler must never call stopPropagation and swallow it first.
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `decide`/`goTo` close over `building`/`safeIndex`, both deps below
  }, [safeIndex, building])

  if (building === undefined) return null

  const decidedCount = buildings.filter((b) => decisions[b.key] !== undefined).length
  const shape = cardShapeOf(building)
  const decision = decisions[building.key]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-2">
        {buildings.map((b, i) => {
          const isDecided = decisions[b.key] !== undefined
          return (
            <button
              key={b.key}
              type="button"
              data-testid={`push-deck-dot-${b.key}`}
              aria-label={`Go to ${b.label}`}
              onClick={() => {
                goTo(i)
              }}
              className={`h-2.5 w-2.5 rounded-full transition-all ${
                isDecided ? DOT_CLASS[b.cls] : 'bg-muted border-border border'
              } ${i === safeIndex ? 'ring-primary ring-2 ring-offset-2' : ''}`}
            />
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous card"
          disabled={safeIndex === 0}
          onClick={() => {
            goTo(safeIndex - 1)
          }}
          className="hover:bg-muted rounded-lg p-1.5 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-lg font-bold">{building.label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {`${String(safeIndex + 1)} / ${String(buildings.length)}`}
          </span>
        </div>
        <button
          type="button"
          aria-label="Next card"
          disabled={safeIndex === buildings.length - 1}
          onClick={() => {
            goTo(safeIndex + 1)
          }}
          className="hover:bg-muted rounded-lg p-1.5 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <p className="text-muted-foreground -mt-2 text-center text-xs">{bedSummary(building)}</p>

      <div ref={cardRef} key={building.key}>
        {shape === 'pairwise' && (
          <PairwiseConflictCard building={building} decision={decision} onPick={applyDecision} />
        )}
        {shape === 'whole-building' && (
          <WholeBuildingCard building={building} decision={decision} onPick={applyDecision} />
        )}
        {shape === 'remove' && (
          <RemoveCard building={building} decision={decision} onPick={applyDecision} />
        )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-3">
        <p className="text-muted-foreground text-sm">
          {`${String(decidedCount)} / ${String(buildings.length)} decided`}
        </p>
        <button type="button" className="btn-primary" disabled={pushDisabled} onClick={onPush}>
          Push
        </button>
      </div>
    </div>
  )
}

export default PushDecisionDeck
