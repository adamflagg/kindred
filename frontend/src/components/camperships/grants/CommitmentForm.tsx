import { useEffect, useMemo, useRef, useState } from 'react'

import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import {
  useAidCreateCommitment,
  useAidSaveCommitment,
} from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidGrantRow } from '../../../types/api-types'
import { AidPicker } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_DATE_FIELD, CS_FIELD } from '../kit/csType'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { Effects } from '../kit/Effects'
import type { AidPickerOption } from '../kit/pickerWords'
import { campToday } from '../kit/dates'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { refusalWords } from '../money/refusal'
import {
  camperChoices,
  choiceOf,
  COMMITMENT_WATCHED,
  draftOf,
  emptyDraft,
  readCommitment,
  type CommitmentDraft,
  type CommitmentHousehold,
} from './commitmentModel'

/**
 * Record a commitment, or edit an open one (spec §8.2; D55, D116; P-9, P-16; casework): a grant
 * committed but not yet posted in CampMinder. It counts for the calculator from now and leaves
 * "committed" when its CampMinder line arrives. Grantors in use only (D160); the camper is one of this
 * season's requests, or the household page's (`household`). An edit opens on a fresh read of the
 * stored fields (`offsets=false`), keeps the stored note and date unless changed (review item 21),
 * and reads again just before it sends: if a watched field moved it sends nothing and says what.
 */
