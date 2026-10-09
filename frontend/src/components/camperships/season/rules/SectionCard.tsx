import { useState, type ReactNode } from 'react'

import type {
  ApiAidFieldChange,
  ApiAidGroup,
  ApiAidRulesSection,
  ApiAidValidationIssue,
} from '../../../../types/api-types'
import { DefRef } from '../../kit/DefinitionNotes'
import {
  CS_AMBER_NOTE,
  CS_BTN_SM,
  CS_CARD,
  CS_CARD_HEADING,
  CS_LINK_SM,
  CS_PILL,
  CS_SMALL,
} from '../../kit/csType'
import { CARD_SPECS, type CardRow } from './rulesCards'
import { ChangedSince } from './ChangedSince'
import { CardRows, ReadOnlyStrip } from './CardRows'
import { CardTables, type CellControl } from './CardTables'
import {
  changeWords,
  isNote,
  issueWords,
  SECTION_TITLES,
  type RulesNames,
  type StatusWords,
} from './rulesModel'

export function SectionCardHead({
  section,
  title,
  status,
  issues,
  canEdit,
  onEdit,
  extra,
  list,
}: {
  section: ApiAidRulesSection
  title: string
  status: StatusWords
  issues: readonly ApiAidValidationIssue[]
  canEdit: boolean
  onEdit: () => void
  extra?: ReactNode
  /**
   * A card that opens this head's list from elsewhere too (the tier grid's cell ⚠) holds it: what it shows (null:
   * closed) and the chip's click. Without it the chip alone opens and closes the list of every issue.
   */
  list?: {
    readonly shown: readonly ApiAidValidationIssue[] | null
    readonly onChip: () => void
  }
}) {
  const [full, setFull] = useState(false)
  const [listed, setListed] = useState(false)
  // Notes live on their cells (B3): the chip counts and lists the errors and warnings only.
  const counted = issues.filter((i) => !isNote(i))
  const shown = list !== undefined ? list.shown : listed ? counted : null
  const errors = counted.filter((i) => i.severity === 'error').length
  const words = issueWords(errors, counted.length - errors)
  return (
    <>
      <div
        data-testid={`card-head-${section}`}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
      >
        <h3 className={CS_CARD_HEADING}>{title}</h3>
        <span className={CS_PILL[status.tone]}>{status.pill}</span>
        {status.pill === 'Locked' && <DefRef n={1} />}
        {(status.meta !== '' || status.note !== null) && (
          <button
            type="button"
            data-testid={`card-meta-${section}`}
            className={`${CS_SMALL} max-w-[40rem] min-w-0 cursor-pointer text-left ${full ? 'whitespace-normal' : 'truncate'}`}
            onClick={() => setFull(!full)}
          >
            {status.meta}
            {status.note !== null && (
              <>
                {' · Notes: '}
                <b className="text-foreground font-semibold">{status.note}</b>
              </>
            )}
          </button>
        )}
        {words !== null && (
          <button
            type="button"
            className={`${errors > 0 ? CS_PILL.red : CS_PILL.amber} cursor-pointer`}
            onClick={() => (list !== undefined ? list.onChip() : setListed(!listed))}
          >
            {words}
          </button>
        )}
        <span className="ml-auto flex items-baseline gap-2">
          {extra}
          {canEdit && (
            <button type="button" className={CS_BTN_SM} onClick={onEdit}>
              Edit…
            </button>
          )}
        </span>
      </div>
      {shown !== null && shown.length > 0 && (
        <ol className="mt-1">
          {shown.map((issue, i) => (
            <li
              key={`${issue.code}:${issue.path}:${String(i)}`}
              data-testid="card-issue"
              className={CS_AMBER_NOTE}
            >
              {issue.message}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

/** A card's body (spec §6.2 D–E): the changed line, its lead, its tables, its rows, its read-only strip. The editor draws it with boxes. */
export function CardBody({
  section,
  content,
  approved,
  approvedVersion,
  names,
  changes,
  details,
  dependentsMode = null,
  grantsHref,
  groups,
  rowControl,
  cellControl,
}: {
  section: ApiAidRulesSection
  content: Record<string, unknown>
  approved: Record<string, unknown> | null
  approvedVersion?: number | null | undefined
  names: RulesNames
  changes: readonly ApiAidFieldChange[]
  details: boolean
  dependentsMode?: string | null
  grantsHref?: string | undefined
  /** The rules' pools in their order, for the equity weights' columns. */
  groups?: readonly ApiAidGroup[] | undefined
  /** In the editor: the box for an editable row, and for an editable table cell. */
  rowControl?: ((row: CardRow) => ReactNode) | undefined
  cellControl?: CellControl | undefined
}) {
  const spec = CARD_SPECS[section]
  return (
    <>
      <ChangedSince version={approvedVersion} lines={changes.map((c) => changeWords(c, names))} />
      {spec?.lead && <p className={`${CS_SMALL} mt-1`}>{spec.lead}</p>}
      <CardTables
        section={section}
        content={content}
        approved={approved}
        names={names}
        details={details}
        dependentsMode={dependentsMode}
        grantsHref={grantsHref}
        groups={groups}
        control={cellControl}
      />
      {spec !== undefined && (
        <CardRows
          spec={spec}
          content={content}
          approved={approved}
          names={names}
          control={rowControl}
        />
      )}
      {spec !== undefined && spec.readOnly.length > 0 && (
        <ReadOnlyStrip items={spec.readOnly} content={content} names={names} />
      )}
    </>
  )
}

export function SectionCard({
  section,
  content,
  approved,
  approvedVersion,
  names,
  status,
  changes,
  issues,
  canEdit,
  onEdit,
  dependentsMode = null,
  grantsHref,
  groups,
  children,
}: {
  section: ApiAidRulesSection
  content: Record<string, unknown>
  approved: Record<string, unknown> | null
  approvedVersion?: number | null | undefined
  names: RulesNames
  status: StatusWords
  changes: readonly ApiAidFieldChange[]
  issues: readonly ApiAidValidationIssue[]
  canEdit: boolean
  onEdit: () => void
  /** income.dependents_mode from the shown document: the equity table's Dependents note reads it. */
  dependentsMode?: string | null
  /** Money › Funders with the view: the named fund's row links there (owner 10-06 (c)). */
  grantsHref?: string | undefined
  /** The rules' pools in their order, for the equity weights' columns. */
  groups?: readonly ApiAidGroup[] | undefined
  children?: ReactNode
}) {
  const [details, setDetails] = useState(false)
  const extra =
    section === 'equity' && children === undefined ? (
      <button type="button" className={CS_LINK_SM} onClick={() => setDetails(!details)}>
        {details ? 'Hide details' : 'Show details'}
      </button>
    ) : null
  return (
    <section id={`card-${section}`} data-card={section} className={CS_CARD}>
      <SectionCardHead
        section={section}
        title={SECTION_TITLES[section]}
        status={status}
        issues={issues}
        canEdit={canEdit && children === undefined}
        onEdit={onEdit}
        extra={extra}
      />
      {children ?? (
        <CardBody
          section={section}
          content={content}
          approved={approved}
          approvedVersion={approvedVersion}
          names={names}
          changes={changes}
          details={details}
          dependentsMode={dependentsMode}
          grantsHref={grantsHref}
          groups={groups}
        />
      )}
    </section>
  )
}
