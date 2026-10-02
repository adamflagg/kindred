import { useRef, useState, type ReactNode } from 'react'

import type { ApiAidLeverEffect, ApiAidRulesDocument } from '../../../../types/api-types'
import { AMBER_NOTE, FIELD_INLINE, GROUP_HEADING } from '../../../admin/lodging/lodgingStyles'
import { SECTION_TITLES, formatSetting } from '../rules/rulesModel'
import { parseSetting } from '../rules/sectionEdit'
import {
  BAND_RANGE,
  MINIMUM_RANGE,
  SHIFT_RANGE,
  bandWords,
  isDollarForDollar,
  isStillTyping,
  readStep,
  shiftWords,
  stepNote,
  stepWords,
  type LeverKey,
  type Pending,
} from './scenarioModel'
import { CHANGED_NAME } from './scenarioStyles'

interface LeversProps {
  readonly document: ApiAidRulesDocument
  /** The kept option the draft comes from: "Settings · draft from B". */
  readonly from: string
  readonly pending: Pending
  /** The settings that differ from `from`, recorded or moving: their names are amber. */
  readonly changed: ReadonlySet<LeverKey>
  readonly effects: readonly ApiAidLeverEffect[]
  /** A write is running: the sliders stand still (useAidScenarioDraft). */
  readonly disabled: boolean
  readonly onMove: (patch: Partial<Pending>) => void
  readonly onRelease: () => void
}

const MINIMUM_SPEC = { kind: 'number', unit: 'money', whole: false, nullable: false } as const
const SLIDER = 'accent-primary w-full'
const WORDS = 'text-muted-foreground w-24 text-xs'

/**
 * One setting, as the mock lays it out: its section (named as the Rules tab names it), then its name with the typed box on one row,
 * the slider full width beneath, and what one step moves Round 1 by.
 */
function Lever({
  section,
  title,
  effect,
  changed,
  box,
  children,
}: {
  section: string
  title: string
  effect: ApiAidLeverEffect | undefined
  changed: boolean
  box: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1 py-1.5">
      <div className={GROUP_HEADING}>{section}</div>
      <div className="flex items-center gap-2 text-sm">
        <span className={changed ? `flex-1 ${CHANGED_NAME}` : 'flex-1 font-medium'}>
          {effect?.label ?? title}
        </span>
        {box}
      </div>
      {children}
      <div className="text-muted-foreground text-xs">{stepWords(effect) ?? ' '}</div>
    </div>
  )
}

/**
 * A typed box moves the draft key by key, so a refused value's valid prefix ("1" of "11") would
 * already have moved it (rereview I1). This remembers the value when focus enters, and a refusal
 * puts the draft back there, so letting go records nothing new.
 */
function useBackOnRefusal<T>(value: T, onMove: (value: T) => void) {
  const entered = useRef(value)
  const strayed = useRef(false)
  return {
    enter: () => {
      entered.current = value
      strayed.current = false
    },
    move: (next: T) => {
      strayed.current = true
      onMove(next)
    },
    refuse: () => {
      if (!strayed.current) return
      strayed.current = false
      onMove(entered.current)
    },
  }
}

/** parseSetting's reason as a short note; a non-number keeps the box's own "not an amount". */
function minimumNote(reason: string): string {
  return reason === 'Not a number' ? 'not an amount' : reason.toLowerCase()
}

/**
 * A typed box beside a slider (D37): the box takes what a step allows; Enter or leaving it records.
 * Anything else it says briefly, in amber, and leaves the draft as it is (residue 12).
 */
function StepBox({
  label,
  value,
  range,
  unit,
  words,
  disabled,
  onMove,
  onRelease,
}: {
  label: string
  value: number
  range: { min: number; max: number; step: number }
  unit: 'points' | 'money'
  words: string
  disabled: boolean
  onMove: (value: number) => void
  onRelease: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const back = useBackOnRefusal(value, onMove)
  const note = text === null ? null : stepNote(text, range, unit)
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        className={`${FIELD_INLINE} w-20 text-right tabular-nums`}
        value={text ?? String(value)}
        disabled={disabled}
        onFocus={back.enter}
        onChange={(event) => {
          setText(event.target.value)
          const read = readStep(event.target.value, range)
          if (read !== null) back.move(read)
          else if (stepNote(event.target.value, range, unit) !== null) back.refuse()
        }}
        onBlur={() => {
          setText(null)
          onRelease()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            setText(null)
            onRelease()
          }
        }}
      />
      <span className={note === null ? WORDS : `${AMBER_NOTE} w-24`}>{note ?? words}</span>
    </>
  )
}

/**
 * The sizing settings (spec §7.4; D37, D117, D137; scenarios-v2.html): every number typed or dragged,
 * the dollar-for-dollar switch named on its own, and beside each what one step moves Round 1 by. The
 * two sliders move the draft as recorded by points and dollars (the server's `tier_shift` and
 * `band_width_delta`); letting go records it, and they start from zero again (Decision 19).
 */
