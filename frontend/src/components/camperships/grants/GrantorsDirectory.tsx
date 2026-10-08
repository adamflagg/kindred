import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { useAidGrantors } from '../../../hooks/camperships/useAidGrantors'
import {
  useAidRetireGrantor,
  useAidUnretireGrantor,
} from '../../../hooks/camperships/useAidGrantorWrites'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidGrantor, ApiAidGrantorDescription } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { ReasonForm } from '../household/ReasonForm'
import type { AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import {
  CS_BTN,
  CS_BTN2,
  CS_LINK,
  CS_PANEL_HEAD,
  CS_PANEL_RULE,
  CS_PMETA,
  CS_SMALL,
} from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { inStaffWords } from '../money/refusal'
import {
  canteenCell,
  fullCoverageCell,
  grantorsCsvName,
  isRetired,
  paysAfterCell,
  retireBlocked,
  seasonAmount,
  seasonCount,
  termsWords,
} from './grantorModel'
import { GrantorForm } from './GrantorForm'

/**
 * The directory's own URL keys, namespaced so a page that mounts it beside another table (slice 4:
 * Reports › Development, beside Funding sources and its `?row=`) never shares one (P-19). The table's
 * sort rides under the same namespace (`grantors_sort`).
 */
const GRANTOR_PARAM = 'grantor'
const RETIRED_PARAM = 'grantors'
const URL_PREFIX = 'grantors_'

const grantorKey = (g: ApiAidGrantor) => g.key
const searchExtra = (g: ApiAidGrantor) => g.aliases
/** A result line after a write (#2990's DONE_NOTE). */
const DONE =
  'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
/** The opened row's two panels (the Requests grid's arrangement 3: the facts left, the editor right). */
const SIDE_BY_SIDE = 'grid grid-cols-[24rem_minmax(0,1fr)] items-stretch text-sm'
const LEFT = `flex min-w-0 flex-col gap-1 border-r pr-4 ${CS_PANEL_RULE}`
const RIGHT = 'flex min-w-0 flex-col gap-2 pl-4'

type Mode = 'none' | 'edit' | 'retire' | 'unretire'

function GrantorPanel({
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
  return (
    <div className={SIDE_BY_SIDE} data-testid="grantor-panel">
      <div className={LEFT} data-panel="grantor">
        <div className={CS_PANEL_HEAD}>The grantor</div>
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
        {mode === 'edit' && <GrantorForm grantor={grantor} onCancel={close} onDone={done} />}
        {mode === 'retire' && (
          <div data-aid-editor="">
            <ReasonForm
              label="Why"
              head={`Retire ${grantor.name}`}
              submitLabel="Retire"
              hint="Hidden from pickers from now; kept for history. Allowed only while no description maps to it and no open grant names it; otherwise the server says what still uses it."
              onCancel={close}
              onSubmit={async (reason) => {
                await inStaffWords(retire.mutateAsync({ key: grantor.key, reason }))
                done(
                  `${grantor.name}: retired, with your reason. Hidden from pickers; kept for history.`
                )
              }}
            />
          </div>
        )}
        {mode === 'unretire' && (
          <div data-aid-editor="">
            <ReasonForm
              label="Why"
              head={`Unretire ${grantor.name}`}
              submitLabel="Unretire"
              onCancel={close}
              onSubmit={async (reason) => {
                await inStaffWords(unretire.mutateAsync({ key: grantor.key, reason }))
                done(`${grantor.name}: unretired, with your reason.`)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Grants › Grantors (spec §8.2; D57, D86, D143, D160; grants-v2.html; P-19, P-20): the directory, a
 * self-contained component with its own read (`GET /grantors?include_retired=true&year=`), writes and
 * namespaced URL state (`?grantor=<key>`, `?grantors=all`; every other search param is left as it is).
 * Everyone who reaches it sees contacts (D57). `grantors` (finance and development: owner 10-06,
 * rulings:676) creates, edits, retires and unretires. Descriptions are mapped on their source row
 * (S3-5) and link where the host says (`descriptionHref`), as plain text where it gives none. A row opens
 * in the Requests grid's opened-row grammar (R-A): the grantor's facts and award terms left, the edit right.
 */
export function GrantorsDirectory({
  view,
  descriptionHref,
}: {
  view: AidView
  /** Where a description links, or absent for plain text. Stable (memoised) per mount. */
  descriptionHref?: ((d: ApiAidGrantorDescription) => string | null) | undefined
}) {
  const grantors = useAidGrantors({ includeRetired: true, year: view.year })
  const definitions = useAidDefinitions('grants')
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission(Permission.FINANCIAL_AID_GRANTORS)
  const [params, setParams] = useSearchParams()
  const showRetired = params.get(RETIRED_PARAM) === 'all'
  const highlighted = params.get(GRANTOR_PARAM)
  const [result, setResult] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const setParam = useCallback(
    (name: typeof GRANTOR_PARAM | typeof RETIRED_PARAM, value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const onHighlight = useCallback((key: string | null) => setParam(GRANTOR_PARAM, key), [setParam])
  const done = useCallback((words: string) => {
    setCreating(false)
    setResult(words)
  }, [])
  const renderDetail = useCallback(
    (g: ApiAidGrantor) => (
      <GrantorPanel
        key={g.key}
        grantor={g}
        canEdit={canEdit}
        descriptionHref={descriptionHref}
        onDone={done}
      />
    ),
    [canEdit, descriptionHref, done]
  )
  // The server's own "Grants this season" note (definitions `grants`, key grantor_season; A7). It
  // shows under the season columns AND in the page's numbered notes on purpose (R5-22): the
  // directory is self-contained, and slice 4 mounts it in Reports, whose notes are another surface.
  const seasonNumber = definitions.numberOf('grantor_season')
  const seasonNote = definitions.notes.find((n) => n.n === seasonNumber)?.text ?? null

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidGrantor>> => [
      {
        key: 'name',
        header: 'Grantor',
        width: 220,
        pinned: true,
        value: (g) => g.name,
        render: (g) => (
          <div>
            <span className={isRetired(g) ? 'text-muted-foreground line-through' : 'font-medium'}>
              {g.name}
            </span>
            {g.aliases.length > 0 && (
              <div className={CS_SMALL}>{`also: ${g.aliases.join(', ')}`}</div>
            )}
            {isRetired(g) && (
              <div className={CS_SMALL}>{`retired ${formatShortDate(g.retired_at)}`}</div>
            )}
          </div>
        ),
        searchable: true,
      },
      {
        key: 'descriptions',
        header: 'Descriptions in CampMinder',
        width: 260,
        value: (g) => g.descriptions.map((d) => d.description).join(', '),
        render: (g) =>
          g.descriptions.length === 0 ? (
            <span className="text-muted-foreground">none mapped</span>
          ) : (
            <div>
              {g.descriptions.map((d) => {
                const href = descriptionHref?.(d) ?? null
                return (
                  <div key={d.source_id}>
                    {href === null ? (
                      d.description
                    ) : (
                      <Link className={CS_LINK} to={href}>
                        {`${d.description} ›`}
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          ),
        searchable: true,
      },
      { key: 'full', header: 'Full coverage', width: 110, value: fullCoverageCell },
      { key: 'canteen', header: 'Covers canteen', width: 120, value: canteenCell },
      { key: 'paysAfter', header: 'Pays after camp aid', width: 150, value: paysAfterCell },
      {
        key: 'count',
        header: 'Grants this season',
        width: 140,
        align: 'right',
        value: seasonCount,
      },
      {
        key: 'amount',
        header: '$ this season',
        width: 130,
        align: 'right',
        value: seasonAmount,
        render: (g) => <Money value={seasonAmount(g)} />,
        csv: (g) => moneyCsv(seasonAmount(g)),
      },
      { key: 'contacts', header: 'Contacts', width: 240, value: (g) => g.contacts },
      { key: 'eligibility', header: 'Eligibility', flex: true, value: (g) => g.eligibility },
    ],
    [descriptionHref]
  )

  return (
    <QueryGuard
      isLoading={grantors.isLoading}
      error={grantors.data ? null : grantors.error}
      data={grantors.data}
      label="grantors"
    >
      {(data) => {
        const rows = showRetired ? data.grantors : data.grantors.filter((g) => !isRetired(g))
        return (
          <div className="space-y-3">
            {result !== null && <p className={DONE}>✓ {result}</p>}
            {!canEdit && (
              <p className={CS_PMETA}>Read only: finance and development edit the grantors.</p>
            )}
            {creating && <GrantorForm onCancel={() => setCreating(false)} onDone={done} />}
            <AidTable
              rows={rows}
              columns={columns}
              rowKey={grantorKey}
              searchExtra={searchExtra}
              urlPrefix={URL_PREFIX}
              csvFilename={grantorsCsvName(view.year)}
              searchPlaceholder="Grantor or description"
              toolbarLead={
                <>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={showRetired}
                      onChange={(event) =>
                        setParam(RETIRED_PARAM, event.target.checked ? 'all' : null)
                      }
                    />
                    Show retired grantors
                  </label>
                  {canEdit && !creating && (
                    <button type="button" className={CS_BTN} onClick={() => setCreating(true)}>
                      New Grantor…
                    </button>
                  )}
                </>
              }
              highlighted={highlighted}
              onHighlight={onHighlight}
              renderDetail={renderDetail}
              arrowKeys
              emptyText="No grantors yet."
            />
            {seasonNote !== null && <p className={CS_SMALL}>{seasonNote}</p>}
          </div>
        )
      }}
    </QueryGuard>
  )
}
