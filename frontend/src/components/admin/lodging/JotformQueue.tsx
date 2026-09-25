/**
 * The unmatched queue, duplicates, and staff links (kindred#2759). Kindred
 * never picks between candidates: every suggestion is a labelled button, and
 * any enrolled guest of the weekend can be chosen by hand.
 *
 * A filer who is not a guest at all -- staff, say -- can be linked to one of
 * the weekend's board write-ins instead (kindred#2759 follow-up); the one
 * whose name matches is pre-selected, never linked on its own. Filers who
 * match a registration that is not enrolled are listed apart, needing nothing.
 */
import { useState } from 'react'

import { useJotformQueue, useJotformSubmissionAction } from '../../../hooks/useJotformAdmin'
import type {
  JotformDuplicateGroupRow,
  JotformGuestRow,
  JotformQueueEntry,
  JotformWriteInChoice,
} from '../../../types/jotform'
import { QueryGuard } from '../../QueryGuard'
import { shortDate } from '../../weekend/bunkingRequest'
import {
  ACTION_LINK,
  AMBER_NOTE,
  AMBER_PILL,
  BUTTON_SECONDARY,
  FIELD_INLINE,
  GROUP_HEADING,
  MUTED_PILL,
} from './lodgingStyles'

function UnmatchedItem({
  item,
  guests,
  writeIns,
}: {
  item: JotformQueueEntry
  guests: readonly JotformGuestRow[]
  /** This weekend's board write-ins, already filtered to its session. */
  writeIns: readonly JotformWriteInChoice[]
}) {
  const action = useJotformSubmissionAction()
  const [chosen, setChosen] = useState('')
  // Pre-selected when a write-in's name matches the filer's; staff can pick any.
  const [chosenWriteIn, setChosenWriteIn] = useState(item.write_in_suggestion ?? '')
  const writeIn = writeIns.find((option) => option.option_id === chosenWriteIn)
  const sessionGuests = guests.filter((guest) => guest.session_cm_id === item.session_cm_id)
  const enrolled = new Set(sessionGuests.map((guest) => guest.person_cm_id))
  const nametag = item.nametag ?? ''
  const request = item.bunking_request ?? ''
  return (
    // Who filed on the left, the decision on the right: the actions sit beside
    // the filing instead of on a row of their own.
    <li
      data-testid={`jotform-unmatched-${item.submission_id}`}
      className="border-border/60 flex flex-wrap items-start gap-x-4 gap-y-2 border-b py-2.5 last:border-b-0"
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-foreground font-semibold">{item.submitted_name}</span>
          {nametag !== '' && (
            <span className="text-muted-foreground text-xs">{`nametag “${nametag}”`}</span>
          )}
          <span className="text-muted-foreground text-xs">{shortDate(item.submitted_at)}</span>
        </div>
        {request !== '' && (
          <p className="text-muted-foreground truncate text-xs italic" title={request}>
            {`Bunking request: ${request}`}
          </p>
        )}
        {(item.suggestions ?? []).length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {(item.suggestions ?? []).map((suggestion) => {
              const personCmId = suggestion.person_cm_id ?? 0
              return (
                <li
                  key={`${suggestion.kind}-${String(personCmId)}-${suggestion.other_submission_id ?? ''}`}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <span>{suggestion.label}</span>
                  {suggestion.demoted === true && (
                    <span className="text-muted-foreground text-xs">
                      · named in their own request
                    </span>
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
                        action.mutate({
                          kind: 'link',
                          submissionId: item.submission_id,
                          personCmId,
                        })
                      }}
                    >
                      Link
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          className={`${FIELD_INLINE} w-56`}
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
        {writeIns.length > 0 && (
          // Its own line under the guest picker: the two lists are different
          // kinds of thing, and one wide row would crowd the filing.
          <div className="flex basis-full items-center gap-2">
            <select
              className={`${FIELD_INLINE} w-56`}
              aria-label={`Write-in for ${item.submitted_name}`}
              value={chosenWriteIn}
              onChange={(event) => {
                setChosenWriteIn(event.target.value)
              }}
            >
              <option value="">Choose a write-in…</option>
              {writeIns.map((option) => (
                <option key={option.option_id} value={option.option_id}>
                  {option.unit_name
                    ? `${option.occupant_name} · ${option.unit_name}`
                    : option.occupant_name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={writeIn === undefined || action.isPending}
              aria-label="Link chosen write-in"
              onClick={() => {
                if (writeIn === undefined) return
                action.mutate({
                  kind: 'write_in',
                  submissionId: item.submission_id,
                  unitId: writeIn.unit_id,
                  occupantName: writeIn.occupant_name,
                })
              }}
            >
              Write-in
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

// A repeat filer whose request changed is the one staff need to read, so it
// carries the amber pill and sorts first; an identical re-filing is muted.
const CHANGE_PILL: Readonly<Record<string, { label: string; className: string }>> = {
  identical: { label: 'Identical', className: MUTED_PILL },
  list: { label: 'Changed', className: AMBER_PILL },
  prose: { label: 'Changed', className: AMBER_PILL },
}

const changedFirst = (kind: string | null | undefined) =>
  kind === 'list' || kind === 'prose' ? 0 : 1

function DuplicateGroup({ group }: { group: JotformDuplicateGroupRow }) {
  const pill = CHANGE_PILL[group.change_kind ?? 'none']
  return (
    // One group per (guest, weekend): a guest enrolled in two adult weekends
    // has a group on each weekend's tab.
    <li
      data-testid={`jotform-duplicate-${String(group.person_cm_id)}`}
      className="border-border/60 rounded-md border px-3 py-2 text-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground truncate font-semibold">{group.guest_name}</span>
        {pill !== undefined && <span className={`${pill.className} shrink-0`}>{pill.label}</span>}
      </div>
      <ul className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
        {(group.submissions ?? []).map((sub) => {
          const request = (sub.bunking_request ?? '').trim()
          return (
            <li
              key={sub.submission_id}
              data-testid={`jotform-filing-${sub.submission_id}`}
              className="col-span-2 grid grid-cols-subgrid"
            >
              <span className="text-muted-foreground tabular-nums">
                {shortDate(sub.submitted_at)}
              </span>
              <span
                className={request === '' ? 'text-muted-foreground italic' : 'truncate'}
                title={request === '' ? undefined : request}
              >
                {request === '' ? '(no request)' : request}
              </span>
            </li>
          )
        })}
      </ul>
    </li>
  )
}

function ResolvedList({
  testId,
  title,
  rows,
  detail,
  undoable = true,
}: {
  testId: string
  title: string
  rows: readonly JotformQueueEntry[]
  /** What the filing resolved to, after the arrow; nothing when absent. */
  detail?: (item: JotformQueueEntry) => string
  /** False for a list that asks nothing of staff (cancelled registrations). */
  undoable?: boolean
}) {
  const action = useJotformSubmissionAction()
  return (
    <section data-testid={testId} className="card-lodge p-4">
      <h3 className={GROUP_HEADING}>{`${title} (${String(rows.length)})`}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">None yet</p>
      ) : (
        <ul className="divide-border/60 mt-1 divide-y">
          {rows.map((item) => {
            // Un-ignoring shares the unlink endpoint, but an ignored row was
            // never linked to anyone: it is restored to the queue.
            const ignored = item.match_status === 'ignored'
            const verb = ignored ? 'Restore' : 'Unlink'
            const after =
              detail !== undefined ? detail(item) : ignored ? '' : (item.guest_name ?? '')
            return (
              <li key={item.submission_id} className="flex items-baseline gap-2 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{item.submitted_name}</span>
                  {after !== '' && (
                    <span className="text-muted-foreground text-xs">{` → ${after}`}</span>
                  )}
                </span>
                {undoable && (
                  <button
                    type="button"
                    className={`${ACTION_LINK} text-primary ml-auto shrink-0`}
                    disabled={action.isPending}
                    aria-label={`${verb} ${item.submitted_name}`}
                    onClick={() => {
                      action.mutate({ kind: 'unlink', submissionId: item.submission_id })
                    }}
                  >
                    {verb}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * One weekend's slice of the queue: the panel draws a tab per weekend, and
 * the year's queue (one cached read) is filtered to the tab's session here.
 *
 * Laid out for a wide admin screen: the filings that need a decision beside
 * the short staff-links and ignored lists, then repeat filers as a grid.
 */
export function JotformQueue({ year, sessionCmId }: { year: number; sessionCmId: number }) {
  const queue = useJotformQueue(year)
  return (
    <QueryGuard
      isLoading={queue.isLoading || year <= 0}
      error={queue.error}
      data={queue.data}
      label="Jotform queue"
    >
      {(data) => {
        const mine = <T extends { session_cm_id: number }>(rows: readonly T[] | undefined) =>
          (rows ?? []).filter((row) => row.session_cm_id === sessionCmId)
        const unmatched = mine(data.unmatched)
        // kindred#2828: matching has not run for a form with no name mapped,
        // so its submissions are not listed; one line says why instead.
        const unmapped = mine(data.unmapped)
        const duplicates = [...mine(data.duplicates)].sort(
          (a, b) => changedFirst(a.change_kind) - changedFirst(b.change_kind)
        )
        const resolved = mine(data.resolved)
        const staffLinks = resolved.filter((row) => row.match_status !== 'ignored')
        const ignored = resolved.filter((row) => row.match_status === 'ignored')
        const writeIns = mine(data.write_ins)
        const cancelled = mine(data.cancelled)
        const writeInChoices = mine(data.write_in_options)
        return (
          <div className="flex flex-col gap-4">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <section className="card-lodge p-4">
                <h3 className={GROUP_HEADING}>{`Needs a guest (${String(unmatched.length)})`}</h3>
                {unmapped.map((form) => (
                  <p key={form.session_cm_id} className={`${AMBER_NOTE} mt-2`}>
                    {`Matching hasn't run for ${form.session_name ?? ''}: first and last name aren't mapped yet.`}
                  </p>
                ))}
                {unmatched.length > 0 && (
                  <ul className="mt-1">
                    {unmatched.map((item) => (
                      <UnmatchedItem
                        key={item.submission_id}
                        item={item}
                        guests={data.guests ?? []}
                        writeIns={writeInChoices}
                      />
                    ))}
                  </ul>
                )}
                {unmatched.length === 0 && unmapped.length === 0 && (
                  <p className="text-muted-foreground mt-2 text-sm">
                    Every submission is matched to a guest.
                  </p>
                )}
              </section>
              <div className="flex flex-col gap-4">
                <ResolvedList testId="jotform-staff-links" title="Staff links" rows={staffLinks} />
                <ResolvedList
                  testId="jotform-write-ins"
                  title="Write-ins"
                  rows={writeIns}
                  detail={(item) =>
                    [item.write_in_name ?? '', item.write_in_unit ?? '']
                      .filter((part) => part !== '')
                      .join(' · ')
                  }
                />
                <ResolvedList
                  testId="jotform-cancelled"
                  title="Cancelled registrations"
                  rows={cancelled}
                  detail={(item) => {
                    const status = item.registration_status ?? ''
                    return status === '' ? 'cancelled' : status
                  }}
                  undoable={false}
                />
                <ResolvedList testId="jotform-ignored" title="Ignored" rows={ignored} />
              </div>
            </div>

            <section className="card-lodge p-4">
              <h3 className={GROUP_HEADING}>
                {`Filed more than once (${String(duplicates.length)})`}
              </h3>
              {duplicates.length === 0 ? (
                <p className="text-muted-foreground mt-2 text-sm">Nobody has filed twice.</p>
              ) : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {duplicates.map((group) => (
                    <DuplicateGroup
                      key={`${String(group.person_cm_id)}-${String(group.session_cm_id)}`}
                      group={group}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )
      }}
    </QueryGuard>
  )
}
