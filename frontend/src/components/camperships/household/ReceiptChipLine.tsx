import { useMemo } from 'react'

import { NEGATIVE_INK } from '../kit/aidStyles'
import { BINDING_TEXT } from '../kit/kitStyles'
import type { AidTraceStep, ReceiptSentencePart } from '../kit/receiptModel'
import {
  HH_CHIP,
  HH_CHIP_FLOW,
  HH_CHIP_LINE,
  HH_CHIP_ROUND,
  HH_CHIP_TOTAL,
} from './householdStyles'
import { receiptChips } from './receiptChips'

function Part({ part }: { part: ReceiptSentencePart }) {
  if (part.kind === 'figure')
    return (
      <b className={part.negative ? `tabular-nums ${NEGATIVE_INK}` : 'tabular-nums'}>{part.text}</b>
    )
  if (part.kind === 'bound') return <span className={BINDING_TEXT}>{part.text}</span>
  return <>{part.text}</>
}

/**
 * The household card's receipt line (household-v4.html section 2 (B)): one line of chips that
 * never wraps; in a narrow window the chips end in "…" and the Total stays whole at the right. The
 * full sentence is its hover, as in the mock.
 */
export function ReceiptChipLine({ trace }: { trace: readonly AidTraceStep[] }) {
  const line = useMemo(() => receiptChips(trace), [trace])
  return (
    <div data-testid="receipt-chips" title={line.title} className={HH_CHIP_LINE}>
      <span className={HH_CHIP_FLOW}>
        {line.chips.map((chip, index) => (
          <span key={index} className={HH_CHIP}>
            {chip.round !== null && <span className={HH_CHIP_ROUND}>{chip.round}</span>}
            {chip.round !== null && ' '}
            {chip.parts.map((part, at) => (
              <Part key={at} part={part} />
            ))}
          </span>
        ))}
      </span>
      {line.total !== null && (
        <span className={HH_CHIP_TOTAL}>
          Total <b className="tabular-nums">{line.total}</b>
        </span>
      )}
    </div>
  )
}
