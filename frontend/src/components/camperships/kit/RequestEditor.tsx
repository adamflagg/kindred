import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { AMBER_NOTE, FIELD, FIELD_INLINE } from '../../admin/lodging/lodgingStyles'
import { STATUS_TONE } from './kitStyles'
import { initialReason, parseMoneyInput, reasonMissing, type TextReasonPolicy } from './editor'
import { Money } from './MoneyText'
import { HouseholdChip, StatusPill } from './Pills'
import { ReceiptSentence } from './Receipt'
import type { AidTraceStep } from './receiptModel'

/**
 * One payer's share, as the preview response carries it (household, pct, amount). The chip is
 * page-relative, so the surface supplies it; a share with neither chip nor name shows as "Another
 * household", never a raw CampMinder id.
 */
export interface EditorShare {
  readonly householdCmId: number
  readonly chip?: number | null | undefined
  readonly householdName?: string | null | undefined
  readonly pct: number
  readonly amount: number
}

/** What the server worked out for the amount typed (§"What waits on slice 1's reads" item 4). */
export interface EditorPreview {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly award?: number | null | undefined
  readonly trace?: readonly AidTraceStep[] | undefined
  readonly stageChange?: string | null | undefined
  readonly shares?: readonly EditorShare[] | undefined
  readonly pendingApproval?: boolean | undefined
  /** The request's decided total after this edit, as the server sends it (clawed-back rounds included). */
  readonly totalDecided?: number | null | undefined
  readonly error?: string | undefined
}

export interface EditorSave {
  readonly amount: number
  readonly reason: string
}

/** What is typed, as text: the amount field and the note. */
export interface EditorTyped {
  readonly raw: string
  readonly reason: string
}

/** What `onDraftChange` reports while something is typed: the text, the save it would make, or why it can't. */
export interface EditorDraftReport extends EditorTyped {
  readonly save: EditorSave | null
  readonly problem: string | null
}

interface RequestEditorProps {
  readonly familyName: string
  readonly householdCmId: number
  readonly personCmId: number
  /** What is typed: "Round 2 ask" (staff type the family's ask; the award is computed, D22). */
  readonly amountLabel: string
  readonly initialAmount: number | null
  readonly policy: TextReasonPolicy
  /** Today on camp time, for the pre-filled note. */
  readonly today: string
  readonly preview: EditorPreview
  /** Every readable amount typed (null when unreadable); the surface debounces and fetches the preview. */
  readonly onAmountChange: (amount: number | null) => void
  readonly onSave: (save: EditorSave) => void
  /**
   * Grid only (Decision 6, RULED 2026-10-01): ↓ and ↑ save and move on (D22; ↑ since owner
   * ruling 2026-10-03, A18), or just move when nothing was typed (save = null) (D31).
   */
  readonly onMove?: ((direction: 1 | -1, save: EditorSave | null) => void) | undefined
  readonly onCancel: () => void
  /**
   * Surfaces must pass `saving` (true while the write is in flight): without it ↓ after Enter
   * does nothing until the person edits, and a finished save never moves the "nothing typed"
   * baseline.
   */
  readonly saving?: boolean | undefined
  /**
   * Surfaces must pass `saveError` for a failed save to be retryable. Set when `saving` goes
   * true→false and the write failed: the typed value and baseline are kept, the message shows,
   * and Enter or ↓ saves again. Leave it empty on success. An error that arrives a render after
   * `saving` falls is tolerated. The surface should clear it on the next save attempt
   * (`useMutation` does this on mutate): it stays on screen while set.
   */
  readonly saveError?: string | null | undefined
  /**
   * Owner ruling A (2026-10-01): what was typed when this row's save failed, put back when the
   * editor opens on it again. The baseline stays the opening figure and note, so it counts as typed:
   * Enter or ↓ saves it again.
   */
  readonly draft?: EditorTyped | undefined
  /**
   * Every change in what is typed: null while nothing is (the amount and note it opened with), else
   * the text, the save it would make (null while not valid) and why not. Owner ruling B saves from
   * it when another row is clicked (kit/useEditorWalk.ts). Read through a ref, so a new callback
   * each render doesn't report again.
   */
  readonly onDraftChange?: ((report: EditorDraftReport | null) => void) | undefined
  /**
   * Called once when the editor unmounts (a refetch took its row away, say), so the walk can drop
   * typing that could never be saved and would otherwise hold every exit. Read through a ref.
   */
  readonly onGone?: (() => void) | undefined
  /**
   * Show the editor's own problem now, as if Enter had been tried: the walk sets it when a click
   * elsewhere found nothing it could save yet (slice 1 Decision 5; plan review M9).
   */
  readonly showProblem?: boolean | undefined
  /**
   * 'row' under a highlighted table row; 'card' in place on the household page's request card (D22);
   * 'panel' the Requests grid's opened row, beside its detail text (owner fast-follow 10-03,
   * opened-row-options.html arrangement 3): the ask, Award / Stage, the note and `trailing` on one
   * line, the receipt, shares and key hint under it, and no caption (the detail line names the
   * household once).
   */
  readonly layout?: 'row' | 'card' | 'panel' | undefined
  /** 'panel' only: the row's next step, at the end of the first line. */
  readonly trailing?: ReactNode
}

