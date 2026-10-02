import type { ReactNode } from 'react'

import type { ApiAidHouseholdTotals } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import { formatMoney, toCents } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { postedLabel } from './householdModel'
import { FAMILY_SHARE_INK } from './householdStyles'

function Figure({ value, label, ink }: { value: number | null; label: ReactNode; ink: string }) {
  return (
    <div className="text-right">
      {/* Every band figure is zero or more (the share is floored per request), so the red minus never meets this ink. */}
      <Money value={value} className={`font-display block text-lg font-bold sm:text-xl ${ink}`} />
      <span className="text-forest-200 text-xs whitespace-nowrap">{label}</span>
    </div>
  )
}

function Op({ sign }: { sign: string }) {
  return <span className="text-forest-300 pb-4 text-lg">{sign}</span>
}

/**
 * ⚠ Decision 38(b): the server floors each request's share at $0 before summing, so the figures don't
 * always satisfy cost − aid − grants applied = share (one request's aid alone can pass its cost). The
 * operators are drawn only when they do, to the cent; otherwise the figures sit side by side.
 */
function addsUp(t: ApiAidHouseholdTotals, grants: number | null): boolean {
  if (t.cost === null || t.decided === null || grants === null || t.family_share === null)
    return false
  return toCents(t.cost) - toCents(t.decided) - toCents(grants) === toCents(t.family_share)
}

/**
 * The household totals in the band, option B2 (§6.3 item 1; D77; household-totals.html): cost − aid
 * (decided) − grants = the family's share, then Posted with its confirmation folded into its label.
 * One row at the band's own height, and a second line when grants passed what was owed. "—" where a
 * figure isn't there yet. Each label carries its note number from the `household` definitions (§4.8).
 */
export function HouseholdTotals({
  totals,
  numberOf,
}: {
  totals: ApiAidHouseholdTotals
  numberOf: (key: string) => number | null
}) {
  const label = (text: string, key: string) => {
    const n = numberOf(key)
    return (
      <>
        <span>{text}</span>
        {n !== null && <DefRef n={n} />}
      </>
    )
  }
  const applied = totals.grants_applied ?? null
  const grants = applied ?? totals.grants
  const beyond = totals.grants_beyond_owed ?? 0
  const equation = addsUp(totals, grants)
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <Figure value={totals.cost} label={label('cost', 'cost')} ink="text-white" />
        <Op sign={equation ? '−' : '·'} />
        <Figure
          value={totals.decided}
          label={label(
            totals.decided_partial === true ? 'aid, decided so far' : 'aid, decided',
            'decided'
          )}
          ink="text-white"
        />
        <Op sign={equation ? '−' : '·'} />
        <Figure
          value={grants}
          label={label(applied === null ? 'grants' : 'grants applied', 'grants')}
          ink="text-white"
        />
        <Op sign={equation ? '=' : '·'} />
        <Figure
          value={totals.family_share}
          label={label("family's share", 'family_share')}
          ink={FAMILY_SHARE_INK}
        />
        <div className="ml-2 border-l border-white/20 pl-4">
          <Figure
            value={totals.posted}
            label={label(postedLabel(totals.states), 'posted')}
            ink="text-white"
          />
        </div>
      </div>
      {beyond > 0 && (
        <p className="text-forest-200 text-xs">
          +{formatMoney(beyond)} in grants beyond what was owed
        </p>
      )}
    </div>
  )
}
