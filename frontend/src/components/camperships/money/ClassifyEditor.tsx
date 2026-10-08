import { useEffect, useRef, useState } from 'react'

import { useFreshAidSources } from '../../../hooks/camperships/useAidSources'
import { useAidClassifySource } from '../../../hooks/camperships/useAidSourceWrites'
import type { ApiAidSourceRow } from '../../../types/api-types'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_INPUT, CS_PMETA } from '../kit/csType'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { programLabel } from '../requests/programLabel'
import { refusalWords } from './refusal'
import {
  draftFrom,
  dropsGrantor,
  DROPS_GRANTOR_WARNING,
  familyOptions,
  funderWords,
  keyWords,
  OFFERED_FUNDERS,
  PROGRAM_FAMILIES,
  programsChanged,
  readDraft,
  SOURCE_WATCHED,
  type ClassifyDraft,
} from './sourcesModel'

/**
 * Classify a description, or edit its classification (spec §8.1; D58, D105; `rules`; P-12): its
 * name, family, funder, whether it counts as aid and toward the budget, the programs it funds, and a
 * required note, logged with who and why. It opens on a fresh read and checks again just before it
 * sends (P-9): if the row moved, nothing is sent, the typing stays, what moved is named, and a second
 * Save puts the edit in place. Moving the programs moves the reporting group: the server's D159
 * sentence (`groupWarning`, from Funding sources) shows then.
 */
export function ClassifyEditor({
  row,
  rows,
  names,
  groupWarning,
  onCancel,
  onDone,
}: {
  row: ApiAidSourceRow
  rows: readonly ApiAidSourceRow[]
  names: Readonly<Record<string, string>>
  groupWarning: string
  onCancel: () => void
  onDone: (words: string) => void
}) {
  const fresh = useFreshAidSources()
  const classify = useAidClassifySource()
  const [opened, setOpened] = useState<ApiAidSourceRow | null>(null)
  const [draft, setDraft] = useState<ClassifyDraft>(() => draftFrom(row))
  const [problem, setProblem] = useState<string | null>(null)

  // Read once, as the editor opens: a later refetch of the table never resets the typing.
  const [initial] = useState(row)
  useEffect(() => {
    let live = true
    fresh()
      .then((data) => {
        if (!live) return
        const latest = data.sources.find((s) => s.id === initial.id) ?? initial
        setOpened(latest)
        setDraft(draftFrom(latest))
      })
      .catch(() => {
        // A read failed: nothing was written, so it is said as a read (R3-13), never "can't tell".
        if (live) setProblem(OPEN_READ_FAILED)
      })
    return () => {
      live = false
    }
  }, [fresh, initial])

  const read = readDraft(draft)
  // The draft as it stands now: typing during the pre-send re-check is what gets sent.
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const families = [...new Set([...familyOptions(rows), ...(draft.family ? [draft.family] : [])])]
  const funders: string[] = [
    ...new Set([...OFFERED_FUNDERS, ...(draft.funder ? [draft.funder] : [])]),
  ]
  const set = (patch: Partial<ClassifyDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const save = async () => {
    if (!read.ok || opened === null || classify.isPending) return
    setProblem(null)
    let latest: ApiAidSourceRow | undefined
    try {
      latest = (await fresh()).sources.find((s) => s.id === initial.id)
    } catch {
      setProblem(RECHECK_FAILED)
      return
    }
    if (latest === undefined) {
      setProblem('This description is no longer in the registry.')
      return
    }
    const changed = movedFields(opened, latest, SOURCE_WATCHED)
    if (changed.length > 0) {
      // R3-1: re-base. The PATCH is the whole classification, so the draft takes every field from
      // the latest except the ones this person changed; a second Save can't undo the other change.
      const base = draftFrom(opened)
      const next = draftFrom(latest)
      setDraft((typed) => rebase(base, next, typed))
      setOpened(latest)
      setProblem(movedWords(changed))
      return
    }
    const now = readDraft(draftRef.current)
    if (!now.ok) return
    try {
      await classify.mutateAsync({ sourceId: initial.id, body: now.body })
      onDone(`${initial.description}: classification saved, with your note.`)
    } catch (caught) {
      setProblem(refusalWords(caught))
    }
  }

  if (opened === null) {
    return <p className={CS_PMETA}>{problem ?? 'Loading the latest for this description…'}</p>
  }
  return (
    <div className="space-y-2 text-sm" data-testid="classify-editor">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Name
          <input
            type="text"
            className={CS_INPUT}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-2">
          Family
          <select
            className={CS_INPUT}
            value={draft.family}
            onChange={(event) => set({ family: event.target.value })}
          >
            <option value="">— pick —</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {keyWords(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Funder
          <select
            className={CS_INPUT}
            value={draft.funder}
            onChange={(event) => set({ funder: event.target.value })}
          >
            <option value="">— pick —</option>
            {funders.map((f) => (
              <option key={f} value={f}>
                {funderWords(f) || f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.countsAsAid}
            onChange={(event) => set({ countsAsAid: event.target.checked })}
          />
          Counts as aid
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.countsTowardBudget}
            onChange={(event) => set({ countsTowardBudget: event.target.checked })}
          />
          Counts toward the budget
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className={`${CS_PMETA} mb-1`}>Programs it funds (its reporting group)</legend>
        {PROGRAM_FAMILIES.map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.programs.includes(p)}
              onChange={(event) =>
                set({
                  programs: event.target.checked
                    ? [...draft.programs, p]
                    : draft.programs.filter((x) => x !== p),
                })
              }
            />
            {programLabel(names, p)}
          </label>
        ))}
      </fieldset>
      {programsChanged(opened, draft) && groupWarning !== '' && (
        <p className={CS_AMBER_NOTE}>{groupWarning}</p>
      )}
      {dropsGrantor(opened, draft) && <p className={CS_AMBER_NOTE}>{DROPS_GRANTOR_WARNING}</p>}
      <label className="flex items-center gap-2">
        Note
        <input
          type="text"
          className={`${CS_INPUT} w-full`}
          maxLength={2000}
          value={draft.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </label>
      <p className={CS_PMETA}>
        Every change is logged with who and why. It changes what counts as aid and toward the budget
        from now; the ledger re-reads it on the next sync.
      </p>
      {!read.ok && <p className={CS_AMBER_NOTE}>{read.problem}</p>}
      {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={CS_BTN}
          disabled={!read.ok || classify.isPending}
          onClick={() => void save()}
        >
          {classify.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={CS_BTN2} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  )
}