function ShareFigure({ share }: { share: EditorShare }) {
  const name = share.householdName ?? 'Another household'
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {share.chip ? <HouseholdChip index={share.chip} name={name} /> : <span>{name}</span>}{' '}
      {share.pct}% · <Money value={share.amount} />
    </span>
  )
}

/** 'panel': the award with the stage change under it, or what stands in their place. */
function PanelFigures({ preview }: { preview: EditorPreview }) {
  if (preview.status === 'idle') return null
  if (preview.status === 'loading')
    return <span className="text-muted-foreground text-xs">Working it out…</span>
  if (preview.status === 'error') {
    return <span className={AMBER_NOTE}>{preview.error ?? "Couldn't work out the award"}</span>
  }
  return (
    <span className="flex flex-col leading-tight">
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span>
          Award <Money value={preview.award ?? null} className="font-semibold" />
        </span>
        {preview.pendingApproval === true && (
          <StatusPill tone={STATUS_TONE.round3}>Pending approval</StatusPill>
        )}
      </span>
      {preview.stageChange ? (
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          Stage → {preview.stageChange}
        </span>
      ) : null}
    </span>
  )
}

function EditorResult({ preview }: { preview: EditorPreview }) {
  if (preview.status === 'idle') return null
  if (preview.status === 'loading')
    return <span className="text-muted-foreground text-xs">Working it out…</span>
  if (preview.status === 'error') {
    return <span className={AMBER_NOTE}>{preview.error ?? "Couldn't work out the award"}</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        Award <Money value={preview.award ?? null} className="font-semibold" />
      </span>
      {preview.pendingApproval === true && (
        <StatusPill tone={STATUS_TONE.round3}>Pending approval</StatusPill>
      )}
      {preview.trace !== undefined && preview.trace.length > 0 && (
        <ReceiptSentence trace={preview.trace} className="text-muted-foreground text-xs" />
      )}
      {preview.stageChange ? (
        <span className="text-muted-foreground text-xs">Stage → {preview.stageChange}</span>
      ) : null}
      {preview.shares?.map((share) => (
        <ShareFigure key={share.householdCmId} share={share} />
      ))}
    </span>
  )
}

/** A reason limit above this is a statement, not a line: it gets a text area. */
const LONG_TEXT = 2000
/** 'panel': the mock's 4px-padded fields, so the one line stays as low as the detail text beside it. */
const FIELD_PANEL = FIELD_INLINE.replace('py-1.5', 'py-1')

interface Baseline {
  amount: number | null
  note: string
}

/**
 * The one shared request editor (§4.6; D22): an editor row under the highlighted grid row, or in
 * place on the household page's request card.
 * - While typing it shows the computed award, the limit that bound it (the receipt's one-line
 *   form), the stage change, the recomputed payer shares and both CampMinder ids (D27).
 * - Enter saves, once (Ruling 2026-10-01 (plan review)). ↓ and ↑ save and move on. Esc cancels.
 * - A Round 3 above the registrar's limit says it goes to finance (D79).
 */
