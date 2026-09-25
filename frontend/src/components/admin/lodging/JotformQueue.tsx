/**
 * The unmatched queue, duplicates, and staff links (kindred#2759). Kindred
 * never picks between candidates: every suggestion is a labelled button, and
 * any enrolled guest of the weekend can be chosen by hand.
 */
import { useState } from 'react'

import {
  useJotformForms,
  useJotformQueue,
  useJotformSubmissionAction,
} from '../../../hooks/useJotformAdmin'
import type { JotformGuestRow, JotformQueueEntry } from '../../../types/jotform'
import { QueryGuard } from '../../QueryGuard'
import { shortDate } from '../../weekend/bunkingRequest'
import {
  ACTION_LINK,
  BUTTON_SECONDARY,
  FIELD_INLINE,
  GROUP_HEADING,
  MUTED_PILL,
} from './lodgingStyles'

function UnmatchedItem({
  item,
  guests,
}: {
  item: JotformQueueEntry
  guests: readonly JotformGuestRow[]
}) {
  const action = useJotformSubmissionAction()
  const [chosen, setChosen] = useState('')
  const sessionGuests = guests.filter((guest) => guest.session_cm_id === item.session_cm_id)
  const enrolled = new Set(sessionGuests.map((guest) => guest.person_cm_id))
  const nametag = item.nametag ?? ''
  const request = item.bunking_request ?? ''
  return (
    <li
      data-testid={`jotform-unmatched-${item.submission_id}`}
      className="border-border/60 flex flex-col gap-2 border-b py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="text-foreground font-semibold">{item.submitted_name}</span>
        {nametag !== '' && (
          <span className="text-muted-foreground text-xs">{`nametag “${nametag}”`}</span>
        )}
        {(item.session_name ?? '') !== '' && (
          <span className={MUTED_PILL}>{item.session_name}</span>
        )}
        <span className="text-muted-foreground text-xs">{shortDate(item.submitted_at)}</span>
      </div>
      {request !== '' && (
        <p className="text-muted-foreground text-xs italic">{`Bunking request: ${request}`}</p>
      )}
      <ul className="flex flex-col gap-1">
        {(item.suggestions ?? []).map((suggestion) => {
          const personCmId = suggestion.person_cm_id ?? 0
          return (
            <li
              key={`${suggestion.kind}-${String(personCmId)}-${suggestion.other_submission_id ?? ''}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>{suggestion.label}</span>
              {suggestion.demoted === true && (
                <span className="text-muted-foreground text-xs">· named in their own request</span>
              )}
              {/* A likely duplicate can point at another unmatched SUBMISSION
                  (no person), or at a filing whose person has since left the
                  weekend (the server refuses that link). Only an enrolled
                  guest of this weekend gets a Link. */}
              {personCmId > 0 && enrolled.has(personCmId) && (
                <button
                  type="button"
                  className={`${ACTION_LINK} text-primary`}
                  disabled={action.isPending}
                  aria-label={`Link to ${suggestion.guest_name ?? ''}`}
                  onClick={() => {
                    action.mutate({ kind: 'link', submissionId: item.submission_id, personCmId })
                  }}
                >
                  Link
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${FIELD_INLINE} w-64`}
          aria-label={`Guest for ${item.submitted_name}`}
          value={chosen}
          onChange={(event) => {
            setChosen(event.target.value)
          }}
        >
          <option value="">Choose a guest…</option>
          {sessionGuests.map((guest) => (
            <option key={guest.person_cm_id} value={String(guest.person_cm_id)}>
              {`${guest.display_name}${guest.has_submission === true ? ' (has a submission)' : ''}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={chosen === '' || action.isPending}
          aria-label="Link chosen guest"
          onClick={() => {
            action.mutate({
              kind: 'link',
              submissionId: item.submission_id,
              personCmId: Number(chosen),
            })
          }}
        >
          Link
        </button>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          disabled={action.isPending}
          onClick={() => {
            action.mutate({ kind: 'ignore', submissionId: item.submission_id })
          }}
        >
          Ignore
        </button>
      </div>
    </li>
  )
}

const CHANGE_CAPTION: Readonly<Record<string, string>> = {
  identical: 'identical',
  list: 'changed',
  prose: 'changed',
  none: '',
}

export function JotformQueue({ year }: { year: number }) {
  const queue = useJotformQueue(year)
  // The duplicate filings carry no session_name; the weekend's name comes
  // from the forms list (the same cached query the cards above read).
  const forms = useJotformForms(year)
  const sessionNames = new Map(
    (forms.data?.rows ?? []).map((row) => [row.session_cm_id, row.session_name])
  )
  const action = useJotformSubmissionAction()
  return (
    <QueryGuard
      isLoading={queue.isLoading || year <= 0}
      error={queue.error}
      data={queue.data}
      label="Jotform queue"
    >
      {(data) => {
        const unmatched = data.unmatched ?? []
        const duplicates = data.duplicates ?? []
        const resolved = data.resolved ?? []
        return (
          <div className="flex flex-col gap-6">
            <section className="card-lodge p-4">
              <h3 className={GROUP_HEADING}>{`Needs a guest (${String(unmatched.length)})`}</h3>
              {unmatched.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  Every submission is matched to a guest.
                </p>
              ) : (
                <ul>
                  {unmatched.map((item) => (
                    <UnmatchedItem
                      key={item.submission_id}
                      item={item}
                      guests={data.guests ?? []}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="card-lodge p-4">
              <h3 className={GROUP_HEADING}>
                {`Filed more than once (${String(duplicates.length)})`}
              </h3>
              <ul className="mt-2 flex flex-col gap-3">
                {duplicates.map((group) => {
                  const sessionName =
                    sessionNames.get(group.session_cm_id) ??
                    group.submissions?.[0]?.session_name ??
                    ''
                  return (
                    // One group per (guest, weekend): a guest enrolled in two
                    // adult weekends can be in two groups.
                    <li
                      key={`${String(group.person_cm_id)}-${String(group.session_cm_id)}`}
                      data-testid={`jotform-duplicate-${String(group.person_cm_id)}`}
                      className="text-sm"
                    >
                      <span className="text-foreground font-semibold">{group.guest_name}</span>{' '}
                      {sessionName !== '' && <span className={MUTED_PILL}>{sessionName}</span>}{' '}
                      <span className="text-muted-foreground text-xs">
                        {CHANGE_CAPTION[group.change_kind ?? 'none'] ?? ''}
                      </span>
                      <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5 pl-4 text-xs">
                        {(group.submissions ?? []).map((sub) => (
                          <li key={sub.submission_id}>
                            {`${shortDate(sub.submitted_at)}: ${(sub.bunking_request ?? '').trim() || '(no request)'}`}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="card-lodge p-4">
              <h3 className={GROUP_HEADING}>
                {`Staff links and ignored (${String(resolved.length)})`}
              </h3>
              <ul className="mt-2 flex flex-col gap-1">
                {resolved.map((item) => {
                  // Un-ignoring shares the unlink endpoint, but an ignored row
                  // was never linked to anyone: it is restored to the queue.
                  const verb = item.match_status === 'ignored' ? 'Restore' : 'Unlink'
                  return (
                    <li
                      key={item.submission_id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="font-semibold">{item.submitted_name}</span>
                      <span className="text-muted-foreground text-xs">
                        {item.match_status === 'ignored'
                          ? 'ignored'
                          : `linked to ${item.guest_name ?? ''}`}
                      </span>
                      <button
                        type="button"
                        className={`${ACTION_LINK} text-primary`}
                        disabled={action.isPending}
                        aria-label={`${verb} ${item.submitted_name}`}
                        onClick={() => {
                          action.mutate({ kind: 'unlink', submissionId: item.submission_id })
                        }}
                      >
                        {verb}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        )
      }}
    </QueryGuard>
  )
}
