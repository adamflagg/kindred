import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { BulkGrantDialog } from '../grants/BulkGrantDialog'
import { NeedsCamperPanel } from '../grants/NeedsCamperPanel'
import {
  grantLineCell,
  grantLineWords,
  grantPlan,
  needsKey,
  singleSuggestion,
} from '../grants/needsModel'
import { evidenceLines, suggestionCell, suggestionShort } from '../grants/placeModel'
import { HouseholdLabelText } from '../household/HouseholdLabel'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN, CS_BTN2, CS_LINK_CELL } from '../kit/csType'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { hiddenTicks } from '../requests/ticks'
import { labelWords } from '../household/householdModel'
import { GRANT_DOES, grantLinesFor } from './toPlaceModel'
import { GroupDoes, GroupHeading } from './ToPlaceParts'

const needsSearch = (n: ApiAidNeedsCamper) => [
  n.grant.household_cm_id,
  n.grant.transaction_cm_id,
  ...n.candidates.map((c) => c.name),
]

/** The opened-row caret before the family (mock `.cf-caret`): ▸ shut, ▾ open. */
const CARET = 'text-muted-foreground w-3 flex-none text-[10px]'

function GrantLinesBody({
  needs,
  year,
  view,
  canWork,
  query,
  onDone,
}: {
  needs: readonly ApiAidNeedsCamper[]
  year: number
  view: AidView
  canWork: boolean
  query: string
  onDone: (words: string) => void
}) {
  const sessions = useAidSessionNames(year)
  const [folded, setFolded] = useState(false)
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
        width: 196,
        pinned: true,
        value: (n) => familyLabel(n.grant, n.grant.family_name).text,
        title: (n) =>
          `${labelWords(familyLabel(n.grant, n.grant.family_name))} · open the household page`,
        render: (n, ctx) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={CARET}>{ctx.highlighted ? '▾' : '▸'}</span>
            <Link
              className={`${CS_LINK_CELL} min-w-0 truncate`}
              to={aidHref(`/aid/households/${String(n.grant.household_cm_id)}`, view)}
              onClick={(event) => event.stopPropagation()}
            >
              <HouseholdLabelText label={familyLabel(n.grant, n.grant.family_name)} />
            </Link>
          </span>
        ),
        searchable: true,
      },
      {
        key: 'line',
        header: 'The line in CampMinder',
        width: 380,
        value: grantLineWords,
        title: (n) => grantLineWords(n),
        render: grantLineCell,
        searchable: true,
      },
      {
        key: 'suggested',
        header: "The dashboard's suggestion",
        flex: true,
        value: (n) => suggestionCell(n, sessions),
        title: (n) => {
          const facts = evidenceLines(n).join(' · ')
          return `${suggestionCell(n, sessions)} · ${facts}`
        },
        render: (n) =>
          n.suggestion === null ? (
            <span className="text-muted-foreground">{suggestionShort(n, sessions)}</span>
          ) : (
            <span className="font-bold">{suggestionShort(n, sessions)}</span>
          ),
        searchable: true,
      },
      {
        key: 'amount',
        header: 'Amount',
        width: 90,
        align: 'right',
        value: (n) => n.grant.amount,
        render: (n) => <Money value={n.grant.amount} />,
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
        sessions={sessions}
        canWork={canWork}
        onDone={onDone}
      />
    ),
    [year, view, sessions, canWork, onDone]
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

  const total = needs.reduce((sum, n) => sum + Math.round(n.grant.amount * 100), 0) / 100
  // The group's own bulk button, on its heading row, right: the single, exact suggestions, or the
  // checked lines with Clear (mock `gright`).
  const right = !canWork ? undefined : ticked.length > 0 ? (
    <>
      <span
        className="text-muted-foreground text-[12.5px]"
        title={`${String(ticked.length)} checked${hidden.size > 0 ? `, ${String(hidden.size)} of them hidden by the search` : ''}`}
      >
        {`${String(ticked.length)} checked${hidden.size > 0 ? ` · ${String(hidden.size)} hidden` : ''}`}
      </span>
      <button type="button" className={CS_BTN} onClick={() => setAtClick(new Set(ticked))}>
        {`Confirm the ${String(ticked.length)} Checked…`}
      </button>
      <button type="button" className={CS_BTN2} onClick={() => setSelected(new Set())}>
        Clear
      </button>
    </>
  ) : singles.length > 0 ? (
    <button
      type="button"
      className={CS_BTN2}
      onClick={() => {
        setSelected(new Set([...selected, ...singles]))
        setAtClick(new Set(singles))
      }}
    >
      {`Confirm the ${String(singles.length)} Single, Exact ${singles.length === 1 ? 'Suggestion' : 'Suggestions'}…`}
    </button>
  ) : undefined

  return (
    <section>
      <GroupHeading
        title="Outside grant posted to the family"
        meta={`${String(needs.length)} ${needs.length === 1 ? 'line' : 'lines'} · ${formatMoney(total)}`}
        folded={folded}
        onToggle={() => setFolded((f) => !f)}
        right={right}
      />
      {!folded && <GroupDoes spec={GRANT_DOES} />}
      {canWork && (
        <BulkGrantDialog
          plan={plan}
          year={year}
          sessions={sessions}
          onClose={() => setAtClick(null)}
          onDone={bulkDone}
        />
      )}
      {!folded && (
        <AidTable
          rows={needs}
          columns={columns}
          rowKey={needsKey}
          searchExtra={needsSearch}
          csvFilename={`camperships-money-to-place-grants-${String(year)}.csv`}
          hideToolbar
          nowrapHeaders
          urlPrefix="needs_"
          query={query}
          renderDetail={renderDetail}
          arrowKeys
          selected={canWork ? selected : undefined}
          onSelectedChange={canWork ? setSelected : undefined}
          onMatchingChange={canWork ? onMatchingChange : undefined}
          emptyText="No outside-grant line matches the search."
        />
      )}
    </section>
  )
}

/**
 * To place's fourth group (M5; spec §8.2; D16, D126, D160; S3-6; mock `grantTable`): the outside-grant
 * lines posted to the family, each with the dashboard's suggestion; the opened row offers Confirm and
 * Another Camper…, and a bulk confirm takes the single, exact suggestions. Reads the grants read itself
 * (the Register's own cache entry); `householdCmId` narrows it under `?household=`, and `query` is the
 * page's one search box. Hidden while it loads, when the read fails, and when no line needs a camper:
 * the camp-aid groups stand on their own.
 */
export function GrantLinesGroup({
  view,
  householdCmId,
  canWork,
  query = '',
  onDone,
}: {
  view: AidView
  householdCmId: number | null
  canWork: boolean
  /** The page's search box: the grant lines answer it too. */
  query?: string
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
      query={query}
      onDone={onDone}
    />
  )
}