export function RequestEditor(props: RequestEditorProps) {
  const noteStart = initialReason(props.policy, props.today)
  const [raw, setRaw] = useState(
    props.draft?.raw ?? (props.initialAmount === null ? '' : String(props.initialAmount))
  )
  const [reason, setReason] = useState(props.draft?.reason ?? noteStart)
  // What "nothing typed" means: the amount and note the editor opened with, moved forward when a
  // save finishes or an untouched field's amount is refetched. Amounts compare PARSED, so "1,200"
  // over 1200 is not an edit.
  const [base, setBase] = useState<Baseline>({
    amount: props.initialAmount,
    note: noteStart,
  })
  const [seenInitial, setSeenInitial] = useState(props.initialAmount)
  const [tried, setTried] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  // Set by a save; cleared by an edit or by a save finishing. A second Enter before either is
  // ignored, re-render or not.
  const submitted = useRef(false)
  const wasSaving = useRef(false)
  const lastSaved = useRef<{ saved: Baseline; before: Baseline } | null>(null)
  // The baseline a finished save replaced, kept so a failure that is reported a render late can
  // put it back.
  const advanced = useRef<{ saved: Baseline; before: Baseline } | null>(null)
  const parsed = parseMoneyInput(raw)

  const untouched =
    reason === base.note &&
    (parsed.kind === 'ok'
      ? parsed.amount === base.amount
      : parsed.kind === 'empty' && base.amount === null)

  if (props.initialAmount !== seenInitial) {
    setSeenInitial(props.initialAmount)
    if (untouched) {
      setRaw(props.initialAmount === null ? '' : String(props.initialAmount))
      setBase({ amount: props.initialAmount, note: base.note })
    }
  }

  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  useEffect(() => {
    if (wasSaving.current && props.saving !== true) {
      submitted.current = false
      // A finished save moves the baseline; a failed one keeps it, so what was typed still counts
      // as unsaved and ↓ or Enter retries it.
      if (lastSaved.current && !props.saveError) {
        setBase(lastSaved.current.saved)
        advanced.current = lastSaved.current
      }
      lastSaved.current = null
    }
    // The error arrived after `saving` fell (an onError callback, a caught mutateAsync): the save
    // failed, so what was typed is unsaved again.
    if (props.saveError && advanced.current) {
      setBase(advanced.current.before)
      advanced.current = null
    }
    wasSaving.current = props.saving === true
  }, [props.saving, props.saveError])

  const problem =
    parsed.kind === 'invalid'
      ? parsed.reason
      : parsed.kind === 'empty'
        ? `Enter the ${props.amountLabel.toLowerCase()}`
        : props.policy.kind === 'required' && reasonMissing(props.policy, reason)
          ? `${props.policy.label} is required`
          : null

  const reportTo = useRef(props.onDraftChange)
  useEffect(() => {
    reportTo.current = props.onDraftChange
  })
  const goneTo = useRef(props.onGone)
  useEffect(() => {
    goneTo.current = props.onGone
  })
  useEffect(
    () => () => {
      goneTo.current?.()
    },
    []
  )
  const readyAmount = parsed.kind === 'ok' ? parsed.amount : null
  useEffect(() => {
    if (untouched) {
      reportTo.current?.(null)
      return
    }
    const save =
      problem === null && readyAmount !== null
        ? { amount: readyAmount, reason: reason.trim() }
        : null
    reportTo.current?.({ raw, reason, save, problem })
  }, [untouched, raw, reason, problem, readyAmount])

  /** The save, once: null when it isn't valid yet or one is already on its way. */
  const takeSave = (): EditorSave | null => {
    setTried(true)
    if (problem !== null || parsed.kind !== 'ok' || props.saving === true || submitted.current)
      return null
    submitted.current = true
    advanced.current = null
    lastSaved.current = { saved: { amount: parsed.amount, note: reason }, before: base }
    return { amount: parsed.amount, reason: reason.trim() }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // Not a modified key, nor one that confirms an IME composition (AidTable does the same).
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.repeat) return
      const save = takeSave()
      if (save) props.onSave(save)
    } else if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      props.onMove &&
      // In a multi-line field the arrows belong to the caret: no save, no move.
      !(event.currentTarget instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault()
      // A held arrow must not walk the table.
      if (event.repeat) return
      // Both directions are exits: untouched just moves, typed text is saved first (A18).
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (untouched) {
        props.onMove(direction, null)
        return
      }
      const save = takeSave()
      if (save) props.onMove(direction, save)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
    }
  }

  const amountField = (
    <label className="flex items-center gap-2 whitespace-nowrap">
      {props.amountLabel}
      <input
        ref={amountRef}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(event) => {
          submitted.current = false
          setRaw(event.target.value)
          const next = parseMoneyInput(event.target.value)
          props.onAmountChange(next.kind === 'ok' ? next.amount : null)
        }}
        onKeyDown={onKeyDown}
        className={`${props.layout === 'panel' ? FIELD_PANEL : FIELD_INLINE} w-28 text-right tabular-nums`}
      />
    </label>
  )
  const noteField =
    props.policy.kind === 'none' ? null : (
      <label
        className={
          props.layout === 'card'
            ? 'flex items-center gap-2'
            : props.layout === 'panel'
              ? 'flex min-w-0 flex-[1_1_12.5rem] items-center gap-2'
              : 'flex min-w-[16rem] flex-1 items-center gap-2'
        }
      >
        {props.policy.label}
        {props.policy.maxLength > LONG_TEXT ? (
          // The statement of need (4000 characters): a small text area that grows with its text.
          // Enter still saves; Shift+Enter is a new line.
          <textarea
            rows={2}
            maxLength={props.policy.maxLength}
            value={reason}
            onChange={(event) => {
              submitted.current = false
              setReason(event.target.value)
            }}
            onKeyDown={onKeyDown}
            className={`${FIELD} field-sizing-content max-h-48 min-h-[3.25rem]`}
          />
        ) : (
          <input
            type="text"
            maxLength={props.policy.maxLength}
            value={reason}
            onChange={(event) => {
              submitted.current = false
              setReason(event.target.value)
            }}
            onKeyDown={onKeyDown}
            className={props.layout === 'panel' ? `${FIELD_PANEL} w-full min-w-0` : FIELD}
          />
        )}
      </label>
    )
  const hint = (
    <span className="text-muted-foreground text-xs whitespace-nowrap">
      Enter saves{props.onMove ? ' · ↑ ↓ save and move on' : ''} · Esc cancels
    </span>
  )
  const problemNote =
    (tried || props.showProblem === true) && problem !== null ? (
      <span className={AMBER_NOTE}>{problem}</span>
    ) : null
  const saveErrorNote = props.saveError ? (
    <span className={AMBER_NOTE}>{props.saveError}</span>
  ) : null

  if (props.layout === 'panel') {
    const ready = props.preview.status === 'ready'
    return (
      <div className="flex flex-col gap-0.5 text-sm">
        <div data-editor-top="" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {amountField}
          <PanelFigures preview={props.preview} />
          {problemNote}
          {saveErrorNote}
          {noteField}
          {props.trailing ? <span className="ml-auto">{props.trailing}</span> : null}
        </div>
        <div
          data-editor-foot=""
          className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 text-xs"
        >
          {ready && props.preview.trace !== undefined && props.preview.trace.length > 0 && (
            <ReceiptSentence
              trace={props.preview.trace}
              className="text-muted-foreground text-xs"
            />
          )}
          {ready &&
            props.preview.shares?.map((share) => (
              <ShareFigure key={share.householdCmId} share={share} />
            ))}
          <span className="ml-auto">{hint}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={
        props.layout === 'card'
          ? 'flex flex-col items-start gap-2 text-sm'
          : 'flex flex-wrap items-center gap-x-5 gap-y-2 text-sm'
      }
    >
      <span className="text-muted-foreground text-xs">
        {props.familyName} · household {props.householdCmId} · person {props.personCmId}
      </span>
      {amountField}
      <EditorResult preview={props.preview} />
      {noteField}
      {hint}
      {problemNote}
      {saveErrorNote}
    </div>
  )
}
