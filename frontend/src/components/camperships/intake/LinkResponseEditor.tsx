import { useId, useMemo, useRef, useState } from 'react'

import { AidTable, type AidColumn } from '../kit/AidTable'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FIELD, CS_PHEAD, CS_POPEN_META } from '../kit/csType'
import { formatCampDateTime } from '../kit/dates'
import { EditorActions, EditorForm } from '../kit/EditorLayout'
import { Effects } from '../kit/Effects'
import { CS_OK_INK } from '../kit/kitStyles'
import { linkEffects, registrationYear, typedLine } from './adultFormModel'
import type {
  FormResponseView,
  LinkCandidatesView,
  LinkCandidateView,
  MatchSignal,
} from './adultFormTypes'
import { tinyName, type SessionIndex } from './intakeModel'

const KEYS = 'Enter saves · Esc cancels'
const MUTED = 'text-muted-foreground'

function Clue({ hit, children }: { hit: boolean; children: string }) {
  return (
    <span>
      <span className={hit ? `${CS_OK_INK} font-semibold` : MUTED}>{hit ? '✓' : '✗'}</span>{' '}
      {children}
    </span>
  )
}
const hit = (c: LinkCandidateView, s: MatchSignal) => c.signals.includes(s)

function heading(r: FormResponseView, n: number): string {
  const where = r.match_status === 'registered_elsewhere' ? 'another weekend' : 'the weekend chosen'
  const who =
    r.match_status === 'ignored' ? 'Who it matches' : n === 1 ? 'The suggestion' : 'The suggestions'
  return `${who}, registered for ${where}`
}

/**
 * Link… (adult aid form design §5; mock v2 steps 7–10, 19; K3 a, owner 10-29): GF-1 sent this response to staff
 * because the dashboard found someone but was not sure, so the people come first, each with their evidence, then a
 * search for someone else (a typo, someone not yet registered). The typed line is the one place the respondent
 * email shows. On an ignored response, linking undoes the ignore. The kit's white EditorForm in the opened row.
 */
