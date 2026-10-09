import { useState } from 'react'
import { Link } from 'react-router'

import type {
  ApiAidDevelopmentGroup,
  ApiAidFundingSource,
  ApiAidSourceRow,
} from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN2, CS_LINK, CS_PANEL_HEAD, CS_PANEL_RULE, CS_PMETA } from '../kit/csType'
import { ClassifyEditor } from './ClassifyEditor'
import { GrantorField } from './GrantorField'
import { GroupEditor } from './GroupEditor'
import { sourceFamilyWords } from './fundersModel'
import {
  canNameGrantor,
  funderWords,
  grantorWords,
  isUnclassified,
  keyWords,
  lastChangeWords,
  programWords,
} from './sourcesModel'

/** Two panels side by side, in the To place opened row's grammar (ToPlaceOpenRow, R-A). */
const TWO_PANELS = 'grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-stretch text-sm'
const LEFT_PANEL = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const RIGHT_PANEL = 'flex min-w-0 flex-col gap-2 pl-4'

type Mode = 'none' | 'classify' | 'group' | 'grantor'

export interface SourceAccess {
  /** `rules`: Classify… / Edit…. */
  readonly rules: boolean
  /** `rules` or `funding_sources`: Set a Group… (the reporting group and the incentive flag). */
  readonly group: boolean
  /** `grantors`: the description's grantor. */
  readonly grantors: boolean
}

/**
 * An opened source (owner ruling A's opened row, as the Requests grid and To place draw it): left,
 * what the registry says about the description; right, the edits each permission allows, one open
 * at a time, marked `data-aid-editor` so the table's ↑/↓ stand aside while it is typed in.
 */
export function SourceOpenRow({
  row,
  rows,
  funding,
  groups,
  groupWarning,
  names,
  year,
  view,
  access,
  onDone,
}: {
  row: ApiAidSourceRow
  rows: readonly ApiAidSourceRow[]
  /** Its Funding sources row (outside and incentive sources only), joined on `source_id`. */
  funding: ApiAidFundingSource | undefined
  groups: readonly ApiAidDevelopmentGroup[]
  groupWarning: string
  names: Readonly<Record<string, string>>
  year: number
  view: AidView
  access: SourceAccess
  onDone: (words: string) => void
}) {
  const [mode, setMode] = useState<Mode>('none')
  const close = () => setMode('none')
  const done = (words: string) => {
    setMode('none')
    onDone(words)
  }
  const unclassified = isUnclassified(row)
  const programs = programWords(row.implied_program_families, names)
  const change = lastChangeWords(row.last_change)
  const canGroup = access.group && funding !== undefined && funding.editable !== false
  const canGrantor = access.grantors && canNameGrantor(row)
  // Anyone who may change something gets the right panel (the test pins it for a grantors-only
  // person on a camp-aid row: an empty "What you can change", no buttons); read-only sees the left alone.
  // R3-12: draw the right panel only when it holds something: an action this person may take, or
  // the "classify it first" line. A grantors-only person on a camp row sees the left panel alone.
  const editing = access.rules || canGroup || canGrantor || (access.grantors && unclassified)

  const left = (
    <div data-panel="source" className={editing ? LEFT_PANEL : 'flex min-w-0 flex-col gap-1'}>
      <p className={CS_PANEL_HEAD}>This description</p>
      <p>
        {unclassified
          ? 'Unclassified: new from the ledger sync. It counts as an outside grant until it is classified.'
          : `${funderWords(row.funder_type) || keyWords(row.funder_type)} · source family ${sourceFamilyWords(row)}`}
      </p>
      <p className={CS_PMETA}>
        {programs === '' ? 'It names no program.' : `Programs it funds: ${programs}`}
      </p>
      {row.grantor_key !== '' && (
        <p className={CS_PMETA}>
          {'Funder: '}
          <Link
            className={CS_LINK}
            to={aidHref('/aid/money/funders', view, { funder: row.grantor_key })}
          >
            {grantorWords(row)}
          </Link>
        </p>
      )}
      <p className={CS_PMETA}>{row.note === '' ? 'No note.' : `Note: ${row.note}`}</p>
      {change !== '' && <p className={CS_PMETA}>{`Last change: ${change}`}</p>}
    </div>
  )
  if (!editing) return <div className="text-sm">{left}</div>

  return (
    <div className={TWO_PANELS}>
      {left}
      <div
        data-panel="edit"
        className={RIGHT_PANEL}
        {...(mode === 'none' ? {} : { 'data-aid-editor': '' })}
      >
        {mode === 'none' && (
          <>
            <p className={CS_PANEL_HEAD}>What you can change</p>
            <div className="flex flex-wrap gap-2">
              {access.rules && (
                <button type="button" className={CS_BTN2} onClick={() => setMode('classify')}>
                  {unclassified ? 'Classify…' : 'Edit…'}
                </button>
              )}
              {canGroup && (
                <button type="button" className={CS_BTN2} onClick={() => setMode('group')}>
                  Set a Group…
                </button>
              )}
              {canGrantor && (
                <button type="button" className={CS_BTN2} onClick={() => setMode('grantor')}>
                  {row.grantor_key === '' ? 'Map a Funder…' : 'Change the Funder…'}
                </button>
              )}
            </div>
            {access.grantors && unclassified && (
              <p className={CS_PMETA}>
                Classify this description first: only an outside grant names a grantor.
              </p>
            )}
          </>
        )}
        {mode === 'classify' && (
          <ClassifyEditor
            row={row}
            rows={rows}
            names={names}
            groupWarning={groupWarning}
            onCancel={close}
            onDone={done}
          />
        )}
        {mode === 'group' && funding !== undefined && (
          <GroupEditor
            row={row}
            year={year}
            source={funding}
            groups={groups}
            onCancel={close}
            onDone={done}
          />
        )}
        {mode === 'grantor' && (
          <GrantorField row={row} view={view} onCancel={close} onDone={done} />
        )}
      </div>
    </div>
  )
}
