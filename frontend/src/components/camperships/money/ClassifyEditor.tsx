import { useEffect, useRef, useState } from 'react'

import { useFreshAidSources } from '../../../hooks/camperships/useAidSources'
import { useAidClassifySource } from '../../../hooks/camperships/useAidSourceWrites'
import type { ApiAidDevelopmentGroup, ApiAidSourceRow } from '../../../types/api-types'
import { AidPicker, AidPickerMulti } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FGRID_LABEL, CS_FIELD, CS_PMETA } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import type { AidPickerOption } from '../kit/pickerWords'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { refusalWords } from './refusal'
import {
  classifyPrograms,
  coversWords,
  draftFrom,
  dropsGrantor,
  DROPS_GRANTOR_WARNING,
  familyOptions,
  funderWords,
  familyWordsOf,
  isUnclassified,
  OFFERED_FUNDERS,
  poolsOfFamilies,
  poolsOfGroups,
  programsChanged,
  readDraft,
  SOURCE_WATCHED,
  type ClassifyDraft,
} from './sourcesModel'

/**
 * Classify a description, or edit its classification (spec §8.1; D58, D105; `rules`; P-12): its
 * name, family, funder, whether it counts as aid and toward the budget, the reporting groups it funds
 * (final UX star 19: the season's pools, several at once, with a "Covers:" line; the stored program
 * families are the union of the picked pools'), and a required note, logged with who and why. It opens on a fresh read and checks again just before it
 * sends (P-9): if the row moved, nothing is sent, the typing stays, what moved is named, and a second
 * Save puts the edit in place. Moving the programs moves the reporting group: the server's D159
 * sentence (`groupWarning`, from Funding sources) shows then.
 */
export function ClassifyEditor({
  row,
  rows,
  names,
  groups,
  groupWarning,
  onCancel,
  onDone,
}: {
  row: ApiAidSourceRow
  rows: readonly ApiAidSourceRow[]
  names: Readonly<Record<string, string>>
  /** The season's pools with the families each funds (Funding sources' `groups`). */
  groups: readonly ApiAidDevelopmentGroup[]
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
  const pools = poolsOfGroups(groups)
  const picked = poolsOfFamilies(draft.programs, pools)
  const familyChoices: Array<AidPickerOption<string>> = [
    { value: '', label: '— pick —' },
    ...families.map((f) => ({
      value: f,
      label: familyWordsOf(rows.find((r) => r.source_family === f) ?? { source_family: f }),
    })),
  ]
  const funderChoices: Array<AidPickerOption<string>> = [
    { value: '', label: '— pick —' },
    ...funders.map((f) => ({ value: f, label: funderWords(f) || f })),
  ]
  const poolChoices = pools.map((p) => ({ value: p.key, label: p.label }))
  const unclassified = isUnclassified(row)
  return (
    <div data-testid="classify-editor">
      <EditorForm
        title={unclassified ? 'Classify this description' : 'Edit this description'}
        actions={
          <EditorActions reason={read.ok ? undefined : read.problem}>
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
            {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
          </EditorActions>
        }
      >
        <div className="space-y-1.5">
          <EditorGrid columns={4}>
            <EditorField label="Name">
              <input
                type="text"
                aria-label="Name"
                className={`${CS_FIELD} w-full`}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            </EditorField>
            <EditorField label="Family">
              <AidPicker
                label="Family"
                size="field"
                value={draft.family}
                options={familyChoices}
                onChange={(family) => set({ family })}
                className="w-full [&>button]:w-full"
              />
            </EditorField>
            <EditorField label="Funder type">
              <AidPicker
                label="Funder type"
                size="field"
                value={draft.funder}
                options={funderChoices}
                onChange={(funder) => set({ funder })}
                className="w-full [&>button]:w-full"
              />
            </EditorField>
            <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1">
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
            </span>
          </EditorGrid>
          {dropsGrantor(opened, draft) && <p className={CS_AMBER_NOTE}>{DROPS_GRANTOR_WARNING}</p>}
          {/* Star 19: the season's reporting groups, as Set a Group… offers them, several at once. */}
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={CS_FGRID_LABEL}>Funds (its reporting group)</span>
              <AidPickerMulti
                label="Reporting groups"
                size="field"
                values={picked}
                options={poolChoices}
                noun="groups"
                none="— no group —"
                disabled={pools.length === 0}
                onChange={(next) =>
                  set({ programs: classifyPrograms(next, pools, opened.implied_program_families) })
                }
                className="w-52 [&>button]:w-full"
              />
            </div>
            <p className={CS_PMETA}>{coversWords(picked, pools, names)}</p>
          </div>
          {programsChanged(opened, draft) && groupWarning !== '' && (
            <p className={CS_AMBER_NOTE}>{groupWarning}</p>
          )}
          <EditorGrid columns={2}>
            <EditorField label="Note">
              <input
                type="text"
                aria-label="Note"
                className={`${CS_FIELD} w-full`}
                maxLength={2000}
                placeholder="required, logged with your name"
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            </EditorField>
          </EditorGrid>
          <p className={CS_PMETA}>
            Every change is logged with who and why. It changes what counts as aid and toward the
            budget from now; the ledger re-reads it on the next sync.
          </p>
        </div>
      </EditorForm>
    </div>
  )
}
