import { useMemo, useState, type ReactNode } from 'react'

import type { ApiAidHouseholdRequest } from '../../../types/api-types'
import { NEGATIVE_INK } from '../kit/aidStyles'
import type { AidView } from '../kit/asOf'
import { BINDING_TEXT } from '../kit/kitStyles'
import { Receipt } from '../kit/Receipt'
import {
  bindingPhrase,
  receiptSections,
  stepHow,
  stepIsNegativeMoney,
  stepValue,
  type AidTraceStep,
  type ReceiptSection,
} from '../kit/receiptModel'
import { opensByItself } from './householdModel'
import {
  HH_DIFF_ADD,
  HH_DIFF_DEL,
  HH_LINE_CHANGED,
  HH_LINE_GONE,
  HH_LINE_TAG,
  HH_NOTE,
  HH_RECEIPT_COLUMNS,
  HH_RECEIPT_LINE,
  HH_RECEIPT_SECTION,
  HH_RECEIPT_TOTAL,
  HH_SEG,
  HH_SEG_BUTTON,
  HH_SEG_NAME,
  HH_SEG_NAME_ON,
  HH_SEG_OFF,
  HH_SEG_ON,
} from './householdStyles'
import {
  diffMarks,
  receiptVersions,
  versionCompareWords,
  type LineDiff,
  type LineMark,
  type ReceiptVersion,
} from './receiptVersions'

const MARK_CLASS: Readonly<Record<LineMark, string>> = {
  same: 'hover:bg-muted/40',
  changed: HH_LINE_CHANGED,
  new: HH_LINE_CHANGED,
  gone: HH_LINE_GONE,
  // A posted round's worked-out line: muted, since the lock line is what counts.
  superseded: 'text-muted-foreground hover:bg-muted/40',
}

/** The value as this version has it, struck and replaced where it moved (the weekend diff grammar). */
function LineValue({ step, diff }: { step: AidTraceStep; diff: LineDiff }) {
  const now = stepValue(step)
  if (diff.mark === 'gone') return <del className={HH_DIFF_DEL}>{diff.was}</del>
  if (diff.mark === 'changed')
    return (
      <>
        <del className={HH_DIFF_DEL}>{diff.was}</del>
        <ins className={`${HH_DIFF_ADD} ml-1.5`}>{now}</ins>
      </>
    )
  if (diff.mark === 'new') return <ins className={HH_DIFF_ADD}>{now}</ins>
  return diff.mark === 'same' && stepIsNegativeMoney(step) ? (
    <span className={NEGATIVE_INK}>{now}</span>
  ) : (
    <>{now}</>
  )
}

function Line({
  step,
  diff,
  trace,
  total = false,
}: {
  step: AidTraceStep
  diff: LineDiff
  trace: readonly AidTraceStep[]
  total?: boolean
}) {
  const [how, setHow] = useState(false)
  const limit = diff.mark === 'gone' ? null : bindingPhrase(step)
  return (
    <button
      type="button"
      data-mark={diff.mark}
      onClick={() => setHow(!how)}
      className={`${total ? HH_RECEIPT_TOTAL : HH_RECEIPT_LINE} ${MARK_CLASS[diff.mark]}`}
    >
      <span>
        {step.label}
        {diff.mark === 'new' && (
          <span className={`${HH_LINE_TAG} text-green-700 dark:text-green-300`}>new</span>
        )}
        {diff.mark === 'gone' && (
          <span className={`${HH_LINE_TAG} text-red-600 dark:text-red-400`}>gone</span>
        )}
      </span>
      <span className="text-right whitespace-nowrap tabular-nums">
        <LineValue step={step} diff={diff} />
      </span>
      {limit && (
        <span className={`${BINDING_TEXT} col-span-2 text-[11px] leading-tight font-normal`}>
          {limit}
        </span>
      )}
      {how && (
        <span className="text-muted-foreground col-span-2 text-xs font-normal">
          {stepHow(step, trace)}
        </span>
      )}
    </button>
  )
}

/** The mock's three columns: Income and Tier | Cost and Round 1 | the later rounds and the total. */
const FIRST_COLUMNS: ReadonlyArray<readonly string[]> = [
  ['Income', 'Tier'],
  ['Cost', 'Round 1'],
]

/**
 * One version laid out across the card (the mock's .hrc), every line marked against the version
 * before it. A line only the earlier version had stays, struck, so nothing vanishes unmarked.
 */
