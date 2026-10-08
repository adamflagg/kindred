import { useEffect, useRef, useState } from 'react'

import { useFreshAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import {
  useAidCreateGrantor,
  useAidSaveGrantor,
} from '../../../hooks/camperships/useAidGrantorWrites'
import type { ApiAidGrantor } from '../../../types/api-types'
import { EditorBox } from '../household/ReasonForm'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_INPUT, CS_PMETA } from '../kit/csType'
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

const ROW = 'flex flex-wrap items-center gap-3'
const FIELD = 'flex items-center gap-2'
const WIDE = 'flex min-w-[14rem] flex-1 items-center gap-2'

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
  const [keyTouched, setKeyTouched] = useState(false)
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
        setProblem('This grantor is no longer in the directory.')
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

  return (
    <div data-aid-editor="" data-testid="grantor-form">
      <EditorBox head={initial === undefined ? 'New grantor' : `Editing · ${initial.name}`}>
        <form
          className="space-y-2 text-sm"
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
          <div className={ROW}>
            <label className={FIELD}>
              Name
              <input
                type="text"
                className={CS_INPUT}
                maxLength={200}
                value={draft.name}
                onChange={(event) =>
                  set({
                    name: event.target.value,
                    ...(initial === undefined && !keyTouched
                      ? { key: suggestKey(event.target.value) }
                      : {}),
                  })
                }
              />
            </label>
            {initial === undefined && (
              <label className={FIELD}>
                Key
                <input
                  type="text"
                  className={`${CS_INPUT} font-mono`}
                  maxLength={60}
                  value={draft.key}
                  onChange={(event) => {
                    setKeyTouched(true)
                    set({ key: event.target.value })
                  }}
                />
              </label>
            )}
            <label className={FIELD}>
              Also known as
              <input
                type="text"
                className={CS_INPUT}
                placeholder="comma-separated"
                value={draft.aliases}
                onChange={(event) => set({ aliases: event.target.value })}
              />
            </label>
          </div>
          <div className={ROW}>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.fullCoverage}
                onChange={(event) => set({ fullCoverage: event.target.checked })}
              />
              Full coverage
            </label>
            {draft.fullCoverage && (
              <>
                <label className={FIELD}>
                  Covers the canteen deposit
                  <select
                    className={CS_INPUT}
                    value={draft.coversCanteen}
                    onChange={(event) =>
                      set({ coversCanteen: event.target.value as CoversCanteen })
                    }
                  >
                    {CANTEEN_CHOICES.map((c) => (
                      <option key={c} value={c}>
                        {CANTEEN_WORDS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.paysAfter}
                    onChange={(event) => set({ paysAfter: event.target.checked })}
                  />
                  Pays the rest after camp aid
                </label>
              </>
            )}
          </div>
          <div className={ROW}>
            <label className={WIDE}>
              Eligibility
              <input
                type="text"
                className={`${CS_INPUT} w-full`}
                maxLength={2000}
                value={draft.eligibility}
                onChange={(event) => set({ eligibility: event.target.value })}
              />
            </label>
            <label className={WIDE}>
              Contacts
              <input
                type="text"
                className={`${CS_INPUT} w-full`}
                maxLength={2000}
                placeholder="name, email, phone"
                value={draft.contacts}
                onChange={(event) => set({ contacts: event.target.value })}
              />
            </label>
          </div>
          <label className={FIELD}>
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
            A rename changes the name everywhere it shows; history keeps who and why. Descriptions
            are mapped to a grantor on their source row.
          </p>
          {!read.ok && <p className={CS_AMBER_NOTE}>{read.problem}</p>}
          {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
          <div className="flex gap-2">
            <button type="submit" className={CS_BTN} disabled={!read.ok || busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={CS_BTN2} onClick={onCancel} disabled={busy}>
              Back
            </button>
          </div>
        </form>
      </EditorBox>
    </div>
  )
}
