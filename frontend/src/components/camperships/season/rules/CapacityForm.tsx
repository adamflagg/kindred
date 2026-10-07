import { useState } from 'react'

import { Permission } from '../../../../constants/permissions'
import {
  useAidSessionCapacities,
  useAidSetCapacity,
} from '../../../../hooks/camperships/useAidCapacity'
import { useAidSessionNames } from '../../../../hooks/camperships/useAidSessionNames'
import { useYear } from '../../../../hooks/useCurrentYear'
import { usePermissions } from '../../../../hooks/usePermissions'
import type { ApiAidCapacity } from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  FIELD,
  FIELD_INLINE,
  LABEL,
} from '../../../admin/lodging/lodgingStyles'
import { CS_CARD, CS_CARD_TITLE, CS_PILL, CS_SMALL } from '../../kit/csType'
import { readCapacity } from './capacityModel'

/**
 * Session capacity, entered by finance for Round 3's context (spec §6.3 item 4, §13 "where finance
 * enters session capacity"; Decision 23): one session at a time, with an optional note. It is
 * reference data, not part of the rules: nothing prices from it. Everyone who sees Season reads what
 * is stored (the registrar too: owner 10-06, open item 3); only `rules` gets the inputs. Choosing a session prefills its stored figure and note;
 * what the person types wins, and a save replaces what was stored.
 */
export function CapacityForm() {
  const year = useYear()
  const sessions = useAidSessionNames(year)
  const stored = useAidSessionCapacities(year)
  const save = useAidSetCapacity()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission(Permission.FINANCIAL_AID_RULES)
  const [session, setSession] = useState('')
  // null = untouched, so the field shows what is stored; a typed (even cleared) value is the person's.
  const [typed, setTyped] = useState<string | null>(null)
  const [typedNote, setTypedNote] = useState<string | null>(null)
  const [saved, setSaved] = useState<ApiAidCapacity | null>(null)
  const storedAll = stored.data?.sessions ?? []
  // The picker's order (by start date, from the names), then any stored row the names don't know.
  const storedRows =
    sessions === undefined
      ? []
      : [
          ...[...sessions.keys()].flatMap((id) => storedAll.filter((r) => r.session_cm_id === id)),
          ...storedAll.filter((r) => !sessions.has(r.session_cm_id)),
        ]
  const current = storedAll.find((row) => String(row.session_cm_id) === session)
  const raw = typed ?? (current ? String(current.capacity) : '')
  const note = typedNote ?? current?.note ?? ''
  const read = raw === '' ? null : readCapacity(raw)
  const nameOf = (id: number) => sessions?.get(id) ?? `Session ${String(id)}`

  return (
    <section id="card-capacity" className={`${CS_CARD} space-y-2`} data-testid="capacity-form">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className={CS_CARD_TITLE}>Session capacity, for Round 3</h3>
        <span className={CS_PILL.stone}>Not part of the rules</span>
      </div>
      <p className={CS_SMALL}>
        Reference only: a Round 3 request shows its session&apos;s capacity beside its enrollment.
        Nothing prices from it.
      </p>
      {storedRows.length > 0 && (
        <ul className="text-sm" data-testid="capacity-stored">
          {storedRows.map((row) => (
            <li key={row.session_cm_id}>
              {`${nameOf(row.session_cm_id)} · ${row.capacity.toLocaleString('en-US')} places`}
              {row.note !== '' ? ` · ${row.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      {sessions === undefined && (
        <p className="text-muted-foreground text-xs">
          Loading sessions… (if they never appear, the list couldn&apos;t be read: reload the page)
        </p>
      )}
      {stored.error !== null && stored.data === undefined && (
        <p className={AMBER_NOTE}>Couldn&apos;t load the stored capacities.</p>
      )}
      {stored.error !== null && stored.data !== undefined && (
        <p className={AMBER_NOTE}>Couldn&apos;t refresh this list: reload to see the latest.</p>
      )}
      {canEdit && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className={LABEL}>Session</span>
              <select
                className={FIELD_INLINE}
                value={session}
                onChange={(event) => {
                  const next = event.target.value
                  // Choosing a session fills its stored figure and note over what was typed for
                  // another. Typing done before the first pick survives it, unless the chosen
                  // session has a stored figure to show.
                  if (session !== '' || storedAll.some((r) => String(r.session_cm_id) === next)) {
                    setTyped(null)
                    setTypedNote(null)
                  }
                  setSession(next)
                  setSaved(null)
                  save.reset()
                }}
              >
                <option value="">Choose a session</option>
                {[...(sessions ?? new Map<number, string>())].map(([id, name]) => (
                  <option key={id} value={String(id)}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>Capacity (places)</span>
              <input
                className={`${FIELD_INLINE} w-24 text-right tabular-nums`}
                inputMode="numeric"
                value={raw}
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            <label className="block min-w-64 flex-1">
              <span className={LABEL}>Note (optional)</span>
              <input
                className={FIELD}
                maxLength={2000}
                value={note}
                onChange={(event) => setTypedNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={session === '' || read?.ok !== true || save.isPending}
              onClick={() => {
                if (read?.ok !== true) return
                setSaved(null)
                save.mutate(
                  {
                    sessionCmId: Number(session),
                    body: { capacity: read.value, note: note.trim() },
                  },
                  { onSuccess: (out) => setSaved(out) }
                )
              }}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
          {read?.ok === false && <p className={AMBER_NOTE}>{read.reason}</p>}
          {save.error !== null && <p className={AMBER_NOTE}>{save.error.message}</p>}
          {saved !== null && (
            <p className="text-sm" data-testid="capacity-saved">
              {`Saved: ${nameOf(saved.session_cm_id)} holds ${saved.capacity.toLocaleString('en-US')} places in ${String(saved.year)}`}
              {saved.note !== '' ? ` · ${saved.note}` : ''}
            </p>
          )}
        </>
      )}
    </section>
  )
}
