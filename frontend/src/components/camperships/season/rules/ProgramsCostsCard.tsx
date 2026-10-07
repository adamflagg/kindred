/**
 * Rules › Programs and costs (spec §5; programs-costs-v3, Layout A): one card over the `programs` and `cost`
 * sections, drawn by group. Read only here; the editor (`ProgramsCostsEditor`) arrives through the `editor` slot.
 * The season's sessions and the lodging board's cancellations come in as props: `RulesTab` reads them (one place
 * for the hooks, one place the tests mock).
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'

import type { CatalogSession } from '../../../../hooks/camperships/useAidSessionCatalog'
import type { ApiAidGroup, ApiAidValidationIssue } from '../../../../types/api-types'
import { CS_CARD, CS_META, CS_PILL, CS_SMALL } from '../../kit/csType'
import { SectionCardHead } from './SectionCard'
import { MIN_COLUMN } from './programsCostsFlow'
import { ROW, flowItems, useBoxWidth } from './programsCostsLayout'
import {
  NOT_OPEN,
  agWords,
  cardView,
  changesSince,
  docOf,
  groupPill,
  noGroupCount,
  noGroupPins,
  priceWords,
  pricePins,
  type CardGroup,
  type CardRow,
  type ProgramsCostsDoc,
} from './programsCostsModel'
import { isNote, type StatusWords } from './rulesModel'
import { Flow, FormulaLine, PerPersonHead, RowName } from './ProgramsCostsParts'

interface Sections {
  programs: unknown
  cost: unknown
  budget: unknown
}

export interface ProgramsCostsCardProps {
  /** The shown document: the draft, or the approved sections. */
  readonly document: Sections
  /** The version in effect, for "Changed since"; null on the registrar's read. */
  readonly approved: Sections | null
  readonly approvedVersion: number | null
  readonly groups: readonly ApiAidGroup[]
  /** The season's sessions (undefined while they load) and the lodging board's cancellations. */
  readonly sessions: readonly CatalogSession[] | undefined
  readonly cancelled?: ReadonlySet<number> | undefined
  /** The less settled of the two sections (`combinedStatus`). */
  readonly status: StatusWords
  /** Both sections' issues; none on the registrar's read. */
  readonly issues: readonly ApiAidValidationIssue[]
  readonly canEdit: boolean
  readonly onEdit: () => void
  readonly editor?: ReactNode
}

const NO_SESSIONS: ReadonlySet<number> = new Set()

/** Draft beats In effect beats Locked (spec §5.2 B). A tie keeps the first section's words: they carry one stamp, since the card saves both together. */
// eslint-disable-next-line react-refresh/only-export-components -- the plan's test imports it from the card
export function combinedStatus(programs: StatusWords, cost: StatusWords): StatusWords {
  const rank = (w: StatusWords) =>
    w.pill === 'Locked' ? 0 : w.pill === 'In effect' ? 1 : w.pill.startsWith('Draft') ? 2 : 3
  return rank(cost) > rank(programs) ? cost : programs
}

// ── Read-only rows ─────────────────────────────────────────────────────────────

function Fig({
  value,
  was,
  amber,
  changed,
  wide,
}: {
  value: string | null
  was: string | null
  amber: boolean
  changed: boolean
  wide?: boolean
}) {
  const box = `${wide ? 'min-w-16' : 'min-w-[60px]'} shrink-0 text-right font-medium tabular-nums whitespace-nowrap`
  if (changed) {
    return (
      <span className={box}>
        <span className="rounded-[3px] bg-amber-100/70 px-[3px] font-bold text-amber-700 dark:bg-amber-900/45 dark:text-amber-300">
          {priceWords(value)}
        </span>
        <span className={`${CS_META} ml-1 text-amber-700 dark:text-amber-300`}>
          {`was ${priceWords(was)}`}
        </span>
      </span>
    )
  }
  return value === null ? (
    <span
      className={`${box} text-xs ${amber ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted-foreground font-normal'}`}
    >
      No price yet
    </span>
  ) : (
    <span className={box}>{priceWords(value)}</span>
  )
}

