import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidProgramNames } from '../../../hooks/camperships/useAidProgramNames'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { BulkGrantDialog } from '../grants/BulkGrantDialog'
import { NeedsCamperPanel } from '../grants/NeedsCamperPanel'
import { grantLineWords, grantPlan, needsKey, singleSuggestion } from '../grants/needsModel'
import { suggestionCell } from '../grants/placeModel'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN, CS_BTN2, CS_LABEL, CS_LINK, CS_SMALL } from '../kit/csType'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney } from '../kit/money'
import { hiddenTicks } from '../requests/ticks'
import { GRANT_CONFIRM_DOES, grantLinesFor } from './toPlaceModel'
import { GRANT_NOTE } from './toPlaceStyles'

const needsSearch = (n: ApiAidNeedsCamper) => [
  n.grant.household_cm_id,
  n.grant.transaction_cm_id,
  ...n.candidates.map((c) => c.name),
]

function GrantLinesBody({
  needs,
  year,
  view,
  canWork,
  onDone,
}: {
  needs: readonly ApiAidNeedsCamper[]
  year: number
  view: AidView
  canWork: boolean
  onDone: (words: string) => void
}) {
  const names = useAidProgramNames()
  const sessions = useAidSessionNames(year)
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
        width: 190,
        pinned: true,
        value: (n) => familyLabel(n.grant, n.grant.family_name).text,
        render: (n) => (
          <Link
            className={`${CS_LINK} font-medium`}
            to={aidHref(`/aid/households/${String(n.grant.household_cm_id)}`, view)}
          >
            <HouseholdLabelText label={familyLabel(n.grant, n.grant.family_name)} />
          </Link>
        ),
        searchable: true,
      },
      {
        key: 'line',
        header: 'The line in CampMinder',
        width: 330,
        value: grantLineWords,
        searchable: true,
      },
      {
        key: 'suggested',
        header: "The dashboard's suggestion",
        flex: true,
        value: (n) => suggestionCell(n, sessions),
        searchable: true,
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 110,
        align: 'right',
        value: (n) => n.grant.amount,
        render: (n) => formatMoney(n.grant.amount),
      },
    ],
    [view, sessions]
  )
  const renderDetail = useCallback(
    (need: ApiAidNeedsCamper) => (
      <NeedsCamperPanel
        key={needsKey(need)}
        need={need}
        year={year}
        view={view}
        names={names}
        canWork={canWork}
        onDone={onDone}
      />
    ),
    [year, view, names, canWork, onDone]
  )
  const bulkDone = useCallback(
    (words: string, placed: readonly number[]) => {
      const gone = new Set(placed.map(String))
      setSelected((current) => new Set([...current].filter((k) => !gone.has(k))))
      setAtClick(null)
      onDone(words)
    },
    [onDone]
  )

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={CS_LABEL}>Outside grant posted to the family</span>
        <span
          className={CS_SMALL}
        >{`${String(needs.length)} ${needs.length === 1 ? 'line' : 'lines'}`}</span>
        {canWork && singles.length > 0 && (
          <button
            type="button"
            className={`${CS_BTN2} ml-auto`}
            onClick={() => {
              setSelected(new Set([...selected, ...singles]))
              setAtClick(new Set(singles))
            }}
          >
            {`Confirm the ${String(singles.length)} Single, Exact ${singles.length === 1 ? 'Suggestion' : 'Suggestions'}…`}
          </button>
        )}
      </div>
      <p className={GRANT_NOTE}>{GRANT_CONFIRM_DOES}</p>
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
          year={year}
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
        csvFilename={`camperships-money-to-place-grants-${String(year)}.csv`}
        hideToolbar
        urlPrefix="needs_"
        renderDetail={renderDetail}
        arrowKeys
        selected={canWork ? selected : undefined}
        onSelectedChange={canWork ? setSelected : undefined}
        onMatchingChange={canWork ? onMatchingChange : undefined}
      />
    </section>
  )
}

/**
 * To place's fourth group (M5; spec §8.2; D16, D126, D160; S3-6; mock Q4): the outside-grant lines
 * posted to the family, each with the dashboard's suggestion; the opened row offers Confirm and
 * Another Camper…, and a bulk confirm takes the single, exact suggestions. Reads the grants read
 * itself (the Register's own cache entry); `householdCmId` narrows it under `?household=`. Hidden
 * while it loads, when the read fails, and when no line needs a camper: the camp-aid groups stand
 * on their own.
 */
export function GrantLinesGroup({
  view,
  householdCmId,
  canWork,
  onDone,
}: {
  view: AidView
  householdCmId: number | null
  canWork: boolean
  onDone: (words: string) => void
}) {
  const grants = useAidGrants()
  const needs = useMemo(
    () => grantLinesFor(grants.data?.needs_camper ?? [], householdCmId),
    [grants.data, householdCmId]
  )
  if (grants.data === undefined || needs.length === 0) return null
  return (
    <GrantLinesBody
      needs={needs}
      year={grants.data.year}
      view={view}
      canWork={canWork}
      onDone={onDone}
    />
  )
}
