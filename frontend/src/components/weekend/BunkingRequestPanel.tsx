/**
 * "Bunking request (Jotform)" — an adult guest's panel section (kindred#2759),
 * built entirely from `panelRows` so it reads as the family share section's
 * sibling. Owner picks locked in the lab: ONE "Bunking request" row with the
 * changes marked inline (added green, dropped struck red where it sat,
 * respelled muted "(was …)"), prose falling back to every version, then the
 * coming-with capsule, then when it was submitted. Every row says it is Jotform.
 *
 * The inline markup is the server's NET first-vs-latest change
 * (`api/services/jotform_bunking.py`'s `resolve_change`), never re-derived
 * here. It shows whenever `change` is set — `state: 'none'` included, because
 * a blank re-file WITHDRAWS the request, and the names it withdrew are what
 * staff need to see (P8).
 */
import { CalendarDays, Handshake } from 'lucide-react'
import { useState } from 'react'

import type {
  BunkingRequest,
  BunkingRequestItem,
  BunkingRequestVersionRow,
} from '../../types/lodging'
import {
  BUNKING_ANCHOR_CLASS,
  COMING_WITH_CLASS,
  COMING_WITH_ICON,
  changeCaption,
  comingWithLabel,
  shortDate,
  wordDiff,
} from './bunkingRequest'
import {
  ChipCapsule,
  ChoiceRow,
  MK_SAY,
  NOTE_CHIP_CLASS,
  NoteRow,
  ProvenanceTag,
  ROW_CAPTION,
  RowChip,
  RowText,
} from './panelRows'
import { CAP_CLASSES } from './shareMarks'

const ADD = 'font-semibold text-green-700 not-italic dark:text-green-300'
const DEL = 'text-red-600 line-through not-italic dark:text-red-400'
const RESPELL = 'text-muted-foreground not-italic'

function opClass(op: BunkingRequestItem['op']): string {
  if (op === 'add') return ADD
  if (op === 'remove') return DEL
  if (op === 'respell') return RESPELL
  return ''
}

function InlineItems({ items }: { items: readonly BunkingRequestItem[] }) {
  return (
    <p data-testid="bunking-request-inline" className={MK_SAY}>
      {items.map((item, index) => (
        <span key={`${String(index)}-${item.op}-${item.text}`}>
          {index > 0 && ', '}
          <span className={`whitespace-nowrap ${opClass(item.op)}`}>
            {item.text}
            {item.op === 'respell' && (item.was ?? '') !== '' && (
              <span className="text-[11px]">{` (was ${item.was ?? ''})`}</span>
            )}
          </span>
        </span>
      ))}
    </p>
  )
}

function Versions({ versions }: { versions: readonly BunkingRequestVersionRow[] }) {
  return (
    <div data-testid="bunking-request-versions" className="flex flex-col gap-1">
      {versions.map((version, index) => {
        const previous = index > 0 ? versions[index - 1] : undefined
        const text = (version.text ?? '').trim()
        const ops = previous ? wordDiff(previous.text ?? '', text) : [{ op: 'same' as const, text }]
        const isCurrent = index === versions.length - 1
        return (
          <div key={`${version.submitted_at}-${String(index)}`} className="flex flex-col gap-0.5">
            <span className={ROW_CAPTION}>
              {`${shortDate(version.submitted_at)}${isCurrent ? ' · current' : ''}`}
            </span>
            <p className={`${MK_SAY}${isCurrent ? '' : 'opacity-60'}`}>
              {text.length === 0 ? (
                // A blank filing withdrew the request (P8).
                <span className={RESPELL}>No request</span>
              ) : (
                ops.map((op, opIndex) => (
                  <span key={`${String(opIndex)}-${op.text}`}>
                    {opIndex > 0 && ' '}
                    <span className={op.op === 'add' ? ADD : op.op === 'del' ? DEL : ''}>
                      {op.text}
                    </span>
                  </span>
                ))
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function RequestBody({ request }: { request: BunkingRequest }) {
  const change = request.change ?? null
  const current = request.current_text ?? ''
  if (change === null) return <RowText text={current} testId="bunking-request-text" />
  const caption = <span className={ROW_CAPTION}>{changeCaption(request)}</span>
  if (change.kind === 'prose') {
    return (
      <>
        <Versions versions={change.versions ?? []} />
        {caption}
      </>
    )
  }
  if (change.kind === 'identical') {
    return (
      <>
        <RowText text={current} testId="bunking-request-text" />
        {caption}
      </>
    )
  }
  return (
    <>
      <InlineItems items={change.items ?? []} />
      {caption}
    </>
  )
}

export function BunkingRequestPanel({ request }: { request: BunkingRequest }) {
  // Keyed per guest by the caller, so every guest opens expanded.
  const [expanded, setExpanded] = useState(true)
  const submitted = request.submitted ?? []
  const latest = submitted[submitted.length - 1]
  const jotformTag = latest !== undefined ? `Jotform · ${shortDate(latest)}` : 'Jotform'
  const chip = (
    <RowChip
      Icon={Handshake}
      testId="bunking-request-chip"
      className={`${BUNKING_ANCHOR_CLASS[request.state]} ${CAP_CLASSES.solo}`}
    />
  )
  const tokens = request.coming_with ?? []

  if (request.state === 'no_form') {
    return (
      <ul className="flex flex-col gap-2">
        <ChoiceRow chip={chip} label="No Jotform submission yet" tag="Jotform" />
      </ul>
    )
  }

  // A body to fold: the request itself, or — for a filing with none — the
  // change that withdrew it (P8). A plain "none" with no history is a choice
  // row, nothing under it.
  const hasBody = request.state === 'request' || request.change != null

  return (
    <ul className="flex flex-col gap-2">
      {hasBody ? (
        <NoteRow
          chip={chip}
          label={request.state === 'request' ? 'Bunking request' : 'No bunking request'}
          tag={jotformTag}
          expanded={expanded}
          onToggle={() => {
            setExpanded((value) => !value)
          }}
        >
          <RequestBody request={request} />
        </NoteRow>
      ) : (
        <ChoiceRow chip={chip} label="No bunking request" tag={jotformTag} />
      )}

      {tokens.length > 0 && (
        <ChoiceRow
          chip={
            <ChipCapsule
              chips={tokens.map((token) => ({
                key: token,
                Icon: COMING_WITH_ICON[token],
                className: COMING_WITH_CLASS,
                testId: `coming-with-chip-${token}`,
              }))}
            />
          }
          label={comingWithLabel(tokens)}
          tag={jotformTag}
        />
      )}

      <li className="flex flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
          <RowChip Icon={CalendarDays} className={NOTE_CHIP_CLASS} />
          <span className="ml-0.5 font-semibold">
            {latest !== undefined ? `Submitted ${shortDate(latest)}` : 'Submitted'}
          </span>
          {submitted.length > 1 && (
            <span className="text-muted-foreground text-[11px]">
              {`also ${submitted
                .slice(0, -1)
                .map((stamp) => shortDate(stamp))
                .join(', ')}`}
            </span>
          )}
          <ProvenanceTag>Jotform</ProvenanceTag>
          {request.staff_linked === true && <ProvenanceTag>Staff link</ProvenanceTag>}
        </div>
      </li>
    </ul>
  )
}
