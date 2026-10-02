import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_INLINE,
} from '../../../admin/lodging/lodgingStyles'
import { formatSetting } from './rulesModel'
import {
  applyEdits,
  editKey,
  fieldName,
  fieldSpec,
  rawOf,
  valueAt,
  type FieldSpec,
} from './sectionEdit'
import { SectionView, type RenderSetting } from './SectionView'

export interface SectionEditorProps {
  /** The section's settings as the editor works on them: as opened, or as rebased after a 409. */
  readonly opened: Readonly<Record<string, unknown>>
  /** Which draft this editor edits, said at its top (D39: every editor says which draft it edits). */
  readonly heading: ReactNode
  /** The home's own line above the settings: a G6 refusal, a lock (the rules home), or nothing. */
  readonly banner?: ((changed: readonly string[][]) => ReactNode) | undefined
  readonly saving: boolean
  /** False while the home holds the save back (a G6 refusal the person hasn't looked at yet). */
  readonly canSave?: boolean | undefined
  readonly error: string | null
  /** The whole section with what was typed; called only when every box reads and something changed. */
  readonly onSave: (content: Record<string, unknown>) => void
  readonly onCancel: () => void
}

const words = (value: string) => value.replaceAll('_', ' ')

function Field({
  path,
  value,
  spec,
  raw,
  problem,
  changed,
  onChange,
}: {
  path: readonly string[]
  value: unknown
  spec: FieldSpec
  raw: string
  problem: string | null
  changed: boolean
  onChange: (raw: string) => void
}) {
  const name = fieldName(path)
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {spec.kind === 'yesno' ? (
        <input
          type="checkbox"
          aria-label={name}
          checked={raw === 'true'}
          onChange={(event) => onChange(String(event.target.checked))}
        />
      ) : spec.kind === 'choice' ? (
        <select
          aria-label={name}
          className={FIELD_INLINE}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        >
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {words(option)}
            </option>
          ))}
        </select>
      ) : (
        <>
          {spec.unit === 'money' && <span className="text-muted-foreground">$</span>}
          <input
            type="text"
            inputMode="decimal"
            aria-label={name}
            className={`${FIELD_INLINE} w-28 text-right tabular-nums`}
            value={raw}
            placeholder={spec.nullable ? 'none' : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {spec.unit === 'percent' && <span className="text-muted-foreground">%</span>}
        </>
      )}
      {changed && <span className={AMBER_NOTE}>was {formatSetting(value, path)}</span>}
      {problem !== null && <span className={AMBER_NOTE}>{problem}</span>}
    </span>
  )
}

/**
 * One rules section's editor (spec §7.5; D39: one editor per section, two homes). The section reads
 * as it does read only, with a box where a figure can be typed (Decision 14). What is typed stays here
 * across a rebase: the home may hand it a newer `opened` after a refusal, and the typing applies on
 * top. Nothing is sent while a box can't be read.
 */
export function SectionEditor({
  opened,
  heading,
  banner,
  saving,
  canSave = true,
  error,
  onSave,
  onCancel,
}: SectionEditorProps) {
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(() => new Map())
  const specOf = useCallback(
    (path: readonly string[]) => fieldSpec(path, valueAt(opened, path)),
    [opened]
  )
  const applied = useMemo(() => applyEdits(opened, edits, specOf), [opened, edits, specOf])
  const changedKeys = useMemo(() => new Set(applied.changed.map(editKey)), [applied.changed])

  const renderValue: RenderSetting = (path, value) => {
    const spec = fieldSpec(path, value)
    if (spec === null) return <span>{formatSetting(value, path)}</span>
    const key = editKey(path)
    return (
      <Field
        path={path}
        value={value}
        spec={spec}
        raw={edits.get(key) ?? (spec.kind === 'yesno' ? String(value === true) : rawOf(value))}
        problem={applied.problems.get(key) ?? null}
        changed={changedKeys.has(key)}
        onChange={(raw) =>
          setEdits((previous) => {
            const next = new Map(previous)
            next.set(key, raw)
            return next
          })
        }
      />
    )
  }

  const blocked = applied.problems.size > 0
  const nothing = applied.changed.length === 0
  return (
    <div className="space-y-2" data-testid="section-editor">
      <div className="text-sm font-medium">{heading}</div>
      {banner?.(applied.changed)}
      <SectionView content={opened} renderValue={renderValue} />
      {error !== null && <p className={AMBER_NOTE}>{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={saving || !canSave || blocked || nothing}
          onClick={() => onSave(applied.content)}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={BUTTON_SECONDARY} disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        {blocked && <span className={AMBER_NOTE}>Fix the boxes marked above first.</span>}
      </div>
    </div>
  )
}
