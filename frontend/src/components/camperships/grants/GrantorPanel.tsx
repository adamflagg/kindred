import { useState } from 'react'
import { Link } from 'react-router'

import {
  useAidRetireGrantor,
  useAidUnretireGrantor,
} from '../../../hooks/camperships/useAidGrantorWrites'
import type { ApiAidGrantor, ApiAidGrantorDescription } from '../../../types/api-types'
import { CS_BTN2, CS_LINK, CS_PANEL_HEAD, CS_PANEL_RULE, CS_PMETA } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { ReasonEditor } from '../money/ReasonEditor'
import { inStaffWords } from '../money/refusal'
import { isRetired, retireBlocked, termsWords } from './grantorModel'
import { GrantorForm } from './GrantorForm'

/** The opened row's two panels (the Requests grid's arrangement 3: the facts left, the editor right). */
const SIDE_BY_SIDE = 'grid grid-cols-[24rem_minmax(0,1fr)] items-stretch text-sm'
const LEFT = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const RIGHT = 'flex min-w-0 flex-col gap-2 pl-4'

type Mode = 'none' | 'edit' | 'retire' | 'unretire'

/**
 * A funder's opened row (Money › Funders; D57, D86, D143, D160; P-9, P-19, P-20; owner 10-06,
 * rulings:676): its facts and award terms left, the edit right, in the Requests grid's opened-row
 * grammar (R-A). Everyone who reaches Funders sees contacts (D57); `grantors` (finance and
 * development) edits, retires and unretires. A description is mapped on its own row (S3-5) and
 * links where the host says (`descriptionHref`), as plain text where it gives none.
 */
export function GrantorPanel({
  grantor,
  canEdit,
  descriptionHref,
  onDone,
}: {
  grantor: ApiAidGrantor
  canEdit: boolean
  descriptionHref: ((d: ApiAidGrantorDescription) => string | null) | undefined
  onDone: (words: string) => void
}) {
  const retire = useAidRetireGrantor()
  const unretire = useAidUnretireGrantor()
  const [mode, setMode] = useState<Mode>('none')
  const close = () => setMode('none')
  const done = (words: string) => {
    setMode('none')
    onDone(words)
  }
  const terms = termsWords(grantor)
  const blocked = retireBlocked(grantor)
  // §24, rev1 (money-funders.html): Edit… takes the whole opened row, not its right third.
  if (mode === 'edit') {
    return (
      <div className="text-sm" data-testid="grantor-panel">
        <GrantorForm grantor={grantor} onCancel={close} onDone={done} />
      </div>
    )
  }
  return (
    <div className={SIDE_BY_SIDE} data-testid="grantor-panel">
      <div className={LEFT} data-panel="grantor">
        <div className={CS_PANEL_HEAD}>The funder</div>
        <p>{`Award terms: ${terms === '' ? 'none (not full coverage)' : terms}`}</p>
        {grantor.descriptions.length === 0 ? (
          <p className={CS_PMETA}>No CampMinder description maps to it.</p>
        ) : (
          <div>
            <span className={CS_PMETA}>Descriptions in CampMinder: </span>
            {grantor.descriptions.map((d, i) => {
              const href = descriptionHref?.(d) ?? null
              return (
                <span key={d.source_id}>
                  {i > 0 && ', '}
                  {href === null ? (
                    d.description
                  ) : (
                    <Link className={CS_LINK} to={href}>
                      {`${d.description} ›`}
                    </Link>
                  )}
                </span>
              )
            })}
          </div>
        )}
        {grantor.eligibility !== '' && <p>{`Eligibility: ${grantor.eligibility}`}</p>}
        {grantor.contacts !== '' && <p>{`Contacts: ${grantor.contacts}`}</p>}
        {isRetired(grantor) && (
          <p className={CS_PMETA}>
            {`Retired ${formatShortDate(grantor.retired_at)}: hidden from pickers, kept for history.`}
          </p>
        )}
      </div>
      <div className={RIGHT} data-panel="actions">
        {canEdit && mode === 'none' && (
          <div className="flex flex-wrap items-center gap-2">
            {isRetired(grantor) ? (
              <button type="button" className={CS_BTN2} onClick={() => setMode('unretire')}>
                Unretire…
              </button>
            ) : (
              <>
                <button type="button" className={CS_BTN2} onClick={() => setMode('edit')}>
                  Edit…
                </button>
                <button
                  type="button"
                  className={CS_BTN2}
                  disabled={blocked !== null}
                  onClick={() => setMode('retire')}
                >
                  Retire…
                </button>
                {blocked !== null && <span className={CS_PMETA}>{blocked}</span>}
              </>
            )}
          </div>
        )}
        {mode === 'retire' && (
          <ReasonEditor
            title={`Retire ${grantor.name}`}
            label="Why"
            submitLabel="Retire"
            requiredWords="A reason is required."
            hint="Hidden from pickers from now; kept for history. Allowed only while no description maps to it and no open grant names it."
            onCancel={close}
            onSubmit={async (reason) => {
              await inStaffWords(retire.mutateAsync({ key: grantor.key, reason }))
              done(
                `${grantor.name}: retired, with your reason. Hidden from pickers; kept for history.`
              )
            }}
          />
        )}
        {mode === 'unretire' && (
          <ReasonEditor
            title={`Unretire ${grantor.name}`}
            label="Why"
            submitLabel="Unretire"
            requiredWords="A reason is required."
            hint=""
            onCancel={close}
            onSubmit={async (reason) => {
              await inStaffWords(unretire.mutateAsync({ key: grantor.key, reason }))
              done(`${grantor.name}: unretired, with your reason.`)
            }}
          />
        )}
      </div>
    </div>
  )
}