export function LinkResponseEditor({
  response,
  link,
  names,
  onLink,
  onCancel,
  search,
}: {
  response: FormResponseView
  /** Link…'s own read: the typed answers and the candidates with their birthdate and email. */
  link: LinkCandidatesView
  names: SessionIndex
  onLink: (personCmId: number) => Promise<unknown>
  onCancel: () => void
  /** Someone else: a name, birthdate or CampMinder id among this season's registrations. */
  search: (query: string) => Promise<readonly LinkCandidateView[]>
}) {
  const [found, setFound] = useState<readonly LinkCandidateView[]>([])
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<number | null>(link.candidates[0]?.person_cm_id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const searchId = useId()
  const year = registrationYear(response)

  const people = useMemo(() => {
    const seen = new Set(link.candidates.map((c) => c.person_cm_id))
    return [...link.candidates, ...found.filter((c) => !seen.has(c.person_cm_id))]
  }, [link.candidates, found])
  const picked = people.find((c) => c.person_cm_id === pick) ?? null

  const save = async () => {
    if (inFlight.current || picked === null) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      await onLink(picked.person_cm_id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't link the response")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  const find = async () => {
    const q = query.trim()
    if (q === '') return
    try {
      setFound(await search(q))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't search the registrations")
    }
  }

  const columns = useMemo(
    (): Array<AidColumn<LinkCandidateView>> => [
      {
        key: 'pick',
        header: '',
        width: 30,
        sortable: false,
        inCsv: false,
        value: () => '',
        render: (c) => (
          <input
            type="radio"
            aria-label={`Link to ${c.camper_name ?? ''}`}
            className="accent-primary m-0 align-[-1px]"
            checked={c.person_cm_id === pick}
            onChange={() => setPick(c.person_cm_id)}
          />
        ),
      },
      {
        key: 'person',
        header: 'Person',
        width: 250,
        value: (c) => c.camper_name ?? '',
        title: (c) => `${c.camper_name ?? ''} · ⌂ ${c.household_label ?? ''}`,
        render: (c) => (
          <span className="block truncate">
            <b className="font-semibold">{c.camper_name}</b>
            <span className={`${MUTED} ml-1 text-xs`}>{`⌂ ${c.household_label ?? ''}`}</span>
          </span>
        ),
      },
      {
        key: 'registration',
        header: `${String(year)} registration`,
        width: 150,
        value: (c) => {
          const id = c.session_cm_ids?.[0] ?? 0
          return id === 0
            ? 'not registered'
            : `${tinyName(id, names)} · ${c.registration_status ?? 'enrolled'}`
        },
      },
      {
        key: 'name',
        header: 'Name',
        width: 68,
        value: (c) => (hit(c, 'name') ? 'yes' : 'no'),
        render: (c) => <Clue hit={hit(c, 'name')}>name</Clue>,
      },
      {
        key: 'birthdate',
        header: 'Birthdate',
        width: 118,
        value: (c) => c.birthdate ?? '',
        render: (c) => <Clue hit={hit(c, 'birthdate')}>{c.birthdate ?? ''}</Clue>,
      },
      {
        key: 'email',
        header: 'Email',
        width: 210,
        value: (c) => c.email ?? '',
        render: (c) => <Clue hit={hit(c, 'email')}>{c.email ?? ''}</Clue>,
      },
      {
        key: 'also',
        header: 'Also',
        flex: true,
        value: (c) => c.note ?? '',
        render: (c) => <span className={MUTED}>{c.note ?? ''}</span>,
      },
    ],
    [pick, names, year]
  )

  const effects = linkEffects(response, picked, names).map((e) => ({
    sym: e.sym,
    text: (
      <>
        {e.lead !== '' && <b>{e.lead}</b>}
        {e.rest}
      </>
    ),
    then: e.then,
  }))
  const checked = response.checked_at
    ? ` Checked every hour, last at ${formatCampDateTime(response.checked_at).split(' ')[2] ?? ''}.`
    : ''

  const lead = (
    <>
      <p data-testid="link-typed" className={`${CS_POPEN_META} mb-[5px] truncate`}>
        {typedLine(link).map((part) => (
          <span key={part.label}>
            {part.label}
            <b className="text-foreground font-semibold">{part.value}</b>
          </span>
        ))}
      </p>
      {people.length === 0 ? (
        <div
          className={`${MUTED} border-border bg-card rounded-lg border border-dashed px-2.5 py-1.5 text-[13px]`}
        >
          {`No ${String(year)} registration matches “${link.name_typed}” by name, birthdate or email.${checked}`}
        </div>
      ) : (
        <>
          <span className={`${CS_PHEAD} mt-0.5 mb-[3px] block`}>
            {heading(response, link.candidates.length)}
          </span>
          <AidTable<LinkCandidateView>
            rows={people}
            columns={columns}
            rowKey={(c) => String(c.person_cm_id)}
            csvFilename="link-candidates.csv"
            hideToolbar
            nowrapHeaders
            sortable={false}
            highlighted={pick === null ? null : String(pick)}
            onHighlight={(key) => {
              if (key !== null) setPick(Number(key))
            }}
          />
        </>
      )}
    </>
  )
  const refusal = error

  return (
    <form
      data-aid-editor=""
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          if (!inFlight.current) onCancel()
        }
      }}
    >
      <EditorForm
        heading="phead"
        title={`Link a Response · “${link.name_typed}”${response.match_status === 'ignored' ? ' · undoes the ignore' : ''}`}
        lead={lead}
        side={<Effects items={effects} />}
        actions={
          <EditorActions>
            <button type="submit" className={CS_BTN} disabled={picked === null || saving}>
              Link Response
            </button>
            <button type="button" className={CS_BTN2} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            {refusal !== null ? (
              <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={refusal}>
                {refusal}
              </span>
            ) : (
              <span className={CS_POPEN_META}>{KEYS}</span>
            )}
          </EditorActions>
        }
      >
        <div className="flex items-center gap-2">
          <label htmlFor={searchId} className={`${CS_POPEN_META} whitespace-nowrap`}>
            Someone else
          </label>
          <input
            id={searchId}
            aria-label="Someone else"
            type="search"
            className={`${CS_FIELD} min-w-0 flex-1`}
            placeholder={`Search ${String(year)} registrations: a name, birthdate or CampMinder id`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void find()
              }
            }}
          />
        </div>
      </EditorForm>
    </form>
  )
}
