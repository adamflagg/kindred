/**
 * The panel's request and needs sections, chosen by the party's grain
 * (kindred#2759). A household answers the family share question; an adult
 * weekend guest answers a Jotform. Before this switch both grains got the
 * household sections, so an adult guest saw an EMPTY "Share request" heading.
 *
 * PR A lands the switch with both branches drawing today's two sections
 * (render-identical); PR E gives the person branch its own.
 */
import type { RosterPartyRow } from '../../types/lodging'
import { HousingNeedDetails } from './HousingNeedDetails'
import { Section } from './PanelSection'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface PartyRequestSectionsProps {
  party: RosterPartyRow
  year: number
  /** 0 for a person-grain party (the API sends 0, never omits it). */
  householdCmId: number
}

export function PartyRequestSections({ party, year, householdCmId }: PartyRequestSectionsProps) {
  return (
    <>
      <Section title="Share request">
        <ShareRequestPanel party={party} />
      </Section>

      <Section title="Housing needs">
        {/* ONE component now, not two. `AccessibilityFlagList` still serves
            `HouseholdRosterRow`, where 62 rows must not fetch medical; this
            panel shows one household, so its rows carry their own words.
            kindred#2255's section 2 is superseded -- the duplication it
            proposed collapsing behind a click is removed instead. */}
        <HousingNeedDetails
          party={party}
          householdCmId={householdCmId > 0 ? householdCmId : null}
          year={year}
        />
      </Section>
    </>
  )
}
