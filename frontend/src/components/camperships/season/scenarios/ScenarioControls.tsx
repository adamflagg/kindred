import { useCallback, useRef, useState, type ReactNode } from 'react'

import type { AidRequestSet } from '../../../../services/camperships/aidApi'
import { CS_BTN, CS_BTN2, CS_INPUT, CS_SELECT_CTL, CS_SMALL } from '../../kit/csType'
import type { LoadFrom } from '../../../../hooks/camperships/useAidScenarioDraft'
import { AidPicker } from '../../kit/AidPicker'
import { campToday } from '../../kit/dates'
import { EditorActions, EditorForm } from '../../kit/EditorLayout'
import type { AidPickerOption } from '../../kit/pickerWords'
import { AidSegmented } from '../../kit/Segmented'
import { AidToolbar, ToolbarLabel } from '../../kit/Toolbar'
import {
  guardWords,
  POSTED_CHOICES,
  PRICE_CHOICES,
  type PostedMode,
  type StartEntry,
} from './controlsModel'
import { KeepPopover } from './KeepPopover'
import { ScenarioPopover } from './ScenarioPopover'

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
 * The control line under the tab bar (scenarios-2; the mock's one toolbar), on the kit AidToolbar, left to right:
 * - the lead, "56 held · Oct 8, 4:18 am", with the full pile sentence as its title (the pile changes only on
 *   Update Applications, owner line 683);
 * - Sandbox | Compare;
 * - From ▾, one picker with two groups (Start from; Kept) and ✎ beside it renaming the loaded kept option;
 * - Price ▾;
 * - Posted ▾ once a round is posted (owner, 2026-10-10): Stands (regular), or As if none (as if nothing is posted);
 * - on the right the status slot (change count, "Nothing new since …", a refusal, the "isn't kept" notice), then
 *   Discard Changes, Make ‹B› the Rules Draft… and Keep… (in Compare, Columns, By tier and Print), and Update
 *   Applications last.
 * Nothing here wraps and nothing adds a row: a refusal is the status, never a banner.
 */
export function ScenarioControls(props: {
  panel: 'sandbox' | 'compare'
  compareCount: number
  onPanel: (panel: 'sandbox' | 'compare') => void
  /** The full pile sentence: the lead's title. */
  pill: string
  /** The lead's words: "56 held", and its moment (muted) when a pile is held. */
  lead: { readonly held: string; readonly when: string | null }
  nothingNew: string | null
  onUpdate: () => void
  price: AidRequestSet
  onPrice: (set: AidRequestSet) => void
  start: readonly StartEntry[]
  /** The sandbox's source code (a kept code or a built-in start). */
  fromCode: string
  /** The kept option loaded, if any. */
  loadedCode: string | null
  /** "built on v4, v5 is in effect now" for a draft built on older rules (A11), else null: the picker's title. */
  builtOn: string | null
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
  /** Columns' four-option refusal (Compare only). */
  refused: string | null
  /** "D isn't kept in 2027, so it was left out of the compare." */
  notice: string | null
  error: string | null
  /** Posted ▾'s mode, or null before any round posts (the two modes then price alike, so there is no picker). */
  posted: PostedMode | null
  onPosted: (mode: PostedMode) => void
}) {
  const [guard, setGuard] = useState<Guard | null>(null)
  const [keeping, setKeeping] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const groupRef = useRef<HTMLSpanElement>(null)
  const keepRef = useRef<HTMLSpanElement>(null)
  const closeGuard = useCallback(() => setGuard(null), [])
  const closeKeep = useCallback(() => setKeeping(false), [])
  const ask = (from: LoadFrom, name: string) => {
    if (props.unkept > 0) setGuard({ from, name })
    else props.onLoad(from)
  }
  const selected = props.loadedCode ?? props.fromCode
  const fromOptions: Array<AidPickerOption<string>> = [
    ...props.start.map((entry) => ({
      value: entry.value,
      label: entry.label,
      disabled: entry.disabled,
      group: 'Start from',
      ...(entry.value === selected && props.builtOn !== null ? { title: props.builtOn } : {}),
    })),
    ...props.chips.map((chip) => ({
      value: chip.code,
      label: `${chip.code} · ${chip.name}`,
      group: 'Kept',
      title: `${chip.code} · ${chip.name}, kept${chip.code === selected && props.builtOn !== null ? ` · ${props.builtOn}` : ''}`,
    })),
  ]
  const loadedChip = props.chips.find((chip) => chip.loaded)
  const status =
    props.error ??
    (props.panel === 'compare' ? props.refused : null) ??
    props.notice ??
    props.nothingNew ??
    (props.panel === 'sandbox' ? props.changes : null)
  const statusWarn =
    props.error !== null ||
    (props.panel === 'compare' && props.refused !== null) ||
    props.notice !== null ||
    (props.nothingNew === null && props.panel === 'sandbox' && props.changes !== null)
  const priceValue = props.price.kind
  const keepPop = keeping ? (
    <KeepPopover
      anchor={keepRef}
      prefill={props.keep.prefill}
      nextCode={props.keep.nextCode}
      figure={props.keep.figure}
      onKeep={props.onKeep}
      onClose={closeKeep}
    />
  ) : null
  return (
    <AidToolbar
      className="print:hidden"
      lead={
        <span title={props.pill}>
          {props.lead.held}
          {props.lead.when !== null && (
            <span className="text-muted-foreground font-normal">{` · ${props.lead.when}`}</span>
          )}
        </span>
      }
      left={
        <>
          <AidSegmented
            label="Panel"
            value={props.panel}
            options={[
              { value: 'sandbox', label: 'Sandbox' },
              {
                value: 'compare',
                label: 'Compare',
                ...(props.compareCount > 0 ? { count: props.compareCount } : {}),
              },
            ]}
            onChange={props.onPanel}
          />
          <ToolbarLabel text="From" plain>
            <span ref={groupRef} className="relative inline-flex items-center gap-1">
              {renaming !== null && loadedChip !== undefined ? (
                <RenameBox
                  code={loadedChip.code}
                  name={loadedChip.name}
                  onRename={props.onRename}
                  onDone={() => setRenaming(null)}
                />
              ) : (
                <AidPicker
                  label="From"
                  value={selected}
                  disabled={!props.canEdit}
                  options={fromOptions}
                  onChange={(value) => {
                    const entry = props.start.find((e) => e.value === value)
                    if (entry !== undefined) ask({ start: entry.value }, 'It')
                    else ask({ option: value }, value)
                  }}
                />
              )}
              {loadedChip !== undefined && props.canEdit && renaming === null && (
                <button
                  type="button"
                  aria-label={`Rename ${loadedChip.code}`}
                  title={`Rename ${loadedChip.code}`}
                  className="text-muted-foreground hover:text-foreground cursor-pointer px-1 text-xs"
                  onClick={() => setRenaming(loadedChip.code)}
                >
                  ✎
                </button>
              )}
              <ScenarioPopover
                open={guard !== null}
                onClose={closeGuard}
                anchor={groupRef}
                width={460}
                testId="load-guard"
                editor
              >
                {guard !== null && (
                  <EditorForm
                    actions={
                      <EditorActions>
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
                      </EditorActions>
                    }
                  >
                    <p className={CS_SMALL}>
                      {guardWords(props.unkept, guard.name === 'It' ? 'it' : guard.name)}
                    </p>
                  </EditorForm>
                )}
              </ScenarioPopover>
            </span>
          </ToolbarLabel>
          <ToolbarLabel text="Price">
            <AidPicker
              label="Price"
              value={priceValue}
              options={PRICE_CHOICES}
              onChange={(kind) => {
                props.onPrice(
                  kind === 'deadline'
                    ? { kind: 'deadline' }
                    : kind === 'date'
                      ? { kind: 'date', date: campToday() }
                      : { kind: 'all' }
                )
              }}
            />
            {props.price.kind === 'date' && (
              <input
                type="date"
                aria-label="Price through"
                className={CS_SELECT_CTL}
                value={props.price.date}
                onChange={(event) => {
                  if (event.target.value !== '')
                    props.onPrice({ kind: 'date', date: event.target.value })
                }}
              />
            )}
          </ToolbarLabel>
          {props.posted !== null && (
            <ToolbarLabel text="Posted">
              <AidPicker
                label="Posted"
                value={props.posted}
                options={POSTED_CHOICES}
                onChange={props.onPosted}
              />
            </ToolbarLabel>
          )}
        </>
      }
      {...(status === null ? {} : { status })}
      statusWarn={statusWarn}
      right={
        <>
          {props.panel === 'compare' ? (
            props.compareTools
          ) : (
            <>
              {props.changes !== null && (
                <button type="button" className={CS_BTN2} onClick={props.onDiscard}>
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
              <span ref={keepRef} className="relative inline-flex">
                <button
                  type="button"
                  className={CS_BTN}
                  disabled={!props.keep.enabled}
                  onClick={() => setKeeping(true)}
                >
                  Keep…
                </button>
                {keepPop}
              </span>
            </>
          )}
          {/* The guard's Keep… opens it from Compare too, where the picker also loads. */}
          {props.panel === 'compare' && keepPop !== null && (
            <span ref={keepRef} className="relative inline-flex">
              {keepPop}
            </span>
          )}
          <button type="button" className={CS_BTN2} onClick={props.onUpdate}>
            Update Applications
          </button>
        </>
      }
    />
  )
}
