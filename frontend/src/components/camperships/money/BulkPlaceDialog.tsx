import { useRef, useState } from 'react'

import { useAidPlaceLines } from '../../../hooks/camperships/useAidToPlaceWrites'
import type { ApiAidToPlaceLine } from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { Modal } from '../../ui/Modal'
import { CS_BTN, CS_BTN2, CS_POPEN_META } from '../kit/csType'
import { StatusPill } from '../kit/Pills'
import { formatMoney } from '../kit/money'
import { bulkBody, estimateLocked, MAX_BULK_LINES, type BulkPlan } from './bulkPlaceModel'
import { refusalWords } from './refusal'
import {
  lineFamily,
  lineWords,
  placedTitle,
  placedWords,
  requestLabels,
  suggestionShort,
  suggestionWords,
} from './toPlaceModel'
import { EffectList } from './ToPlaceParts'

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`
const familyOf = (line: ApiAidToPlaceLine) => lineFamily(line).text

/**
 * The bulk confirm's dialog (§4.10; P-6): every checked line it takes (hidden ones marked), the
 * households, and what they mark Posted, labelled an estimate when there are two or more (owner ruling
 * Group 3a Q4); the checked lines it leaves out, and why. `plan` is derived by the tab from the
 * CURRENT read while the dialog shows, so a refusal (the reads refresh before it rejects) never
 * re-sends the refused body: Confirm sends what is open now, and lines that dropped out are counted
 * (plan review I4). All or nothing, one operation; the result lists exactly what was marked posted.
 */
export function BulkPlaceDialog({
  plan,
  year,
  allLines,
  onClose,
  onDone,
  onRefused,
}: {
  plan: BulkPlan | null
  year: number
  /** Every line the read sent, so the result names each request it marked posted. */
  allLines: readonly ApiAidToPlaceLine[]
  onClose: () => void
  onDone: (words: string, placed: readonly number[], title?: string) => void
  /** The tab's note takes a refusal too, so a stale green line never stays up (P-26). */
  onRefused: (words: string) => void
}) {
  const place = useAidPlaceLines()
  const [error, setError] = useState<string | null>(null)
  // A second press while one is in flight is ignored: `isPending` from the render closure lags a
  // fast double click.
  const inFlight = useRef(false)
  if (plan === null) return null
  const tooMany = plan.lines.length > MAX_BULK_LINES
  const several = plan.lines.length > 1
  const busy = place.isPending
  const marked = estimateLocked(plan)
  const marking =
    marked > 0
      ? `marks ${formatMoney(marked)} Posted`
      : 'places the money; Posted stays to check by hand'
  const close = () => {
    if (inFlight.current) return
    setError(null)
    onClose()
  }
  const confirm = async () => {
    if (inFlight.current || tooMany || plan.lines.length === 0) return
    inFlight.current = true
    setError(null)
    try {
      const out = await place.mutateAsync({ year, body: bulkBody(plan) })
      onDone(
        placedWords(out, allLines, familyOf),
        out.placed,
        placedTitle(out, allLines, requestLabels(allLines), familyOf)
      )
    } catch (caught) {
      const words = refusalWords(caught)
      setError(words)
      onRefused(words)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <Modal
      isOpen
      onClose={close}
      closeDisabled={busy}
      // The final mock's `.cf-modal` (ux3 to-place-2): a 560px card near the top on a plain scrim, a 15px sans title
      // (§19: serif only on the band), no close X, and a muted footer band.
      header={
        <div
          id="bulk-place-title"
          className="px-[18px] pt-3.5 pb-1.5 text-[15px] leading-[22px] font-bold"
        >{`Confirm ${String(plan.lines.length)} exact single ${plan.lines.length === 1 ? 'match' : 'matches'}`}</div>
      }
      ariaLabelledBy="bulk-place-title"
      noPadding
      maxWidthClassName="max-w-[560px]"
      anchor="top"
      plainBackdrop
      hideCloseButton
      footer={
        // §24: the logged-with-who sentence at the left of the band, Back then Confirm N at the right.
        <div
          data-testid="bulk-place-footer"
          className="border-border flex items-center justify-between gap-3 border-t bg-[color-mix(in_oklab,var(--color-muted)_35%,var(--color-card))] px-[18px] py-2.5"
        >
          <span className={`${CS_POPEN_META} min-w-0 truncate`}>
            All or nothing · one operation in Season › History
          </span>
          <div className="flex flex-none items-center gap-2">
            <button type="button" className={CS_BTN2} disabled={busy} onClick={close}>
              Back
            </button>
            <button
              type="button"
              className={CS_BTN}
              disabled={busy || tooMany || plan.lines.length === 0}
              onClick={() => void confirm()}
            >
              {busy ? 'Placing…' : `Confirm ${String(plan.lines.length)}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-[18px] pt-0.5 pb-3 text-[13.5px] leading-normal">
        <p className="font-bold">
          {plan.lines.length === 0
            ? 'Nothing to confirm together'
            : `${plural(plan.lines.length, 'line', 'lines')} · ${plural(plan.households, 'household', 'households')} · ${marking} `}
          {several && <StatusPill tone="amber">Estimate</StatusPill>}
        </p>
        <EffectList
          lines={[
            {
              sym: 'info',
              text: several
                ? "Each line goes on its family's one request"
                : "The line goes on its family's one request",
            },
            several
              ? {
                  sym: 'hand',
                  text: 'The total is an estimate: two lines on one request can mark more or less Posted together than apart',
                  then: '→ The result lists exactly what was marked Posted',
                }
              : {
                  sym: 'hand',
                  text: 'If what it marks Posted moved since the page loaded, nothing is written and the page reloads',
                },
          ]}
        />
        {plan.gone > 0 && (
          <p className={AMBER_NOTE}>
            {`${plural(plan.gone, 'line is', 'lines are')} no longer open and ${plan.gone === 1 ? 'was' : 'were'} left out.`}
          </p>
        )}
        <ul
          data-testid="bulk-place-names"
          className="border-border text-muted-foreground max-h-[150px] overflow-y-auto rounded-lg border bg-[color-mix(in_oklab,var(--color-muted)_25%,var(--color-card))] px-2.5 py-1.5 text-[12.5px] leading-[18px]"
        >
          {plan.lines.map(({ line, hidden }) => (
            <li
              key={line.transaction_cm_id}
              className="truncate"
              title={`${familyOf(line)}: ${lineWords(line)} → ${suggestionWords(line).replace(/^Place on /, '')}`}
            >
              {`${familyOf(line)}: ${formatMoney(line.amount)} → ${suggestionShort(line).replace(/^Place on /, '')}`}
              {hidden ? ' (hidden by the search)' : ''}
            </li>
          ))}
        </ul>
        {plan.leftOut.length > 0 && (
          <p className={AMBER_NOTE}>
            {`Left out, confirm one at a time: ${plan.leftOut.map((l) => `${familyOf(l.line)} (${l.why})`).join(', ')}.`}
          </p>
        )}
        {tooMany && (
          <p className={AMBER_NOTE}>
            {`One confirm takes at most ${String(MAX_BULK_LINES)} lines: check fewer.`}
          </p>
        )}
        {error !== null && <p className={AMBER_NOTE}>{error}</p>}
      </div>
    </Modal>
  )
}
