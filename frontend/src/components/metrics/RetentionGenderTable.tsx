/**
 * Retention by Gender (#2898): the base season's campers by gender identity label, every label in the fixed order,
 * how many returned and the rate, with ruling 58's Gender field count and #82's Read with care line under it.
 */

import type { RetentionMetrics } from '../../types/metrics'
import { formatCount, formatRate } from '../../utils/numberFormat'
import {
  genderDisplayName,
  genderIdentityColor,
  sortByIdentityOrder,
} from '../camperships/kit/genderIdentity'
import { GenderFallbackLine, ReadWithCareLine } from './genderIdentityNotes'
import type { RetentionCompareView } from '../../utils/retentionCompare'
import { RetentionChange } from './RetentionChange'
import { DefRef } from '../camperships/kit/DefinitionNotes'

const TH = 'text-muted-foreground px-4 py-2 font-medium'

export function RetentionGenderTable({
  data,
  baseYear,
  compareYear,
  noteN,
  prior,
  compare,
}: {
  data: RetentionMetrics
  baseYear: number
  compareYear: number
  /** The page-foot Gender note's number; undefined when no camper was counted by the Gender field. */
  noteN: number | undefined
  /**
   * Last year's retention and how it was read (#3207 PR 11). The gender change lives here, not on
   * the pie (whose segments are shares of the returners, not rates); the table shows each row's
   * base, so the change cell never restates it (#91).
   */
  prior?: RetentionMetrics | undefined
  compare?: RetentionCompareView | undefined
}) {
  const rows = sortByIdentityOrder(data.by_gender, (g) => g.gender)
  const priorRate = new Map((prior?.by_gender ?? []).map((g) => [g.gender, g.retention_rate]))
  return (
    <div className="card-lodge overflow-hidden">
      <div className="border-border border-b px-4 py-3">
        <h3 className="text-foreground text-base font-semibold">Retention by Gender</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/30 border-b">
              <th className={`${TH} text-left`}>Gender</th>
              <th className={`${TH} text-right`}>{baseYear} campers</th>
              <th className={`${TH} text-right`}>Returned {compareYear}</th>
              <th className={`${TH} text-right`}>Retention</th>
              {compare && (
                <th className={`${TH} text-right`}>
                  Change
                  <DefRef n={compare.noteN} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.gender} className="border-border border-b">
                <td className="text-foreground px-4 py-2 font-medium">
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]"
                    style={{ backgroundColor: genderIdentityColor(g.gender) }}
                  />
                  {genderDisplayName(g.gender)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCount(g.base_count)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCount(g.returned_count)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatRate(g.retention_rate)}
                </td>
                {compare && (
                  <td className="px-4 py-2 text-right tabular-nums">
                    <RetentionChange
                      rate={g.retention_rate}
                      priorRate={priorRate.get(g.gender) ?? null}
                      baseCount={g.base_count}
                      compare={compare}
                    />
                  </td>
                )}
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-4 py-2">All</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatCount(data.base_year_total)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatCount(data.returned_count)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatRate(data.overall_retention_rate)}
              </td>
              {compare && prior && (
                <td className="px-4 py-2 text-right tabular-nums">
                  <RetentionChange
                    rate={data.overall_retention_rate}
                    priorRate={prior.overall_retention_rate}
                    baseCount={data.base_year_total}
                    compare={compare}
                  />
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3">
        {noteN !== undefined && (
          <GenderFallbackLine
            n={noteN}
            count={data.gender_fallback_count ?? 0}
            season={`${baseYear} campers`}
          />
        )}
        <ReadWithCareLine
          season={baseYear}
          base={data.base_year_total}
          returned={data.returned_count}
          fallback={data.gender_fallback_count ?? 0}
          fallbackReturned={data.gender_fallback_returned_count ?? 0}
        />
      </div>
    </div>
  )
}
