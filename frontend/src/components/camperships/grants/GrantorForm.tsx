import { useEffect, useRef, useState } from 'react'

import { useFreshAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import {
  useAidCreateGrantor,
  useAidSaveGrantor,
} from '../../../hooks/camperships/useAidGrantorWrites'
import type { ApiAidGrantor } from '../../../types/api-types'
import { AidPicker } from '../kit/AidPicker'
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
import { refusalWords } from '../money/refusal'
import {
  CANTEEN_CHOICES,
  CANTEEN_WORDS,
  draftOfGrantor,
  EMPTY_GRANTOR,
  GRANTOR_WATCHED,
  readCreate,
  readSave,
  suggestKey,
  type CoversCanteen,
  type GrantorDraft,
} from './grantorModel'

const CANTEEN_OPTIONS: Array<AidPickerOption<CoversCanteen>> = CANTEEN_CHOICES.map((c) => ({
  value: c,
  label: CANTEEN_WORDS[c],
}))

/**
 * A new grantor, or an edit of one (spec §8.2; D86, D143, D160; `grantors`: finance and development,
 * owner 10-06): name, aliases, the award terms (full coverage; then the canteen and "pays the rest after
 * camp aid", which the server records only for full coverage, so they show only then: P-20), eligibility,
 * contacts, and a note, logged. An edit opens on a fresh read and checks again just before it sends
 * (P-9): if a watched field moved, it sends nothing, keeps the typing and names what moved.
 */
export function GrantorForm({
  grantor,
  onCancel,
  onDone,
}: {
  /** The grantor being edited; none creates one. */
  grantor?: ApiAidGrantor | undefined
  onCancel: () => void
  onDone: (words: string) => void
}) {
  const fresh = useFreshAidGrantors()
  const create = useAidCreateGrantor()
  const save = useAidSaveGrantor()
  // Read once: a refetch of the directory never resets what is typed (lesson 5).
  const [initial] = useState(grantor)
  const [draft, setDraft] = useState<GrantorDraft>(() =>
    initial === undefined ? EMPTY_GRANTOR : draftOfGrantor(initial)
  )
  const [opened, setOpened] = useState<ApiAidGrantor | null>(initial ?? null)
  const [problem, setProblem] = useState<string | null>(null)
  const typed = useRef(false)
  const inFlight = useRef(false)
  const set = (patch: Partial<GrantorDraft>) => {
    typed.current = true
    setDraft((d) => ({ ...d, ...patch }))
  }
  const read = initial === undefined ? readCreate(draft) : readSave(draft)
  const busy = create.isPending || save.isPending

  // An edit opens on the latest (P-9); typing that started first is never overwritten, and the rest follows the latest.
  useEffect(() => {
    if (initial === undefined) return
    let live = true
    fresh()
      .then((data) => {
        const latest = data.grantors.find((g) => g.key === initial.key)
        if (!live || latest === undefined) return
        setOpened(latest)
        // Typing that started first stays; every field it left alone takes the latest (R3-1).
        setDraft((current) =>
          typed.current
            ? rebase(draftOfGrantor(initial), draftOfGrantor(latest), current)
            : draftOfGrantor(latest)
        )
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
    if (!read.ok || inFlight.current) return
    inFlight.current = true
    setProblem(null)
    try {
      if (initial === undefined) {
        const body = readCreate(draft)
        if (!body.ok) return
        await create.mutateAsync(body.body)
        onDone(`${body.body.name}: created, with your note.`)
        return
      }
      let latest: ApiAidGrantor | undefined
      try {
        latest = (await fresh()).grantors.find((g) => g.key === initial.key)
      } catch {
        // The re-check is a read: nothing was sent (R3-13).
        setProblem(RECHECK_FAILED)
        return
      }
      if (latest === undefined || opened === null) {
        setProblem('This funder is no longer in the directory.')
        return
      }
      const moved = movedFields(opened, latest, GRANTOR_WATCHED)
      if (moved.length > 0) {
        // R3-1: the PUT replaces the whole grantor; re-base so the fields this person didn't touch
        // take the other change, and only what they typed stays theirs.
        const base = draftOfGrantor(opened)
        const next = draftOfGrantor(latest)
        setDraft((typedDraft) => rebase(base, next, typedDraft))
        setOpened(latest)
        setProblem(movedWords(moved))
        return
      }
      const body = readSave(draft)
      if (!body.ok) return
      await save.mutateAsync({ key: initial.key, body: body.body })
      onDone(`${body.body.name}: saved, with your note.`)
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
    }
  }

  const full = draft.fullCoverage
  // What Save waits for, beside the buttons (mock): a name and a note first; the key rule only on a new one.
  const missing =
    draft.name.trim() === '' || draft.note.trim() === ''
      ? 'A name and a note are required.'
      : read.ok
        ? undefined
        : read.problem
  return (
    <div data-aid-editor="" data-testid="grantor-form">
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
        {/* §24, rev1 (money-funders.html): wide and short, 230px to 175px. Name, aliases, eligibility,
            contacts and the note in a two-column grid left; Full coverage and the two choices that
            depend on it right, switched off rather than hidden while it is off, so the editor never
            changes height. The buttons share one row with the required line. */}
        <EditorForm
          title={initial === undefined ? 'New funder' : `Editing · ${initial.name}`}
          side={
            <EditorGrid columns={2}>
              <span className="col-span-2">
                <label
                  className="flex items-center gap-1.5"
                  title="The funder pays the whole cost of the session"
                >
                  <input
                    type="checkbox"
                    checked={full}
                    onChange={(event) => set({ fullCoverage: event.target.checked })}
                  />
                  Full coverage
                </label>
              </span>
              <EditorField label="Covers the canteen deposit" off={!full}>
                <AidPicker
                  label="Covers the canteen deposit"
                  size="field"
                  disabled={!full}
                  value={draft.coversCanteen}
                  options={CANTEEN_OPTIONS}
                  onChange={(coversCanteen) => set({ coversCanteen })}
                  className="w-32"
                />
              </EditorField>
              <span className="col-span-2">
                <label
                  className={`flex items-center gap-1.5 ${full ? '' : 'opacity-50'}`}
                  title={
                    full
                      ? 'A named fund that pays what is left after camp aid'
                      : 'Only a full-coverage funder pays after camp aid'
                  }
                >
                  <input
                    type="checkbox"
                    disabled={!full}
                    checked={full && draft.paysAfter}
                    onChange={(event) => set({ paysAfter: event.target.checked })}
                  />
                  Pays the rest after camp aid
                </label>
              </span>
            </EditorGrid>
          }
          actions={
            <EditorActions>
              <button type="submit" className={CS_BTN} disabled={!read.ok || busy}>
                {busy ? 'Saving…' : initial === undefined ? 'Save Funder' : 'Save'}
              </button>
              <button type="button" className={CS_BTN2} onClick={onCancel} disabled={busy}>
                Back
              </button>
              {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
              {/* The mock's order: what is missing, then what saving does. */}
              {/* Hidden once satisfied but never removed (the mock's visibility): the row does not move. */}
              <span
                className={`${CS_PMETA} flex-none text-[12.5px]`}
                style={{ visibility: missing === undefined ? 'hidden' : 'visible' }}
              >
                {missing ?? 'A name and a note are required.'}
              </span>
              <span className={`${CS_PMETA} truncate`}>
                {initial === undefined
                  ? 'Logged with who and why. Descriptions map to a funder on their own row.'
                  : 'A rename shows everywhere; history keeps who and why. Descriptions map to a funder on their own row.'}
              </span>
            </EditorActions>
          }
        >
          <EditorGrid columns={4}>
            <EditorField label="Name">
              <input
                type="text"
                aria-label="Name"
                className={`${CS_FIELD} w-full`}
                maxLength={200}
                value={draft.name}
                onChange={(event) =>
                  set({
                    name: event.target.value,
                    ...(initial === undefined ? { key: suggestKey(event.target.value) } : {}),
                  })
                }
              />
            </EditorField>
            <EditorField label="Also known as">
              <input
                type="text"
                aria-label="Also known as"
                className={`${CS_FIELD} w-full`}
                placeholder="comma-separated"
                value={draft.aliases}
                onChange={(event) => set({ aliases: event.target.value })}
              />
            </EditorField>
            <EditorField label="Eligibility">
              <input
                type="text"
                aria-label="Eligibility"
                className={`${CS_FIELD} w-full`}
                maxLength={2000}
                placeholder="e.g. first-time campers"
                value={draft.eligibility}
                onChange={(event) => set({ eligibility: event.target.value })}
              />
            </EditorField>
            <EditorField label="Contacts">
              <input
                type="text"
                aria-label="Contacts"
                className={`${CS_FIELD} w-full`}
                maxLength={2000}
                placeholder="name, email, phone; …"
                value={draft.contacts}
                onChange={(event) => set({ contacts: event.target.value })}
              />
            </EditorField>
            <span className={CS_FGRID_LABEL}>Note</span>
            <div className="col-span-3 min-w-0">
              <input
                type="text"
                aria-label="Note"
                className={`${CS_FIELD} w-full`}
                maxLength={2000}
                placeholder="required, logged with your name"
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            </div>
          </EditorGrid>
        </EditorForm>
      </form>
    </div>
  )
}
