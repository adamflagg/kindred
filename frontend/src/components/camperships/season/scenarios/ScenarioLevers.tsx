import { useState, type ReactNode } from 'react'

import type { ApiAidLeverEffect, ApiAidRulesDocument } from '../../../../types/api-types'
import { FIELD_INLINE } from '../../../admin/lodging/lodgingStyles'
import { formatSetting } from '../rules/rulesModel'
import { parseSetting } from '../rules/sectionEdit'
import {
  BAND_RANGE,
  MINIMUM_RANGE,
  SHIFT_RANGE,
  bandWords,
  isDollarForDollar,
  readStep,
  shiftWords,
  stepWords,
  type Pending,
} from './scenarioModel'

interface LeversProps {
  readonly document: ApiAidRulesDocument
  readonly pending: Pending
  readonly effects: readonly ApiAidLeverEffect[]
  /** A write is running: the sliders stand still (useAidScenarioDraft). */
  readonly disabled: boolean
  readonly onMove: (patch: Partial<Pending>) => void
  readonly onRelease: () => void
}

const MINIMUM_SPEC = { kind: 'number', unit: 'money', whole: false, nullable: false } as const

function Lever({
  title,
  effect,
  children,
}: {
  title: string
  effect: ApiAidLeverEffect | undefined
  children: ReactNode
}) {
  return (
    <div className="space-y-1 py-1.5">
      <div className="text-sm font-medium">{effect?.label ?? title}</div>
      {children}
      <div className="text-muted-foreground text-xs">{stepWords(effect) ?? ' '}</div>
    </div>
  )
}

/** A typed box beside a slider (D37): the box takes what a step allows; Enter or leaving it records. */
function StepBox({
  label,
  value,
  range,
  disabled,
  onMove,
  onRelease,
}: {
  label: string
  value: number
  range: { min: number; max: number; step: number }
  disabled: boolean
  onMove: (value: number) => void
  onRelease: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(value)
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={`${FIELD_INLINE} w-20 text-right tabular-nums`}
      value={shown}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value)
        const read = readStep(event.target.value, range)
        if (read !== null) onMove(read)
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
  pending,
  effects,
  disabled,
  onMove,
  onRelease,
}: LeversProps) {
  const effect = (lever: string) => effects.find((e) => e.lever === lever)
  const minimum = pending.minimum ?? document.awards.minimum
  const [minimumText, setMinimumText] = useState<string | null>(null)
  const minimumProblem =
    minimumText === null ? null : parseSetting(minimumText, MINIMUM_SPEC).kind === 'invalid'
  const dollar = pending.dollar ?? isDollarForDollar(document)
  const releaseOnLetGo = { onPointerUp: onRelease, onKeyUp: onRelease }

  return (
    <div className="card-lodge divide-border divide-y px-3 py-1" data-testid="scenario-levers">
      <Lever title="Shift every tier (Round 1 %)" effect={effect('tier_shift')}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="Shift every tier, slider"
            className="flex-1"
            min={SHIFT_RANGE.min}
            max={SHIFT_RANGE.max}
            step={SHIFT_RANGE.step}
            value={pending.tierShift}
            disabled={disabled}
            onChange={(event) => onMove({ tierShift: Number(event.target.value) })}
            {...releaseOnLetGo}
          />
          <StepBox
            label="Shift every tier, points"
            value={pending.tierShift}
            range={SHIFT_RANGE}
            disabled={disabled}
            onMove={(tierShift) => onMove({ tierShift })}
            onRelease={onRelease}
          />
          <span className="text-muted-foreground w-20 text-xs">
            {shiftWords(pending.tierShift)}
          </span>
        </div>
      </Lever>
      <Lever title="Band width" effect={effect('band_width')}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="Widen every band, slider"
            className="flex-1"
            min={BAND_RANGE.min}
            max={BAND_RANGE.max}
            step={BAND_RANGE.step}
            value={pending.bandDelta}
            disabled={disabled}
            onChange={(event) => onMove({ bandDelta: Number(event.target.value) })}
            {...releaseOnLetGo}
          />
          <StepBox
            label="Widen every band, dollars"
            value={pending.bandDelta}
            range={BAND_RANGE}
            disabled={disabled}
            onMove={(bandDelta) => onMove({ bandDelta })}
            onRelease={onRelease}
          />
          <span className="text-muted-foreground w-24 text-xs">{bandWords(pending.bandDelta)}</span>
        </div>
      </Lever>
      <Lever title="Minimum award" effect={effect('minimum')}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            aria-label="Minimum award, slider"
            className="flex-1"
            min={MINIMUM_RANGE.min}
            max={MINIMUM_RANGE.max}
            step={MINIMUM_RANGE.step}
            value={Number(minimum)}
            disabled={disabled}
            onChange={(event) => onMove({ minimum: event.target.value })}
            {...releaseOnLetGo}
          />
          <span className="text-muted-foreground">$</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Minimum award, dollars"
            className={`${FIELD_INLINE} w-20 text-right tabular-nums`}
            value={minimumText ?? minimum}
            disabled={disabled}
            onChange={(event) => {
              setMinimumText(event.target.value)
              const read = parseSetting(event.target.value, MINIMUM_SPEC)
              if (read.kind === 'ok' && typeof read.value === 'string')
                onMove({ minimum: read.value })
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
          <span className="text-muted-foreground w-24 text-xs">
            {minimumProblem === true ? 'not an amount' : formatSetting(minimum, ['minimum'])}
          </span>
        </div>
      </Lever>
      <Lever title="Grants offset dollar-for-dollar" effect={effect('dollar_for_dollar')}>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
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
  )
}
