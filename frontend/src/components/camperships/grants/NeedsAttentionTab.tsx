import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidGrants, ApiAidNeedsCamper } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import {
  CS_BTN,
  CS_BTN2,
  CS_CARD,
  CS_LABEL,
  CS_LINK,
  CS_SMALL,
  CS_TABLE_CARD,
  CS_TD_CARD,
} from '../kit/csType'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney } from '../kit/money'
import { DONE_NOTE } from '../money/toPlaceStyles'
import { hiddenTicks } from '../requests/ticks'
import { BulkGrantDialog } from './BulkGrantDialog'
import { NeedsCamperPanel } from './NeedsCamperPanel'
import { grantLineWords, grantPlan, needsKey, singleSuggestion, waitingWords } from './needsModel'
import { SUGGESTS_CONFIRMS, suggestedWords } from './placeModel'
import { grantKey } from './registerModel'

function Group({
  title,
  why,
  actions,
  children,
}: {
  title: string
  why: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={CS_LABEL}>{title}</span>
        <span className={CS_SMALL}>{why}</span>
        {actions !== undefined && (
          <span className="ml-auto flex items-center gap-2">{actions}</span>
        )}
      </div>
      {children}
    </section>
  )
}

const needsSearch = (n: ApiAidNeedsCamper) => [
  n.grant.household_cm_id,
  n.grant.transaction_cm_id,
  ...n.candidates.map((c) => c.name),
]

