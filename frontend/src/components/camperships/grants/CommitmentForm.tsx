import { useEffect, useMemo, useRef, useState } from 'react'

import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { useFreshAidGrants } from '../../../hooks/camperships/useAidGrants'
import {
  useAidCreateCommitment,
  useAidSaveCommitment,
} from '../../../hooks/camperships/useAidGrantWrites'
import type { ApiAidGrantRow } from '../../../types/api-types'
import { EditorBox, EditorColumns, FormActions } from '../household/ReasonForm'
import {
  HH_AMBER_NOTE,
  HH_EDITOR_LABEL,
  HH_EDITOR_MONEY,
  HH_EDITOR_PAIR,
  HH_EDITOR_TEXT,
} from '../household/householdStyles'
import { CS_SELECT } from '../kit/csType'
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
        `${retired.name} is retired: pick a grantor in use, or Unretire It in Grants › Grantors.`
      )
      return
    }
    inFlight.current = true
    setBusy(true)
    setProblem(null)
    try {
      if (initial === undefined) {
        await create.mutateAsync({ year, body: read.body })
        onDone('Commitment recorded. It counts for the calculator from now.')
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
      onDone('Commitment saved.')
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div data-aid-editor="" data-testid="commitment-form">
      <EditorBox head={initial === undefined ? 'Record a commitment' : 'Edit the commitment'}>
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
          <EditorColumns
            side={
              <p>
                A grant committed but not yet posted in CampMinder. It counts for the calculator
                from now: an unposted round re-prices, and a posted amount stands. It leaves
                &quot;committed&quot; when its CampMinder line arrives.
              </p>
            }
          >
            <div className={HH_EDITOR_PAIR}>
              <label className={HH_EDITOR_LABEL}>
                Grantor
                <select
                  aria-label="Grantor"
                  className={CS_SELECT}
                  disabled={waiting}
                  value={draft.grantorKey}
                  onChange={(event) => set({ grantorKey: event.target.value })}
                >
                  <option value="">— pick —</option>
                  {retired !== undefined && (
                    <option value={retired.key} disabled>
                      {`${retired.name} (retired)`}
                    </option>
                  )}
                  {inUse.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={HH_EDITOR_LABEL}>
                Camper
                <select
                  aria-label="Camper"
                  className={CS_SELECT}
                  disabled={waiting}
                  value={draft.camperKey}
                  onChange={(event) => set({ camperKey: event.target.value })}
                >
                  <option value="">{grid.isLoading ? 'Loading the campers…' : '— pick —'}</option>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={HH_EDITOR_PAIR}>
              <label className={HH_EDITOR_LABEL}>
                Amount
                <input
                  aria-label="Amount"
                  type="text"
                  inputMode="decimal"
                  className={HH_EDITOR_MONEY}
                  disabled={waiting}
                  value={draft.amount}
                  onChange={(event) => set({ amount: event.target.value })}
                />
              </label>
              <label className={HH_EDITOR_LABEL}>
                Committed on
                <input
                  aria-label="Committed on"
                  type="date"
                  className={HH_EDITOR_TEXT}
                  disabled={waiting}
                  value={draft.committedOn}
                  onChange={(event) => set({ committedOn: event.target.value })}
                />
              </label>
            </div>
            <label className={HH_EDITOR_LABEL}>
              Note (optional)
              <input
                aria-label="Note"
                type="text"
                maxLength={2000}
                className={HH_EDITOR_TEXT}
                placeholder="e.g. letter from the grantor, Apr 2"
                disabled={waiting}
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            </label>
          </EditorColumns>
          <FormActions submitLabel={busy ? 'Saving…' : 'Save'} busy={busy} onCancel={onCancel}>
            {waiting && problem === null && (
              <span className={HH_AMBER_NOTE}>Reading the latest…</span>
            )}
            {retired !== undefined && problem === null && (
              <span className={HH_AMBER_NOTE}>
                {`${retired.name} is retired: pick a grantor in use, or Unretire It in Grants › Grantors.`}
              </span>
            )}
            {problem !== null && <span className={HH_AMBER_NOTE}>{problem}</span>}
          </FormActions>
        </form>
      </EditorBox>
    </div>
  )
}