export function CommitmentForm({
  year,
  row,
  household,
  onCancel,
  onDone,
}: {
  year: number
  /** The open commitment being edited; none records a new one. */
  row?: ApiAidGrantRow | undefined
  /** The household page's requests: the campers it offers, the one camper pre-picked. */
  household?: CommitmentHousehold | undefined
  onCancel: () => void
  onDone: (words: string) => void
}) {
  // Retired included: an edit may hold a grantor retired since, and must show it.
  const grantors = useAidGrantors({ includeRetired: true })
  const grid = useAidGrid({ live: true, enabled: household === undefined })
  const fresh = useFreshAidGrants()
  const create = useAidCreateCommitment()
  const save = useAidSaveCommitment()
  // Read once: a later refetch of the Register or the household page never resets the typing.
  const [initial] = useState(row)
  const choices = useMemo(() => {
    const all = camperChoices(household?.rows ?? grid.data?.rows ?? [])
    if (initial === undefined) return all
    const own = choiceOf(initial)
    return all.some((c) => c.key === own.key) ? all : [own, ...all]
  }, [household, grid.data, initial])
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    initial === undefined
      ? emptyDraft(campToday(), camperChoices(household?.rows ?? []))
      : draftOf(initial)
  )
  // An edit's record as it stood when the form opened (fresh), then as last re-read.
  const [opened, setOpened] = useState<ApiAidGrantRow | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const set = (patch: Partial<CommitmentDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const allGrantors = grantors.data?.grantors ?? []
  const inUse = allGrantors.filter((g) => g.retired_at === '')
  // The draft's grantor when retired (an edit of an older commitment): shown, disabled, never sent,
  // since the route refuses a retired key.
  const retired = allGrantors.find((g) => g.key === draft.grantorKey && g.retired_at !== '')
  const waiting = initial !== undefined && opened === null

  useEffect(() => {
    if (initial === undefined) return
    let live = true
    fresh()
      .then((data) => {
        if (!live) return
        const latest = data.grants.find((g) => g.commitment_id === initial.commitment_id)
        if (latest === undefined) {
          setProblem('This commitment is no longer open: it was withdrawn or its line arrived.')
          return
        }
        setOpened(latest)
        setDraft(draftOf(latest))
      })
      .catch(() => {
        // A read failed: nothing was written, so it is said as a read (R3-13), never "can't tell".
        if (live) setProblem(OPEN_READ_FAILED)
      })
    return () => {
      live = false
    }
  }, [fresh, initial])

  const submit = async () => {
    if (inFlight.current || waiting) return
    const read = readCommitment(draft, choices)
    if (!read.ok) {
      setProblem(read.problem)
      return
    }
    if (retired !== undefined) {
      setProblem(
        `${retired.name} is retired: pick a grantor in use, or Unretire It in Money › Funders.`
      )
      return
    }
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    try {
      if (initial === undefined) {
        await create.mutateAsync({ year, body: read.body })
        onDone('Commitment recorded · counts for the calculator from now')
        return
      }
      let latest: ApiAidGrantRow | undefined
      try {
        latest = (await fresh()).grants.find((g) => g.commitment_id === initial.commitment_id)
      } catch {
        // The re-check is a read: nothing was sent (R3-13).
        setProblem(RECHECK_FAILED)
        return
      }
      if (latest === undefined || opened === null) {
        setProblem('This commitment is no longer open: it was withdrawn or its line arrived.')
        return
      }
      const moved = movedFields(opened, latest, COMMITMENT_WATCHED)
      if (moved.length > 0) {
        // R3-1: the PUT is the whole commitment; re-base so a field this person didn't touch takes
        // the other person's change, and only what they changed stays theirs.
        const base = draftOf(opened)
        const next = draftOf(latest)
        setDraft((typed) => rebase(base, next, typed))
        setOpened(latest)
        setProblem(movedWords(moved))
        return
      }
      await save.mutateAsync({ year, commitmentId: initial.commitment_id, body: read.body })
      onDone('Commitment saved')
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const grantorOptions: Array<AidPickerOption<string>> = [
    { value: '', label: '— pick —' },
    ...(retired === undefined
      ? []
      : [{ value: retired.key, label: `${retired.name} (retired)`, disabled: true }]),
    ...inUse.map((g) => ({ value: g.key, label: g.name })),
  ]
  const camperOptions: Array<AidPickerOption<string>> = [
    {
      value: '',
      label: grid.isLoading && household === undefined ? 'Loading the campers…' : '— pick —',
    },
    ...choices.map((c) => ({ value: c.key, label: c.label })),
  ]

  return (
    <div data-aid-editor="" data-testid="commitment-form">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !inFlight.current) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        {/* §24 (money-grants.html .cf-ed): wide and short. The five fields in a label · field grid, what
            Save does in the right column, Save and Cancel on one row. */}
        <EditorForm
          title={initial === undefined ? 'Record a commitment' : 'Edit the commitment'}
          heading="phead"
          side={
            <Effects
              items={[
                {
                  sym: 'ok',
                  text: (
                    <>
                      <b>Save</b> → counts for the calculator from now
                    </>
                  ),
                },
                { sym: 'ok', text: 'An unposted round re-prices' },
                {
                  sym: 'hand',
                  text: 'A posted amount stands',
                  then: '→ It leaves "committed" when its CampMinder line arrives',
                },
              ]}
            />
          }
          actions={
            <EditorActions>
              <button type="submit" className={CS_BTN} disabled={busy || waiting}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className={CS_BTN2} disabled={busy} onClick={onCancel}>
                Cancel
              </button>
              {waiting && problem === null && (
                <span className={CS_AMBER_NOTE}>Reading the latest…</span>
              )}
              {retired !== undefined && problem === null && (
                <span className={CS_AMBER_NOTE}>
                  {`${retired.name} is retired: pick a grantor in use, or Unretire It in Money › Funders.`}
                </span>
              )}
              {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
            </EditorActions>
          }
        >
          <div className="space-y-1.5">
            <EditorGrid columns={4}>
              <EditorField label="Grantor">
                <AidPicker
                  label="Grantor"
                  size="field"
                  disabled={waiting}
                  value={draft.grantorKey}
                  options={grantorOptions}
                  onChange={(grantorKey) => set({ grantorKey })}
                  className="w-full max-w-60 [&>button]:w-full"
                />
              </EditorField>
              <EditorField label="Camper">
                <AidPicker
                  label="Camper"
                  size="field"
                  disabled={waiting}
                  value={draft.camperKey}
                  options={camperOptions}
                  onChange={(camperKey) => set({ camperKey })}
                  className="w-full max-w-72 [&>button]:w-full"
                />
              </EditorField>
              <EditorField label="Amount">
                <input
                  aria-label="Amount"
                  type="text"
                  inputMode="decimal"
                  className={`${CS_FIELD} w-28 text-right tabular-nums`}
                  disabled={waiting}
                  value={draft.amount}
                  onChange={(event) => set({ amount: event.target.value })}
                />
              </EditorField>
              <EditorField label="Committed on">
                <input
                  aria-label="Committed on"
                  type="date"
                  className={CS_DATE_FIELD}
                  disabled={waiting}
                  value={draft.committedOn}
                  onChange={(event) => set({ committedOn: event.target.value })}
                />
              </EditorField>
            </EditorGrid>
            <EditorGrid columns={2}>
              <EditorField label="Note (optional)">
                <input
                  aria-label="Note"
                  type="text"
                  maxLength={2000}
                  className={`${CS_FIELD} w-full`}
                  placeholder="e.g. letter from the grantor, Apr 2"
                  disabled={waiting}
                  value={draft.note}
                  onChange={(event) => set({ note: event.target.value })}
                />
              </EditorField>
            </EditorGrid>
          </div>
        </EditorForm>
      </form>
    </div>
  )
}