export function ScenarioLevers({
  document,
  from,
  pending,
  changed,
  effects,
  disabled,
  onMove,
  onRelease,
}: LeversProps) {
  const effect = (lever: string) => effects.find((e) => e.lever === lever)
  const minimum = pending.minimum ?? document.awards.minimum
  const [minimumText, setMinimumText] = useState<string | null>(null)
  // The pending minimum, not the document's: putting it back to null moves nothing, so a refused
  // value leaves nothing to record (rereview I1).
  const minimumBack = useBackOnRefusal(pending.minimum, (back) => onMove({ minimum: back }))
  const minimumRead =
    minimumText === null || isStillTyping(minimumText)
      ? null
      : parseSetting(minimumText, MINIMUM_SPEC)
  const minimumProblem = minimumRead?.kind === 'invalid' ? minimumNote(minimumRead.reason) : null
  const dollar = pending.dollar ?? isDollarForDollar(document)
  // Blur too: a pointer-up that never comes (a cancelled drag) must not leave the draft moving.
  const releaseOnLetGo = { onPointerUp: onRelease, onKeyUp: onRelease, onBlur: onRelease }

  return (
    <div className="card-lodge" data-testid="scenario-levers">
      <div className={`${GROUP_HEADING} px-3 pt-2`}>{`Settings · draft from ${from}`}</div>
      <div className="divide-border divide-y px-3 py-1">
        <Lever
          section={SECTION_TITLES.award_tables}
          title="Shift every tier (Round 1 %)"
          effect={effect('tier_shift')}
          changed={changed.has('tier_shift')}
          box={
            <StepBox
              label="Shift every tier, points"
              value={pending.tierShift}
              range={SHIFT_RANGE}
              unit="points"
              words={shiftWords(pending.tierShift)}
              disabled={disabled}
              onMove={(tierShift) => onMove({ tierShift })}
              onRelease={onRelease}
            />
          }
        >
          <input
            type="range"
            aria-label="Shift every tier, slider"
            className={SLIDER}
            min={SHIFT_RANGE.min}
            max={SHIFT_RANGE.max}
            step={SHIFT_RANGE.step}
            value={pending.tierShift}
            disabled={disabled}
            onChange={(event) => onMove({ tierShift: Number(event.target.value) })}
            {...releaseOnLetGo}
          />
        </Lever>
        <Lever
          section={SECTION_TITLES.tiers}
          title="Band width"
          effect={effect('band_width')}
          changed={changed.has('band_width')}
          box={
            <StepBox
              label="Widen every band, dollars"
              value={pending.bandDelta}
              range={BAND_RANGE}
              unit="money"
              words={bandWords(pending.bandDelta)}
              disabled={disabled}
              onMove={(bandDelta) => onMove({ bandDelta })}
              onRelease={onRelease}
            />
          }
        >
          <input
            type="range"
            aria-label="Widen every band, slider"
            className={SLIDER}
            min={BAND_RANGE.min}
            max={BAND_RANGE.max}
            step={BAND_RANGE.step}
            value={pending.bandDelta}
            disabled={disabled}
            onChange={(event) => onMove({ bandDelta: Number(event.target.value) })}
            {...releaseOnLetGo}
          />
        </Lever>
        <Lever
          section={SECTION_TITLES.awards}
          title="Minimum award"
          effect={effect('minimum')}
          changed={changed.has('minimum')}
          box={
            <>
              <span className="text-muted-foreground text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Minimum award, dollars"
                className={`${FIELD_INLINE} w-20 text-right tabular-nums`}
                value={minimumText ?? minimum}
                disabled={disabled}
                onFocus={minimumBack.enter}
                onChange={(event) => {
                  setMinimumText(event.target.value)
                  if (isStillTyping(event.target.value)) return
                  const read = parseSetting(event.target.value, MINIMUM_SPEC)
                  if (read.kind === 'ok' && typeof read.value === 'string')
                    minimumBack.move(read.value)
                  else minimumBack.refuse()
                }}
                onBlur={() => {
                  setMinimumText(null)
                  onRelease()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setMinimumText(null)
                    onRelease()
                  }
                }}
              />
              <span className={minimumProblem === null ? WORDS : `${AMBER_NOTE} w-24`}>
                {minimumProblem ?? formatSetting(minimum, ['minimum'])}
              </span>
            </>
          }
        >
          <input
            type="range"
            aria-label="Minimum award, slider"
            className={SLIDER}
            min={MINIMUM_RANGE.min}
            max={MINIMUM_RANGE.max}
            step={MINIMUM_RANGE.step}
            value={Number(minimum)}
            disabled={disabled}
            onChange={(event) => onMove({ minimum: event.target.value })}
            {...releaseOnLetGo}
          />
        </Lever>
        <Lever
          section={SECTION_TITLES.grants}
          title="Grants offset dollar-for-dollar"
          effect={effect('dollar_for_dollar')}
          changed={changed.has('dollar_for_dollar')}
          box={null}
        >
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={dollar}
              disabled={disabled}
              onChange={(event) => {
                onMove({ dollar: event.target.checked })
                onRelease()
              }}
            />
            {dollar
              ? 'on: each counted grant dollar lowers the award a dollar'
              : 'off: the award is priced on cost less grants'}
          </label>
        </Lever>
      </div>
      <p className="text-muted-foreground px-3 pb-2 text-xs">{`Type a number or drag. Amber = differs from ${from}.`}</p>
    </div>
  )
}
