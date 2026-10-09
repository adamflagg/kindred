import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidGrantRow } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_LINK, CS_LINK_SM, CS_PANEL_HEAD, CS_PANEL_RULE, CS_PMETA } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import {
  basisWords,
  didntApply,
  funderLink,
  sessionWords,
  shareWords,
  standingCsv,
} from './registerModel'

/** The opened row's three panels (To place's `ToPlaceOpenRow` grammar, owner ruling A). */
const THREE_PANELS =
  'grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)] items-stretch text-sm'
const PANEL = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const MIDDLE = `flex min-w-0 flex-col gap-1 border-r px-4 ${CS_PANEL_RULE}`
const LAST = 'flex min-w-0 flex-col gap-1.5 pl-4'

const NO_UNMAPPED: ReadonlyArray<{ source_id: string; description: string }> = []

/** Why a row offsets no request, in a sentence (the cell's short words, said in full). */
function noShareWords(
  row: ApiAidGrantRow,
  needsCamper: ReadonlySet<number>,
  view: AidView
): ReactNode {
  if (didntApply(row, needsCamper)) {
    return 'The family has no aid request this season: the grant counts, and offsets nothing.'
  }
  if (row.is_reversed) return 'A reversed line offsets nothing.'
  if (row.kind === 'commitment' && row.cancelled) {
    return 'The camper cancelled: it offsets nothing while the enrollment stays cancelled.'
  }
  if (needsCamper.has(row.transaction_cm_id)) {
    return (
      <>
        It needs its camper first: place it in{' '}
        <Link
          className={CS_LINK}
          to={aidHref('/aid/money/to-place', view, { household: String(row.household_cm_id) })}
        >
          Money › To place ›
        </Link>
      </>
    )
  }
  return 'It offsets nothing.'
}

/**
 * A Register row opened (owner ruling A: the Requests grid's opened row): left, the grant as CampMinder
 * or staff hold it; middle, the aid request it offsets, share by share; right, what can be done.
 * `actions` is the right panel's work (a commitment's Edit… and Withdraw…, for casework); without it
 * the panel says where the row is changed. `editor` is the open form, under the panels, marked
 * `data-aid-editor` so the table's ↑/↓ and Esc stand aside while it has focus.
 */
export function RegisterOpenRow({
  row,
  view,
  needsCamper,
  unmapped = NO_UNMAPPED,
  actions,
  editor,
}: {
  row: ApiAidGrantRow
  view: AidView
  needsCamper: ReadonlySet<number>
  /** The read's unmapped descriptions: where a grantor-less line's description lives in Funders. */
  unmapped?: ReadonlyArray<{ source_id: string; description: string }>
  actions?: ReactNode
  editor?: ReactNode
}) {
  const basis = basisWords(row, needsCamper)
  // The mock's opened row names the full session before the round (the cell has the short form).
  const session = sessionWords(row).full
  const funder = funderLink(row, unmapped)
  const funderTo =
    funder === null ? null : aidHref('/aid/money/funders', view, { [funder.param]: funder.value })
  return (
    <div className="space-y-2">
      <div className={THREE_PANELS}>
        <div className={PANEL} data-panel="grant">
          <div className={CS_PANEL_HEAD}>
            {row.kind === 'commitment' ? 'Committed by hand' : 'The grant line in CampMinder'}
          </div>
          <div>
            <Money value={row.amount} /> ·{' '}
            {row.grantor_name === '' ? 'no grantor yet' : row.grantor_name}
            {row.description !== '' && (
              <span className={CS_PMETA}>
                {' · '}
                {funderTo === null ? (
                  row.description
                ) : (
                  <Link className={CS_LINK} to={funderTo}>
                    {row.description}
                  </Link>
                )}
              </span>
            )}
          </div>
          <div className={CS_PMETA}>{standingCsv(row)}</div>
          {basis !== '' && <div className={CS_PMETA}>{basis}</div>}
          {row.kind === 'commitment' &&
            row.commitment_note !== undefined &&
            row.commitment_note !== '' && (
              <div className={CS_PMETA}>{`Note: ${row.commitment_note}`}</div>
            )}
          <Link
            className={`${CS_LINK_SM}`}
            to={aidHref(`/aid/households/${String(row.household_cm_id)}`, view)}
          >
            Open the Household ›
          </Link>
        </div>
        <div className={MIDDLE} data-panel="offsets">
          <div className={CS_PANEL_HEAD}>Aid request it offsets</div>
          {row.requests.length === 0 ? (
            <div className={CS_PMETA}>{noShareWords(row, needsCamper, view)}</div>
          ) : (
            row.requests.map((share) => (
              <div key={share.request_id}>
                {`${formatMoney(share.amount)} of it · ${session === '' ? '' : `${session} · `}${shareWords(share)}`}
              </div>
            ))
          )}
        </div>
        <div className={LAST} data-panel="actions">
          {actions ?? (
            <div className={CS_PMETA}>
              {row.kind === 'commitment'
                ? 'Casework edits or withdraws a commitment.'
                : 'A grant line is CampMinder’s: correct it there, and the next ledger sync brings it here.'}
            </div>
          )}
        </div>
      </div>
      {editor !== undefined && editor !== null && <div data-aid-editor="">{editor}</div>}
    </div>
  )
}
