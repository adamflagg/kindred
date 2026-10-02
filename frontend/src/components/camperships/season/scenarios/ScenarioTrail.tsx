import type { ApiAidScenarioTrailPage } from '../../../../types/api-types'
import { BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { formatCampDateTime } from '../../kit/dates'
import { HIGHLIGHT_EDGE, ROW_HIGHLIGHT, TABLE_CARD } from '../../kit/kitStyles'
import { Money } from '../../kit/MoneyText'
import { TD_LABEL, TD_MONEY, TD_TEXT, TH_LABEL, TH_MONEY } from '../seasonStyles'

/**
 * The trail (spec §7.4; D38): every setting anyone let go of, newest first, with its results, who and
 * when, kept or not. Any row loads back into your draft, which is recorded too, so nothing is lost.
 * Load is never held while a write runs: the hook queues it after the write, as for a kept option.
 */
export function ScenarioTrail({
  trail,
  current,
  stale,
  onLoad,
  onPage,
}: {
  trail: ApiAidScenarioTrailPage
  /** The trail row your draft is on (`draft.trail_id`): highlighted, as the kept list's current. */
  current: string | null
  /** The page shown is the previous one while the next loads. */
  stale: boolean
  onLoad: (trailRow: string) => void
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(trail.total / trail.per_page))
  return (
    <div className="space-y-2" data-testid="scenario-trail">
      {/* Its slot is always there, so nothing jumps when a page is on its way. */}
      <p className={`text-muted-foreground text-xs ${stale ? '' : 'invisible'}`}>Updating…</p>
      {trail.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing recorded in your draft's trail yet.</p>
      ) : (
        <div
          className={`${TABLE_CARD} ${stale ? 'opacity-60' : ''}`}
          data-testid="scenario-trail-table"
          data-stale={stale ? '' : undefined}
        >
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={TH_LABEL}>#</th>
                <th className={TH_LABEL}>When</th>
                <th className={TH_LABEL}>What changed</th>
                <th className={TH_MONEY}>Round 1</th>
                <th className={TH_MONEY}>Round 1 remaining</th>
                <th className={TH_MONEY}>At the minimum</th>
                <th className={TH_LABEL}>Kept</th>
                <th className={TH_LABEL} />
              </tr>
            </thead>
            <tbody>
              {trail.rows.map((row, index) => (
                <tr
                  key={row.id}
                  data-trail-row={row.id}
                  className={row.id === current ? `${ROW_HIGHLIGHT} ${HIGHLIGHT_EDGE}` : ''}
                >
                  {/* Numbered oldest first, as the mock does, newest listed first. */}
                  <td className={`${TD_LABEL} tabular-nums`}>
                    {trail.total - (trail.page - 1) * trail.per_page - index}
                  </td>
                  <td className={TD_LABEL}>
                    {formatCampDateTime(row.recorded_at)}
                    <div className="text-muted-foreground text-xs">{row.actor}</div>
                  </td>
                  <td className={TD_TEXT}>
                    {row.change}
                    <div className="text-muted-foreground text-xs">
                      {`draft from ${row.from_code}`}
                      {row.stale ? ' · figures from an older snapshot' : ''}
                    </div>
                  </td>
                  <td className={TD_MONEY}>
                    <Money value={row.round1} />
                  </td>
                  <td className={TD_MONEY}>
                    <Money value={row.round1_remaining} />
                  </td>
                  <td className={TD_MONEY}>{row.at_minimum ?? '—'}</td>
                  <td className={`${TD_LABEL} font-mono font-bold`}>{row.kept_code ?? ''}</td>
                  <td className={TD_LABEL}>
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      onClick={() => onLoad(row.id)}
                    >
                      Load
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={trail.page <= 1}
            onClick={() => onPage(trail.page - 1)}
          >
            Newer
          </button>
          <span className="text-muted-foreground">{`Page ${String(trail.page)} of ${String(pages)}`}</span>
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={trail.page >= pages}
            onClick={() => onPage(trail.page + 1)}
          >
            Older
          </button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Recorded when a setting is let go of, not on every move. Load puts that row back in your
        draft; keep it from there.
      </p>
    </div>
  )
}