function ReadRow({ row, was, amber }: { row: CardRow; was: CardRow | undefined; amber: boolean }) {
  const differs = (a: string | null, b: string | null | undefined) =>
    was !== undefined && a !== (b ?? null)
  return (
    <div data-testid={`pc-row-${String(row.session.cmId)}`} className={ROW}>
      <RowName row={row} />
      {row.kind === 'per_person' ? (
        <>
          <Fig
            value={row.standard}
            was={was?.standard ?? null}
            amber={amber}
            changed={differs(row.standard, was?.standard)}
            wide
          />
          <Fig
            value={row.infant}
            was={was?.infant ?? null}
            amber={amber}
            changed={differs(row.infant, was?.infant)}
            wide
          />
        </>
      ) : row.kind === 'typed' ? (
        <span className={`${CS_META} whitespace-nowrap`}>typed on the request</span>
      ) : (
        <Fig
          value={row.tuition}
          was={was?.tuition ?? null}
          amber={amber}
          changed={differs(row.tuition, was?.tuition)}
        />
      )}
    </div>
  )
}

const FOLD = 'mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground'
const LIST = 'basis-full pl-4 text-[13px] text-foreground'

function Names({ children }: { children: readonly ReactNode[] }) {
  return (
    <>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground mx-1.5">·</span>}
          {child}
        </Fragment>
      ))}
    </>
  )
}

