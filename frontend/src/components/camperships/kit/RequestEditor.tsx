import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

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
  readonly error?: string | undefined
}

export interface EditorSave {
  readonly amount: number
  readonly reason: string
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
   * Grid only (Decision 6, RULED 2026-10-01): ↓ saves and moves on (D22), or just moves when
   * nothing was typed (save = null); ↑ just moves back, and only when nothing was typed (D31).
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
  /** 'row' under the highlighted grid row; 'card' in place on the household page's request card (D22). */
  readonly layout?: 'row' | 'card' | undefined
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
      {preview.shares?.map((share) => {
        const name = share.householdName ?? 'Another household'
        return (
          <span key={share.householdCmId} className="inline-flex items-center gap-1 text-xs">
            {share.chip ? <HouseholdChip index={share.chip} name={name} /> : <span>{name}</span>}{' '}
            {share.pct}% · <Money value={share.amount} />
          </span>
        )
      })}
    </span>
  )
}

/** A reason limit above this is a statement, not a line: it gets a text area. */
const LONG_TEXT = 2000

interface Baseline {
  amount: number | null
  note: string
}

/**
 * The one shared request editor (§4.6; D22): an editor row under the highlighted grid row, or in
 * place on the household page's request card.
 * - While typing it shows the computed award, the limit that bound it (the receipt's one-line
 *   form), the stage change, the recomputed payer shares and both CampMinder ids (D27).
 * - Enter saves, once (Ruling 2026-10-01 (plan review)). ↓ saves and moves on. Esc cancels.
 * - A Round 3 above the registrar's limit says it goes to finance (D79).
 */
export function RequestEditor(props: RequestEditorProps) {
  const noteStart = initialReason(props.policy, props.today)
  const [raw, setRaw] = useState(props.initialAmount === null ? '' : String(props.initialAmount))
  const [reason, setReason] = useState(noteStart)
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
      if (event.key === 'ArrowDown') {
        if (untouched) {
          props.onMove(1, null)
          return
        }
        const save = takeSave()
        if (save) props.onMove(1, save)
      } else if (untouched) {
        props.onMove(-1, null)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
    }
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
      <label className="flex items-center gap-2">
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
          className={`${FIELD_INLINE} w-28 text-right tabular-nums`}
        />
      </label>
      <EditorResult preview={props.preview} />
      {props.policy.kind !== 'none' && (
        <label
          className={
            props.layout === 'card'
              ? 'flex items-center gap-2'
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
              className={FIELD}
            />
          )}
        </label>
      )}
      <span className="text-muted-foreground text-xs">
        Enter saves{props.onMove ? ' · ↓ saves and moves on' : ''} · Esc cancels
      </span>
      {tried && problem !== null && <span className={AMBER_NOTE}>{problem}</span>}
      {props.saveError ? <span className={AMBER_NOTE}>{props.saveError}</span> : null}
    </div>
  )
}
