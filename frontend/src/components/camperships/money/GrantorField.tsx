import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import { useFreshAidSources } from '../../../hooks/camperships/useAidSources'
import { useAidMapSourceGrantor } from '../../../hooks/camperships/useAidSourceWrites'
import type { ApiAidSourceRow } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_INPUT, CS_LINK, CS_PMETA } from '../kit/csType'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { refusalWords } from './refusal'

const NO_GRANTOR = ''

/**
 * A description's grantor (spec §8.1; D160; `grantors`; P-13): a grantor in use, or none, with a
 * required note. Retired grantors aren't offered; a description still mapped to one shows it,
 * disabled and selected, and says why, so the picker never claims another grantor. Fresh read on
 * open and before sending (P-9). The caller draws it only for an outside or incentive description.
 */
export function GrantorField({
  row,
  view,
  onCancel,
  onDone,
}: {
  row: ApiAidSourceRow
  view: AidView
  onCancel: () => void
  onDone: (words: string) => void
}) {
  // Retired included: the description may still map to one, and its name must show.
  const grantors = useAidGrantors({ includeRetired: true })
  const fresh = useFreshAidSources()
  const map = useAidMapSourceGrantor()
  const [opened, setOpened] = useState<ApiAidSourceRow | null>(null)
  const [key, setKey] = useState(row.grantor_key)
  const [note, setNote] = useState('')
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
        setKey(latest.grantor_key)
      })
      .catch(() => {
        // A read failed: nothing was written, so it is said as a read (R3-13), never "can't tell".
        if (live) setProblem(OPEN_READ_FAILED)
      })
    return () => {
      live = false
    }
  }, [fresh, initial])

  const all = grantors.data?.grantors ?? []
  const inUse = all.filter((g) => g.retired_at === '')
  // The grantor the description holds now, when it is retired: shown, disabled, never offered.
  const retired =
    opened === null
      ? undefined
      : all.find((g) => g.key === opened.grantor_key && g.retired_at !== '')
  const ready =
    opened !== null &&
    note.trim() !== '' &&
    key !== opened.grantor_key &&
    key !== retired?.key &&
    !map.isPending

  const save = async () => {
    if (!ready) return
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
    const changed = movedFields(opened, latest, [['grantor_key', 'Grantor']])
    if (changed.length > 0) {
      // R3-1 (the shared re-base): the grantor the person picked stays; the rest is the latest.
      const base = { key: opened.grantor_key }
      const next = { key: latest.grantor_key }
      setKey((typed) => rebase(base, next, { key: typed }).key)
      setOpened(latest)
      setProblem(movedWords(changed))
      return
    }
    try {
      await map.mutateAsync({
        sourceId: initial.id,
        body: { grantor_key: key === NO_GRANTOR ? null : key, note: note.trim() },
      })
      const name = inUse.find((g) => g.key === key)?.name
      onDone(
        name === undefined
          ? `${initial.description}: no grantor now, with your note.`
          : `${initial.description}: mapped to ${name}, with your note.`
      )
    } catch (caught) {
      setProblem(refusalWords(caught))
    }
  }

  return (
    <div className="space-y-2 text-sm" data-testid="grantor-field">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          Grantor
          <select
            className={CS_INPUT}
            value={key}
            disabled={opened === null}
            onChange={(event) => setKey(event.target.value)}
          >
            <option value={NO_GRANTOR}>— no grantor —</option>
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
        <label className="flex min-w-[14rem] flex-1 items-center gap-2">
          Note
          <input
            type="text"
            className={`${CS_INPUT} w-full`}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      {key === retired?.key && (
        <p className={CS_AMBER_NOTE}>
          {`${retired.name} is retired: pick a grantor in use, or `}
          <Link
            className={CS_LINK}
            to={aidHref('/aid/grants/grantors', view, { grantor: retired.key })}
          >
            Unretire It in Grants › Grantors
          </Link>
        </p>
      )}
      <p className={CS_PMETA}>
        The grantor&apos;s terms (full coverage, canteen, pays after camp aid) are set in Grants ›
        Grantors.
      </p>
      {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={CS_BTN} disabled={!ready} onClick={() => void save()}>
          {map.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={CS_BTN2} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  )
}