function NeedsBody({
  data,
  view,
  canWork,
}: {
  data: ApiAidGrants
  view: AidView
  canWork: boolean
}) {
  const names = useAidProgramNames()
  const [note, setNote] = useState<{ words: string; year: number } | null>(null)
  const shown = note !== null && note.year === view.year ? note : null
  const said = useCallback((words: string) => setNote({ words, year: view.year }), [view.year])
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [matching, setMatching] = useState<ReadonlySet<string> | null>(null)
  // The keys ticked at the click while the dialog is open; the plan is derived from the read below.
  const [atClick, setAtClick] = useState<ReadonlySet<string> | null>(null)
  const onMatchingChange = useCallback(
    (keys: ReadonlySet<string>) =>
      setMatching((prev) =>
        prev !== null && prev.size === keys.size && [...keys].every((k) => prev.has(k))
          ? prev
          : keys
      ),
    []
  )
  const needs = data.needs_camper
  const keys = useMemo(() => new Set(needs.map(needsKey)), [needs])
  const ticked = useMemo(() => [...selected].filter((k) => keys.has(k)), [selected, keys])
  const hidden = useMemo(() => hiddenTicks(ticked, matching, keys), [ticked, matching, keys])
  const singles = useMemo(() => needs.filter(singleSuggestion).map(needsKey), [needs])
  // From the CURRENT read on every render: a Confirm after a refetch never re-places a line someone
  // else placed meanwhile (a placement overwrites rather than refusing).
  const plan = useMemo(
    () => (atClick === null ? null : grantPlan(needs, atClick, hidden)),
    [atClick, needs, hidden]
  )

  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidNeedsCamper>> => [
      {
        key: 'family',
        header: 'Family',
        width: 170,
        pinned: true,
        value: (n) => familyLabel(n.grant, n.grant.family_name).text,
        render: (n) => (
          <Link
            className={CS_LINK}
            to={aidHref(`/aid/households/${String(n.grant.household_cm_id)}`, view)}
          >
            <HouseholdLabelText label={familyLabel(n.grant, n.grant.family_name)} />
          </Link>
        ),
        searchable: true,
      },
      {
        key: 'line',
        header: 'The grant line in CampMinder',
        width: 320,
        value: grantLineWords,
        searchable: true,
      },
      {
        key: 'suggested',
        header: 'Suggestion',
        width: 220,
        value: (n) => suggestedWords(n, names),
        searchable: true,
      },
      {
        key: 'candidates',
        header: 'Campers in the household',
        flex: true,
        value: (n) => n.candidates.map((c) => c.name).join(', '),
      },
    ],
    [view, names]
  )
  const renderDetail = useCallback(
    (need: ApiAidNeedsCamper) => (
      <NeedsCamperPanel
        key={needsKey(need)}
        need={need}
        year={data.year}
        view={view}
        names={names}
        canWork={canWork}
        onDone={said}
      />
    ),
    [data.year, view, names, canWork, said]
  )
  const bulkDone = useCallback(
    (words: string, placed: readonly number[]) => {
      const gone = new Set(placed.map(String))
      setSelected((current) => new Set([...current].filter((k) => !gone.has(k))))
      setAtClick(null)
      said(words)
    },
    [said]
  )

  return (
    <div className="space-y-5">
      {shown !== null && <p className={DONE_NOTE}>✓ {shown.words}</p>}
      <Group
        title={`Needs a camper · ${String(needs.length)} ${needs.length === 1 ? 'line' : 'lines'}`}
        why={`A household-level line in a household that applied for aid. ${SUGGESTS_CONFIRMS} Families who never applied aren't listed.`}
        actions={
          canWork && singles.length > 0 ? (
            <button
              type="button"
              className={CS_BTN2}
              onClick={() => {
                const all = new Set([...selected, ...singles])
                setSelected(all)
                setAtClick(new Set(singles))
              }}
            >
              {`Confirm the ${String(singles.length)} Single, Exact ${singles.length === 1 ? 'Suggestion' : 'Suggestions'}…`}
            </button>
          ) : undefined
        }
      >
        {canWork && ticked.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">
              {`${String(ticked.length)} selected`}
              {hidden.size > 0 ? ` · ${String(hidden.size)} hidden by the search` : ''}
            </span>
            <button type="button" className={CS_BTN} onClick={() => setAtClick(new Set(ticked))}>
              Confirm the Selected…
            </button>
            <button type="button" className={CS_BTN2} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
        {canWork && (
          <BulkGrantDialog
            plan={plan}
            year={data.year}
            names={names}
            onClose={() => setAtClick(null)}
            onDone={bulkDone}
          />
        )}
        <AidTable
          rows={needs}
          columns={columns}
          rowKey={needsKey}
          searchExtra={needsSearch}
          csvFilename={`camperships-grants-needs-a-camper-${String(data.year)}.csv`}
          urlPrefix="needs_"
          renderDetail={renderDetail}
          arrowKeys
          selected={canWork ? selected : undefined}
          onSelectedChange={canWork ? setSelected : undefined}
          onMatchingChange={canWork ? onMatchingChange : undefined}
          emptyText="Every applicant household's grant line has its camper."
        />
      </Group>
      <Group
        title={`Description not mapped to a grantor · ${String(data.unmapped.length)}`}
        why="Its lines are in the Register with no grantor name until it is mapped."
      >
        {data.unmapped.length === 0 ? (
          <p className={CS_SMALL}>Every grant description names its grantor.</p>
        ) : (
          <div className={CS_CARD}>
            <table className={`${CS_TABLE_CARD} w-full`}>
              <tbody>
                {data.unmapped.map((u) => (
                  <tr key={u.source_id}>
                    <td className={`${CS_TD_CARD} font-medium`}>{u.description}</td>
                    <td className={CS_TD_CARD}>
                      {`${String(u.lines)} ${u.lines === 1 ? 'line' : 'lines'} · ${formatMoney(u.amount)}`}
                    </td>
                    <td className={`${CS_TD_CARD} text-right`}>
                      <Link
                        className={CS_LINK}
                        to={aidHref('/aid/money/sources', view, { row: u.source_id })}
                      >
                        Map It in Money › Sources ›
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Group>
      <Group
        title={`Committed, not yet in CampMinder · ${String(data.waiting.length)}`}
        why="Post it in CampMinder; the next ledger sync matches it and it leaves this list."
      >
        {data.waiting.length === 0 ? (
          <p className={CS_SMALL}>No commitment is waiting.</p>
        ) : (
          <div className={CS_CARD}>
            <table className={`${CS_TABLE_CARD} w-full`}>
              <tbody>
                {data.waiting.map((w) => (
                  <tr key={w.grant.commitment_id}>
                    <td className={`${CS_TD_CARD} whitespace-normal`}>{waitingWords(w)}</td>
                    <td className={`${CS_TD_CARD} text-right`}>
                      <Link
                        className={CS_LINK}
                        to={aidHref('/aid/grants/register', view, { row: grantKey(w.grant) })}
                      >
                        {canWork ? 'Edit or Withdraw in the Register ›' : 'Open in the Register ›'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Group>
    </div>
  )
}

/**
 * Grants › Needs attention (spec §8.2; D16, D55, D126, D142, D160; S3-6; ruling G; grants-v2.html),
 * grouped by reason: lines that need a camper (the suggestion, Confirm, Another Camper…, and a bulk
 * confirm of single, exact suggestions), descriptions not mapped to a grantor (to Money › Sources),
 * and commitments not yet in CampMinder with why. Live only. No Today pointer (ruling G).
 */
export function NeedsAttentionTab({ view }: { view: AidView }) {
  const grants = useAidGrants()
  const { hasPermission } = usePermissions()
  const canWork = hasPermission(Permission.FINANCIAL_AID_CASEWORK)
  return (
    <QueryGuard
      isLoading={grants.isLoading}
      error={grants.data ? null : grants.error}
      data={grants.data}
      label="Grants"
    >
      {(data) => <NeedsBody data={data} view={view} canWork={canWork} />}
    </QueryGuard>
  )
}
