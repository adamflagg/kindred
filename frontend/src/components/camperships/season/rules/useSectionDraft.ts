import { useCallback, useMemo, useState } from 'react'

import { applyEdits, editKey, rawOf as rawValue, type Applied, type FieldSpec } from './sectionEdit'

/**
 * The typed-boxes state a section editor holds (spec §6.2 F): what was typed by setting, the section
 * with it applied, and what each box shows before anything is typed. Extracted from `SectionEditor` so
 * the in-card editor shares it. Key the editor by its section: what was typed belongs to the section
 * it was typed in.
 */
export function useSectionDraft(
  opened: Readonly<Record<string, unknown>>,
  specOf: (path: readonly string[]) => FieldSpec | null
): {
  edits: ReadonlyMap<string, string>
  set: (path: readonly string[], raw: string) => void
  applied: Applied
  changedKeys: ReadonlySet<string>
  dropGone: () => void
  rawOf: (path: readonly string[], value: unknown, spec: FieldSpec) => string
} {
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(() => new Map())
  const applied = useMemo(() => applyEdits(opened, edits, specOf), [opened, edits, specOf])
  const changedKeys = useMemo(() => new Set(applied.changed.map(editKey)), [applied.changed])
  const set = useCallback((path: readonly string[], raw: string) => {
    setEdits((previous) => {
      const next = new Map(previous)
      next.set(editKey(path), raw)
      return next
    })
  }, [])
  const dropGone = useCallback(
    () => setEdits((previous) => new Map([...previous].filter(([key]) => !applied.gone.has(key)))),
    [applied.gone]
  )
  const rawOf = useCallback(
    (path: readonly string[], value: unknown, spec: FieldSpec) =>
      edits.get(editKey(path)) ??
      (spec.kind === 'yesno' ? String(value === true) : rawValue(value)),
    [edits]
  )
  return { edits, set, applied, changedKeys, dropGone, rawOf }
}
