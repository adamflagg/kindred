import { useCallback, useRef, useState, type ReactNode } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import {
  CS_AMBER_NOTE,
  CS_BTN,
  CS_BTN2,
  CS_BTN_SM,
  CS_CHIP,
  CS_CHIP_ON,
  CS_FLABEL,
  CS_INPUT,
  CS_META,
  CS_PILL,
  CS_SEG,
  CS_SEG_BUTTON,
  CS_SEG_OFF,
  CS_SEG_ON,
  CS_SELECT,
  CS_SMALL,
  CS_STRIP,
} from '../../kit/csType'
import type { LoadFrom } from '../../../../hooks/camperships/useAidScenarioDraft'
import { campToday } from '../../kit/dates'
import { PRICE_CHOICES, type StartEntry } from './controlsModel'
import { KeepPopover } from './KeepPopover'
import { ScenarioPopover } from './ScenarioPopover'
import { WAS_INK } from './scenarioStyles'

export interface KeptChip {
  readonly code: string
  readonly name: string
  readonly loaded: boolean
}

interface Guard {
  readonly from: LoadFrom
  readonly name: string
}

export function RenameBox({
  code,
  name,
  onRename,
  onDone,
  width = 210,
}: {
  code: string
  name: string
  onRename: (code: string, name: string) => void
  onDone: () => void
  width?: number
}) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const trimmed = value.trim()
    if (save && trimmed !== '' && trimmed !== name) onRename(code, trimmed)
    onDone()
  }
  return (
    <input
      aria-label={`Name of ${code}`}
      className={CS_INPUT}
      style={{ width }}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') finish(false)
      }}
    />
  )
}

/**
 * The control line under the tab bar (Scenarios addendum §S5 A), left to right:
 * - Sandbox | Compare;
 * - the held pile's pill and Update Applications (owner line 683: the pile changes only on this button);
 * - Price ▾;
 * - the kept group: Start from ▾, then flat named chips with ✎ on the loaded one;
 * - on the right, the change count, Discard Changes, Make ‹B› the Rules Draft… and Keep… (in Compare, Columns ▾,
 *   By tier and Print);
 * - a refusal as one amber line, never a banner.
 */
