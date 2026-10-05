import type { ApiAidHouseholdCard, ApiAidHouseholdPage } from '../../../types/api-types'
import { PILL } from '../kit/kitStyles'
import { Money } from '../kit/MoneyText'
import { HouseholdChip } from '../kit/Pills'
import {
  campMinderPersonUrl,
  cardConfirmation,
  cardContactLine,
  cardPlaceLine,
  cardShares,
  firstCamperOf,
  householdChipName,
} from './householdModel'
import { HH_HOUSEHOLD_CARD, HH_NOTE, stripeOf } from './householdStyles'
import { CampMinderLink } from './RequestCard'

/**
 * One household's card (D14, D15; the mock's .hhcard): its chip with the CampMinder Household link
 * at the right, the adults in bold, "household · city", "first adult · phone · email", then its
 * money with the confirmation as pills. A missing field drops out with its separator.
 */
function HouseholdCard({ card, page }: { card: ApiAidHouseholdCard; page: ApiAidHouseholdPage }) {
  const camper = firstCamperOf(page, card.household_cm_id)
  const contact = cardContactLine(card)
  const confirmation = cardConfirmation(card)
  return (
    <div
      data-household={card.household_cm_id}
      className={`${HH_HOUSEHOLD_CARD} ${stripeOf(card.chip)}`}
    >
      <div className="flex items-start gap-2">
        <HouseholdChip index={card.chip} name={householdChipName(page, card.household_cm_id)} />
        {card.household_cm_id === page.household_cm_id && (
          <span className={HH_NOTE}>opened from</span>
        )}
        {camper !== null && (
          <span className="ml-auto">
            {/* The href is the first camper's Person record, so say "Person" until CampMinder's household URL is known (ruled 2026-10-05). */}
            <CampMinderLink
              href={campMinderPersonUrl(camper.personCmId, page.year)}
              label="Person"
            />
          </span>
        )}
      </div>
      {card.adults.length > 0 && <div className="mt-1 font-bold">{card.adults.join(' · ')}</div>}
      <div className={HH_NOTE}>{cardPlaceLine(card)}</div>
      {contact !== '' && <div className={HH_NOTE}>{contact}</div>}
      <div className="border-border mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t pt-1.5">
        <span>
          Decided <Money value={card.money.decided} className="font-bold" />
        </span>
        <span>
          Posted <Money value={card.money.posted} className="font-bold" />
        </span>
        {confirmation.shows !== null && <span className={HH_NOTE}>{confirmation.shows}</span>}
        {confirmation.pills.map((pill) => (
          <span key={pill.text} className={PILL[pill.tone]}>
            {pill.text}
          </span>
        ))}
        <span className={`${HH_NOTE} basis-full`}>{cardShares(card, page)}</span>
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
      className="grid gap-2.5"
      style={{ gridTemplateColumns: `repeat(${String(page.households.length)}, minmax(0, 1fr))` }}
    >
      {page.households.map((card) => (
        <HouseholdCard key={card.household_cm_id} card={card} page={page} />
      ))}
    </div>
  )
}
