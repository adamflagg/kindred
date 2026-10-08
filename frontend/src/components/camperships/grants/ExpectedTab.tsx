import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useAidGrants } from '../../../hooks/camperships/useAidGrants'
import type { ApiAidExpected } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import { expectedKindWords } from '../household/householdModel'
import { aidHref, type AidView } from '../kit/asOf'
import { AidTable, type AidColumn } from '../kit/AidTable'
import { CS_AMBER_NOTE, CS_FLABEL, CS_LINK, CS_SELECT } from '../kit/csType'

const expectedKey = (e: ApiAidExpected) => `${String(e.household_cm_id)}:${e.kind}`
const expectedSearch = (e: ApiAidExpected) => [e.household_cm_id, ...e.person_cm_ids]

/**
 * Grants › Expected (spec §8.2; D56; P-25; grants-v2.html): families whose aid form says they applied,
 * or plan to apply, for an incentive or congregation grant, with no such line yet. Never a grant:
 * nothing here counts toward any figure, and the calculator never sees it. A row clears itself when its
 * CampMinder line arrives. "Said" filters by what the form says (`?said=`).
 */
export function ExpectedTab({ view }: { view: AidView }) {
  const grants = useAidGrants()
  const [params, setParams] = useSearchParams()
  const said = params.get('said')
  const setSaid = useCallback(
    (value: string | null) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === null) next.delete('said')
          else next.set('said', value)
          return next
        },
        { replace: true }
      ),
    [setParams]
  )
  const columns = useMemo(
    (): ReadonlyArray<AidColumn<ApiAidExpected>> => [
      {
        key: 'family',
        header: 'Family',
        width: 170,
        pinned: true,
        value: (e) => e.family_name,
        render: (e) => (
          <Link
            className={CS_LINK}
            to={aidHref(`/aid/households/${String(e.household_cm_id)}`, view)}
          >
            {e.family_name === '' ? `Household ${String(e.household_cm_id)}` : e.family_name}
          </Link>
        ),
        searchable: true,
      },
      {
        key: 'campers',
        header: 'Campers',
        width: 240,
        value: (e) => e.camper_names.join(', '),
        searchable: true,
      },
      {
        key: 'said',
        header: 'The aid form says they are applying to',
        flex: true,
        value: expectedKindWords,
      },
    ],
    [view]
  )
  return (
    <QueryGuard
      isLoading={grants.isLoading}
      error={grants.data ? null : grants.error}
      data={grants.data}
      label="Grants"
    >
      {(data) => {
        const choices = [...new Set(data.expected.map(expectedKindWords))].sort()
        const rows =
          said === null ? data.expected : data.expected.filter((e) => expectedKindWords(e) === said)
        return (
          <div className="space-y-3">
            <p className={`${CS_AMBER_NOTE} text-sm`}>
              <span className="font-semibold">Never a grant.</span> The family&apos;s aid form says
              they applied, or plan to apply, for one of these. Nothing here counts toward any
              figure, and the calculator never sees it. A row clears itself when a matching
              CampMinder line arrives.
            </p>
            <AidTable
              rows={rows}
              columns={columns}
              rowKey={expectedKey}
              searchExtra={expectedSearch}
              csvFilename={`camperships-grants-expected-${String(data.year)}.csv`}
              urlPrefix="expected_"
              toolbarLead={
                <label className={`${CS_FLABEL} inline-flex items-center gap-2`}>
                  <span>Said</span>
                  <select
                    aria-label="Said"
                    className={CS_SELECT}
                    value={said ?? ''}
                    onChange={(event) => setSaid(event.target.value || null)}
                  >
                    <option value="">any</option>
                    {choices.map((words) => (
                      <option key={words} value={words}>
                        {words}
                      </option>
                    ))}
                  </select>
                </label>
              }
              emptyText="No family is expecting a grant that hasn't arrived."
            />
          </div>
        )
      }}
    </QueryGuard>
  )
}