export function ScenarioControls(props: {
  panel: 'sandbox' | 'compare'
  compareCount: number
  onPanel: (panel: 'sandbox' | 'compare') => void
  pill: string
  nothingNew: string | null
  onUpdate: () => void
  price: AidRequestSet
  onPrice: (set: AidRequestSet) => void
  start: readonly StartEntry[]
  /** The sandbox's source code (a kept code or a built-in start). */
  fromCode: string
  /** The kept option loaded, if any: the select then shows "‹code›, kept". */
  loadedCode: string | null
  chips: readonly KeptChip[]
  /** Unkept changes: a load asks first (§S5 C). */
  unkept: number
  onLoad: (from: LoadFrom) => void
  canEdit: boolean
  onRename: (code: string, name: string) => void
  changes: string | null
  onDiscard: () => void
  keep: {
    readonly enabled: boolean
    readonly prefill: string
    readonly nextCode: string
    readonly figure: string
  }
  onKeep: (name: string) => void
  promote: string | null
  onPromote: (code: string) => void
  compareTools: ReactNode
  error: string | null
}) {
  const [guard, setGuard] = useState<Guard | null>(null)
  const [keeping, setKeeping] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const closeGuard = useCallback(() => setGuard(null), [])
  const closeKeep = useCallback(() => setKeeping(false), [])
  const ask = (from: LoadFrom, name: string) => {
    if (props.unkept > 0) setGuard({ from, name })
    else props.onLoad(from)
  }
  const selected = props.loadedCode !== null ? '' : props.fromCode
  const priceValue = props.price.kind
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 print:hidden">
      <div className={CS_SEG}>
        <button
          type="button"
          className={`${CS_SEG_BUTTON} ${props.panel === 'sandbox' ? CS_SEG_ON : CS_SEG_OFF}`}
          onClick={() => props.onPanel('sandbox')}
        >
          Sandbox
        </button>
        <button
          type="button"
          className={`${CS_SEG_BUTTON} ${props.panel === 'compare' ? CS_SEG_ON : CS_SEG_OFF}`}
          onClick={() => props.onPanel('compare')}
        >
          {props.compareCount > 0 ? `Compare ${String(props.compareCount)}` : 'Compare'}
        </button>
      </div>
      <span className={CS_PILL.muted}>{props.pill}</span>
      <button type="button" className={CS_BTN2} onClick={props.onUpdate}>
        Update Applications
      </button>
      {props.nothingNew !== null && <span className={CS_SMALL}>{props.nothingNew}</span>}
      <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
        Price
        <select
          aria-label="Price"
          className={CS_SELECT}
          value={priceValue}
          onChange={(event) => {
            const kind = event.target.value
            props.onPrice(
              kind === 'deadline'
                ? { kind: 'deadline' }
                : kind === 'date'
                  ? { kind: 'date', date: campToday() }
                  : { kind: 'all' }
            )
          }}
        >
          {PRICE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        {props.price.kind === 'date' && (
          <input
            type="date"
            aria-label="Price through"
            className={CS_SELECT}
            value={props.price.date}
            onChange={(event) => {
              if (event.target.value !== '')
                props.onPrice({ kind: 'date', date: event.target.value })
            }}
          />
        )}
      </label>
      <div ref={groupRef} className={`${CS_STRIP} relative flex-wrap whitespace-normal`}>
        <span className={`${CS_META} font-bold`}>Start from</span>
        <select
          aria-label="Start from"
          className={CS_SELECT}
          value={selected}
          disabled={!props.canEdit}
          onChange={(event) => {
            const entry = props.start.find((e) => e.value === event.target.value)
            if (entry !== undefined) ask({ start: entry.value }, 'It')
          }}
        >
          {props.loadedCode !== null && (
            <option value="" disabled>
              {`${props.loadedCode}, kept`}
            </option>
          )}
          {props.start.map((entry) => (
            <option key={entry.value} value={entry.value} disabled={entry.disabled}>
              {entry.label}
            </option>
          ))}
        </select>
        <span className="bg-border h-5 w-px" />
        {props.chips.length === 0 && <span className={CS_SMALL}>nothing kept yet</span>}
        {props.chips.map((chip) =>
          renaming === chip.code ? (
            <RenameBox
              key={chip.code}
              code={chip.code}
              name={chip.name}
              onRename={props.onRename}
              onDone={() => setRenaming(null)}
            />
          ) : (
            <span key={chip.code} className="inline-flex items-center gap-0.5">
              <button
                type="button"
                className={chip.loaded ? CS_CHIP_ON : CS_CHIP}
                onClick={() => ask({ option: chip.code }, chip.code)}
              >
                <b className="tabular-nums">{chip.code}</b> {chip.name}
              </button>
              {chip.loaded && props.canEdit && (
                <button
                  type="button"
                  aria-label={`Rename ${chip.code}`}
                  className={`${CS_SMALL} px-1`}
                  onClick={() => setRenaming(chip.code)}
                >
                  ✎
                </button>
              )}
            </span>
          )
        )}
        <ScenarioPopover
          open={guard !== null}
          onClose={closeGuard}
          anchor={groupRef}
          testId="load-guard"
        >
          {guard !== null && (
            <div className="space-y-2">
              <p
                className={CS_SMALL}
              >{`${props.changes?.split(',')[0] ?? `${String(props.unkept)} changes`} aren't kept. Loading ${guard.name === 'It' ? 'it' : guard.name} drops them.`}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={!props.keep.enabled}
                  onClick={() => {
                    setGuard(null)
                    setKeeping(true)
                  }}
                >
                  Keep…
                </button>
                <button
                  type="button"
                  className={CS_BTN}
                  onClick={() => {
                    props.onLoad(guard.from)
                    setGuard(null)
                  }}
                >
                  {`Drop and Load ${guard.name}`}
                </button>
                <button type="button" className={CS_BTN2} onClick={closeGuard}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </ScenarioPopover>
      </div>
      <div className="relative ml-auto flex flex-wrap items-center gap-2">
        {props.panel === 'compare' ? (
          props.compareTools
        ) : (
          <>
            {props.changes !== null && (
              <span className={`${CS_SMALL} ${WAS_INK}`}>{props.changes}</span>
            )}
            {props.changes !== null && (
              <button type="button" className={CS_BTN_SM} onClick={props.onDiscard}>
                Discard Changes
              </button>
            )}
            {props.promote !== null && (
              <button
                type="button"
                className={CS_BTN2}
                onClick={() => props.onPromote(props.promote ?? '')}
              >
                {`Make ${props.promote} the Rules Draft…`}
              </button>
            )}
            <button
              ref={keepRef}
              type="button"
              className={CS_BTN}
              disabled={!props.keep.enabled}
              onClick={() => setKeeping(true)}
            >
              Keep…
            </button>
          </>
        )}
        {/* Outside the panel switch: the guard's Keep… opens it from Compare too, where the chips also load. */}
        {keeping && (
          <KeepPopover
            anchor={keepRef}
            prefill={props.keep.prefill}
            nextCode={props.keep.nextCode}
            figure={props.keep.figure}
            onKeep={props.onKeep}
            onClose={closeKeep}
          />
        )}
      </div>
      {props.error !== null && <p className={`${CS_AMBER_NOTE} w-full`}>{props.error}</p>}
    </div>
  )
}
