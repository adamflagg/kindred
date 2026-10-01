import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { BINDING_LINE, BINDING_TEXT, NEGATIVE_INK } from './aidStyles'
import type { AidView } from './asOf'
import {
  bindingPhrase,
  receiptLabel,
  receiptLineCount,
  receiptRulesHref,
  receiptRulesWords,
  receiptSections,
  receiptSentence,
  stepHow,
  stepIsNegativeMoney,
  stepValue,
  type AidTraceStep,
  type ReceiptLabel,
} from './receiptModel'

/** The receipt's sentence. It is also the editor row's one-line form (§6.5), so the two agree. */
export function ReceiptSentence({
  trace,
  className,
}: {
  trace: readonly AidTraceStep[]
  className?: string | undefined
}) {
  return (
    <p className={className ?? 'text-sm'}>
      {receiptSentence(trace).map((part, index) =>
        part.kind === 'figure' ? (
          <b
            key={index}
            className={part.negative ? `tabular-nums ${NEGATIVE_INK}` : 'tabular-nums'}
          >
            {part.text}
          </b>
        ) : part.kind === 'bound' ? (
          <span key={index} className={BINDING_TEXT}>
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </p>
  )
}

/** The label, with its rules version linked to Season › Rules (D76). */
function ReceiptLabelLine({ label, view }: { label: ReceiptLabel; view?: AidView | undefined }) {
  const words = receiptRulesWords(label)
  const full = receiptLabel(label)
  const at = full.indexOf(words)
  return (
    <div className="text-muted-foreground text-xs">
      {full.slice(0, at)}
      <Link to={receiptRulesHref(label, view)} className="hover:underline">
        {words}
      </Link>
      {full.slice(at + words.length)}
    </div>
  )
}

interface ReceiptProps {
  trace: readonly AidTraceStep[]
  label: ReceiptLabel
  /** The page's season and as-of, which the rules link carries (Decision 9). */
  view?: AidView | undefined
  /** The household page folds receipts under their sentence (D34). */
  folded?: boolean | undefined
  /** …except on a hold, or while a "would change by" flag shows (D34), including one that arrives later. */
  openByItself?: boolean | undefined
}

/**
 * The receipt (§4.7, §6.5; D33 form D): its label, the sentence on top, and the line receipt
 * grouped Income → Tier → Cost → Round 1 → Round 2 → Total, with the binding limit in amber. Each
 * line opens on click to show how it was worked out, never on hover.
 */
export function Receipt({
  trace,
  label,
  view,
  folded = false,
  openByItself = false,
}: ReceiptProps) {
  const [open, setOpen] = useState(!folded || openByItself)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const sections = useMemo(() => receiptSections(trace), [trace])

  // Ruling 2026-10-01 (plan review): a hold or flag that arrives after the first render opens it
  // too. Adjusted during render (React's pattern for state that follows a prop), not in an effect.
  const [sawOpenByItself, setSawOpenByItself] = useState(openByItself)
  if (openByItself !== sawOpenByItself) {
    setSawOpenByItself(openByItself)
    if (openByItself) setOpen(true)
  }

  const toggle = (index: number) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  return (
    <div className="space-y-1.5">
      <ReceiptLabelLine label={label} view={view} />
      <ReceiptSentence trace={trace} />
      {folded && (
        <button
          type="button"
          className="text-primary text-xs hover:underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open
            ? 'Hide the receipt ▴'
            : `Show the receipt (${String(receiptLineCount(trace))} lines) ▾`}
        </button>
      )}
      {(!folded || open) && (
        <div className="border-border divide-border divide-y rounded-lg border text-sm">
          {sections.map((section) => (
            <div key={section.name} className="py-1">
              <div className="text-muted-foreground px-3 pt-1 text-xs font-semibold tracking-wide uppercase">
                {section.name}
              </div>
              {section.steps.map((step) => {
                const index = trace.indexOf(step)
                const limit = bindingPhrase(step)
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggle(index)}
                    className={`grid w-full grid-cols-[1fr_auto] gap-x-3 px-3 py-1 text-left ${limit ? BINDING_LINE : 'hover:bg-muted/40'}`}
                  >
                    <span>
                      {step.label}
                      {limit && <span className={`${BINDING_TEXT} ml-2 text-xs`}>{limit}</span>}
                    </span>
                    <span
                      className={
                        stepIsNegativeMoney(step) ? `tabular-nums ${NEGATIVE_INK}` : 'tabular-nums'
                      }
                    >
                      {stepValue(step)}
                    </span>
                    {expanded.has(index) && (
                      <span className="text-muted-foreground col-span-2 text-xs">
                        {stepHow(step, trace)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
