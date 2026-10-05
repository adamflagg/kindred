import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { NEGATIVE_INK } from './aidStyles'
import { BINDING_LINE, BINDING_TEXT } from './kitStyles'
import type { AidView } from './asOf'
import type { ReceiptLabelOut } from '../../../types/api-generated'
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

/** The label, with its rules version linked to Season › Rules (D76). The household card draws it too. */
export function ReceiptLabelLine({
  label,
  view,
}: {
  label: ReceiptLabelOut
  view?: AidView | undefined
}) {
  const words = receiptRulesWords(label)
  const full = receiptLabel(label)
  const at = full.indexOf(words)
  return (
    <div className="text-muted-foreground text-[11.5px]">
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
  label: ReceiptLabelOut
  /** The page's season and as-of, which the rules link carries (Decision 9). */
  view?: AidView | undefined
  /** The household page folds receipts under their sentence (D34). */
  folded?: boolean | undefined
  /** …except on a hold (D34), including one that arrives later. */
  openByItself?: boolean | undefined
  /**
   * The household page's receipt versions (round 3; household-v3.html section 1 (B)): when given, the
   * fold toggle reads `showWords`, `head` (the version switcher) heads the opened receipt above its
   * label, `lines` replaces the line box, and `onFold` hears the receipt fold. Absent, nothing changes.
   */
  versions?: ReceiptVersionsSlot | undefined
}

export interface ReceiptVersionsSlot {
  readonly showWords: string
  readonly head: ReactNode
  readonly lines: ReactNode
  readonly onFold?: (() => void) | undefined
}

/** K3: 14px at line-height 1.55, padding 8/12, a 30% muted tint, radius 10. */
const SENTENCE_BOX = 'bg-muted/30 rounded-[10px] px-3 py-2 text-sm leading-[1.55]'
/** K4: the fold toggle, forest-700 at 12.5/600 (the household mock's .fold). */
const FOLD_TOGGLE =
  'text-forest-700 dark:text-forest-300 cursor-pointer text-[12.5px] font-semibold'

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
  versions,
}: ReceiptProps) {
  const [open, setOpen] = useState(!folded || openByItself)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const sections = useMemo(() => receiptSections(trace), [trace])

  // Ruling 2026-10-01 (plan review): a hold that arrives after the first render opens it
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
      {versions !== undefined && open && versions.head}
      <ReceiptLabelLine label={label} view={view} />
      {/* K3: the sentence in a tinted rounded box (receipt.html D; the household mock's .sentence). */}
      <ReceiptSentence trace={trace} className={SENTENCE_BOX} />
      {folded && (
        <button
          type="button"
          className={FOLD_TOGGLE}
          onClick={() => {
            if (open) versions?.onFold?.()
            setOpen(!open)
          }}
        >
          {open
            ? 'Hide the receipt ▴'
            : (versions?.showWords ??
              `Show the receipt (${String(receiptLineCount(trace))} lines) ▾`)}
        </button>
      )}
      {versions !== undefined && (!folded || open) && versions.lines}
      {versions === undefined && (!folded || open) && (
        // K4: the opened lines stay near their labels (capped narrower than the mock's ~640px, since
        // these lines have no note column), never the page's full width.
        <div className="border-border divide-border max-w-[520px] divide-y rounded-lg border text-[13px]">
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