function ReceiptColumns({
  trace,
  prev,
  marks,
}: {
  trace: readonly AidTraceStep[]
  prev: readonly AidTraceStep[] | null
  marks: ReadonlyMap<string, LineDiff>
}) {
  const gone = (prev ?? []).filter((step) => marks.get(step.key)?.mark === 'gone')
  const sections = receiptSections([...trace, ...gone])
  const placed = new Set(FIRST_COLUMNS.flat())
  const columns: ReceiptSection[][] = [
    ...FIRST_COLUMNS.map((names) => sections.filter((s) => names.includes(s.name))),
    sections.filter((s) => !placed.has(s.name)),
  ]
  const diffOf = (step: AidTraceStep): LineDiff =>
    marks.get(step.key) ?? { mark: 'same', was: null }
  const contextOf = (step: AidTraceStep) => (gone.includes(step) ? (prev ?? []) : trace)
  return (
    <div className={HH_RECEIPT_COLUMNS}>
      {columns.map((column, index) => (
        <div key={index} className="min-w-0 pt-1 pb-1.5">
          {column.map((section) => {
            // The total closes the last column as its own bold line (the mock's .tot), unheaded.
            const steps = section.steps.filter((step) => step.key !== 'total')
            const total = section.steps.find((step) => step.key === 'total')
            return (
              <div key={section.name}>
                {steps.length > 0 && (
                  <>
                    <div className={HH_RECEIPT_SECTION}>{section.name}</div>
                    {steps.map((step) => (
                      <Line
                        key={step.key}
                        step={step}
                        diff={diffOf(step)}
                        trace={contextOf(step)}
                      />
                    ))}
                  </>
                )}
                {total && <Line step={total} diff={diffOf(total)} trace={contextOf(total)} total />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function VersionHead({
  versions,
  selected,
  prev,
  marks,
  pick,
}: {
  versions: readonly ReceiptVersion[]
  selected: ReceiptVersion
  prev: ReceiptVersion | null
  marks: ReadonlyMap<string, LineDiff>
  pick: (key: string) => void
}) {
  const words = versionCompareWords(marks)
  let compare: ReactNode
  if (prev !== null) {
    compare = (
      <>
        Compared with <b className="text-foreground">{prev.name}</b>: {words}
        {words !== 'nothing changed' && (
          <>
            {' · '}
            <del className={HH_DIFF_DEL}>old</del> <ins className={HH_DIFF_ADD}>new</ins>
          </>
        )}
      </>
    )
  } else {
    compare =
      versions.length > 1 ? 'The first version: nothing before it to compare' : 'One version so far'
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {versions.length > 1 && (
        <div className={HH_SEG}>
          {versions.map((version) => {
            const on = version === selected
            return (
              <button
                key={version.key}
                type="button"
                // A test handle (the switcher is queried by which version is picked).
                aria-pressed={on}
                onClick={() => pick(version.key)}
                className={`${HH_SEG_BUTTON} ${on ? HH_SEG_ON : HH_SEG_OFF}`}
              >
                <b className={on ? HH_SEG_NAME_ON : HH_SEG_NAME}>{version.name}</b>
                {version.date !== null && <span>{version.date}</span>}
                {version.total !== null && <span className="tabular-nums">{version.total}</span>}
              </button>
            )
          })}
        </div>
      )}
      <span className={`${HH_NOTE} ml-auto text-xs`}>{compare}</span>
    </div>
  )
}

/**
 * A request card's receipt (round 3; household-v3.html section 1 (B), the owner's pick): one
 * receipt with a switcher across its versions, each round as posted then the live one, the current
 * one picked. Each version diffs inline against the one before it, from the receipts in the
 * payload. Folded under its sentence (D34), it opens by itself on a hold, on the current version.
 */
export function ReceiptVersions({
  request,
  view,
}: {
  request: ApiAidHouseholdRequest
  view: AidView
}) {
  const versions = useMemo(() => receiptVersions(request.receipts), [request.receipts])
  // The picked version's key; null (or a key a refetch dropped) is the current one.
  const [picked, setPicked] = useState<string | null>(null)
  const at = versions.findIndex((version) => version.key === picked)
  const index = at === -1 ? versions.length - 1 : at
  const selected = versions[index]
  const prev = index > 0 ? (versions[index - 1] ?? null) : null
  const marks = useMemo(
    () => (selected ? diffMarks(prev?.receipt.trace ?? null, selected.receipt.trace) : new Map()),
    [selected, prev]
  )
  if (selected === undefined) return null
  return (
    <Receipt
      trace={selected.receipt.trace}
      label={selected.receipt.label}
      view={view}
      folded
      openByItself={opensByItself(request)}
      versions={{
        showWords:
          versions.length > 1
            ? `Show the receipt · ${String(versions.length)} versions ▾`
            : 'Show the receipt ▾',
        head: (
          <VersionHead
            versions={versions}
            selected={selected}
            prev={prev}
            marks={marks}
            pick={setPicked}
          />
        ),
        lines: (
          <ReceiptColumns
            trace={selected.receipt.trace}
            prev={prev?.receipt.trace ?? null}
            marks={marks}
          />
        ),
        // Folded, the card shows the current receipt's sentence again.
        onFold: () => setPicked(null),
      }}
    />
  )
}
