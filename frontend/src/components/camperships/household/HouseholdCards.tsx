import type { ApiAidHouseholdCard, ApiAidHouseholdPage } from '../../../types/api-types'
import { Money } from '../kit/MoneyText'
import { HouseholdChip } from '../kit/Pills'
import {
  campMinderPersonUrl,
  cardShares,
  firstCamperOf,
  householdName,
  stateWords,
} from './householdModel'
import { stripeOf } from './householdStyles'

function HouseholdCard({ card, page }: { card: ApiAidHouseholdCard; page: ApiAidHouseholdPage }) {
  const camper = firstCamperOf(page, card.household_cm_id)
  const contact = [
    `household ${String(card.household_cm_id)}`,
    card.phone,
    ...card.emails,
    card.city,
  ]
    .filter((part) => part !== '')
    .join(' · ')
  return (
    <div
      data-household={card.household_cm_id}
      className={`card-lodge space-y-1 p-3 text-sm ${stripeOf(card.chip)}`}
    >
      <div className="flex items-center gap-2">
        <HouseholdChip index={card.chip} name={householdName(page, card.household_cm_id)} />
        {card.household_cm_id === page.household_cm_id && (
          <span className="text-muted-foreground text-xs">opened from</span>
        )}
      </div>
      {card.adults.length > 0 && <div className="font-medium">{card.adults.join(' · ')}</div>}
      <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
        <span>{contact}</span>
        {camper !== null && (
          <a
            href={campMinderPersonUrl(camper.personCmId, page.year)}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {`Open ${camper.name} in CampMinder ↗`}
          </a>
        )}
      </div>
      <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
        <span>
          Decided <Money value={card.money.decided} className="font-semibold" />
        </span>
        <span>
          Posted <Money value={card.money.posted} className="font-semibold" />
        </span>
        {card.money.states.map((state) => (
          <span key={state.status} className="text-xs">
            {stateWords(state)}
          </span>
        ))}
        <span className="text-muted-foreground basis-full text-xs">{cardShares(card, page)}</span>
      </div>
    </div>
  )
}

/**
 * The household cards (§6.3 item 2; D30, D32; round7.html, blend layout): one card per household
 * with a stake, side by side, each with its stripe and chip, adults, contact, CampMinder link
 * (Decision 20), its share of the money, and which shares it pays. One household has no card:
 * its details fold into the band's subtitle. County isn't stored anywhere, so it isn't shown.
 */
export function HouseholdCards({ page }: { page: ApiAidHouseholdPage }) {
  if (page.households.length < 2) return null
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${String(page.households.length)}, minmax(0, 1fr))` }}
    >
      {page.households.map((card) => (
        <HouseholdCard key={card.household_cm_id} card={card} page={page} />
      ))}
    </div>
  )
}