export function ProgramsCostsCard(p: ProgramsCostsCardProps) {
  const [boxRef, width] = useBoxWidth()
  const [folds, setFolds] = useState<ReadonlySet<string>>(new Set())
  const [listed, setListed] = useState<readonly ApiAidValidationIssue[] | null>(null)
  const cancelled = p.cancelled ?? NO_SESSIONS
  const doc = useMemo(() => docOf(p.document), [p.document])
  const approvedDoc = useMemo<ProgramsCostsDoc | null>(
    () => (p.approved === null ? null : docOf(p.approved)),
    [p.approved]
  )
  const { sessions } = p
  const view = useMemo(
    () => (sessions === undefined ? null : cardView(doc, p.groups, sessions, cancelled)),
    [doc, p.groups, sessions, cancelled]
  )
  const wasView = useMemo(
    () =>
      approvedDoc === null || sessions === undefined
        ? null
        : cardView(approvedDoc, p.groups, sessions, NO_SESSIONS),
    [approvedDoc, p.groups, sessions]
  )
  const changes = useMemo(
    () =>
      approvedDoc === null || sessions === undefined
        ? []
        : changesSince(approvedDoc, doc, p.groups, sessions),
    [approvedDoc, doc, p.groups, sessions]
  )
  const pins = useMemo(() => pricePins(p.issues), [p.issues])
  const noGroup = useMemo(() => noGroupPins(p.issues), [p.issues])

  const toggle = (key: string) =>
    setFolds((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const counted = p.issues.filter((i) => !isNote(i))
  // The pills' lists: the group's price warnings, or the sessions in no group.
  const listFor = (ids: ReadonlySet<number>, match: (issue: ApiAidValidationIssue) => boolean) =>
    setListed(counted.filter((i) => match(i) && (i.session_cm_ids ?? []).some((id) => ids.has(id))))

  const was = new Map(
    [
      ...(wasView?.groups.flatMap((g) => [...g.running, ...g.notRunning]) ?? []),
      ...(wasView?.notOpen ?? []),
    ].map((r) => [r.session.cmId, r] as const)
  )
  const wasNotRunning = new Set(
    wasView?.groups.flatMap((g) => g.notRunning.map((r) => r.session.cmId))
  )
  const status =
    approvedDoc !== null && p.status.pill.startsWith('Draft')
      ? {
          ...p.status,
          pill:
            changes.length === 0
              ? 'Draft'
              : `Draft · ${String(changes.length)} ${changes.length === 1 ? 'change' : 'changes'}`,
        }
      : p.status

  const group = (g: CardGroup) => {
    const pill = groupPill(g, pins)
    const partly = pill !== 'No prices yet'
    const hasPerPerson = g.running.some((r) => r.kind === 'per_person')
    const items = flowItems(g.running, g.subLabels, <PerPersonHead />, (row) => (
      <ReadRow
        row={row}
        was={was.get(row.session.cmId)}
        amber={pins.has(row.session.cmId) && partly}
      />
    ))
    const key = `nr:${g.pool}`
    return (
      <div
        key={g.pool}
        data-testid={`pc-group-${g.pool}`}
        className="border-border/70 [&+&]:mt-2 [&+&]:border-t [&+&]:pt-1.5"
      >
        <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <b data-testid="pc-group-name" className="text-foreground text-[13px] font-bold">
            {g.label}
          </b>
          <span>{`· ${String(g.running.length)} running`}</span>
          {pill !== null && (
            <button
              type="button"
              className={`${CS_PILL.amber} cursor-pointer self-center`}
              onClick={() =>
                listFor(
                  new Set(g.running.map((r) => r.session.cmId)),
                  (i) => pricePins([i]).size > 0
                )
              }
            >
              {pill}
            </button>
          )}
          {g.agCount > 0 && <span>{`· ${agWords(g.agCount)}`}</span>}
        </div>
        {hasPerPerson && <FormulaLine cutoff={doc.cost.infant_age_cutoff_months} />}
        {items.length > 0 && <Flow items={items} width={width} minColumn={MIN_COLUMN.read} />}
        {g.notRunning.length > 0 && (
          <div className={FOLD}>
            <button type="button" className="font-semibold" onClick={() => toggle(key)}>
              {`${folds.has(key) ? '▾' : '▸'} Not running (${String(g.notRunning.length)})`}
            </button>
            {folds.has(key) && (
              <span className={LIST}>
                <Names>
                  {g.notRunning.map((r) => (
                    <span key={r.session.cmId} data-testid={`pc-off-${String(r.session.cmId)}`}>
                      {r.session.name}
                      {wasView !== null && !wasNotRunning.has(r.session.cmId) && (
                        <span className={`${CS_META} ml-1 text-amber-700 dark:text-amber-300`}>
                          newly
                        </span>
                      )}
                    </span>
                  ))}
                </Names>
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const notOpenLine = (rows: readonly CardRow[]) => {
    const n = noGroupCount({ groups: [], notOpen: rows }, noGroup)
    return (
      <div className={FOLD}>
        <button type="button" className="font-semibold" onClick={() => toggle('na')}>
          {`${folds.has('na') ? '▾' : '▸'} Not open to aid (${String(rows.length)})`}
        </button>
        {n > 0 && (
          <button
            type="button"
            className={`${CS_PILL.red} cursor-pointer self-center`}
            onClick={() =>
              listFor(new Set(rows.map((r) => r.session.cmId)), (i) => noGroupPins([i]).size > 0)
            }
          >
            {`${String(n)} in no group`}
          </button>
        )}
        {folds.has('na') && (
          <span className={LIST}>
            <Names>
              {rows.map((r) => {
                const old = was.get(r.session.cmId)
                return (
                  <span key={r.session.cmId} data-testid={`pc-noopen-${String(r.session.cmId)}`}>
                    {r.session.name}
                    {old !== undefined && old.group !== NOT_OPEN && (
                      <span className={`${CS_META} ml-1 text-amber-700 dark:text-amber-300`}>
                        moved here
                      </span>
                    )}
                    {noGroup.has(r.session.cmId) && (
                      <span className={`${CS_PILL.red} ml-1.5`}>in no group</span>
                    )}
                  </span>
                )
              })}
            </Names>
          </span>
        )}
      </div>
    )
  }

  return (
    <section id="card-programs_costs" data-card="programs_costs" className={CS_CARD}>
      <SectionCardHead
        section="programs"
        title="Programs and costs"
        status={status}
        issues={p.issues}
        canEdit={p.canEdit && p.editor === undefined}
        onEdit={p.onEdit}
        list={{
          shown: listed,
          onChip: () => setListed((prev) => (prev === null ? counted : null)),
        }}
      />
      {p.editor !== undefined ? (
        p.editor
      ) : (
        <div ref={boxRef} className="mt-1">
          {changes.length > 0 && (
            <p className={CS_SMALL}>
              {`Changed since v${String(p.approvedVersion ?? '')}: `}
              {changes.map((c, i) => (
                <Fragment key={`${c.lead}:${String(i)}`}>
                  {i > 0 && ' · '}
                  {c.was === null ? (
                    <>
                      {c.lead}: <b className="text-foreground font-semibold">{c.now}</b>
                    </>
                  ) : (
                    <>
                      {c.lead}: {c.was} → <b className="text-foreground font-semibold">{c.now}</b>
                    </>
                  )}
                </Fragment>
              ))}
            </p>
          )}
          {view === null ? (
            <p className={`${CS_SMALL} mt-1`}>Loading the season&apos;s sessions…</p>
          ) : (
            <>
              {view.groups.map(group)}
              {view.notOpen.length > 0 && <div className="mt-2">{notOpenLine(view.notOpen)}</div>}
            </>
          )}
        </div>
      )}
    </section>
  )
}
