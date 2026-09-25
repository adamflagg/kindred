/**
 * The panel's request and needs sections (kindred#2759). A household answers
 * the family share question; an adult weekend guest answers a Jotform. Before
 * this switch both got the household sections, so an adult guest saw an
 * EMPTY "Share request" heading.
 *
 * The adult branch keys on the WEEKEND's type (`isAdultSessionType`) as well
 * as the person grain — never on grain alone.
 */
import type { RosterPartyRow } from '../../types/lodging'
import { isAdultSessionType } from '../../utils/sessionTypePredicates'
import { BunkingRequestPanel } from './BunkingRequestPanel'
import { HousingNeedDetails } from './HousingNeedDetails'
import { Section } from './PanelSection'
import { ShareRequestPanel } from './ShareRequestPanel'

export interface PartyRequestSectionsProps {
  party: RosterPartyRow
  year: number
  /** 0 for a person-grain party (the API sends 0, never omits it). */
  householdCmId: number
  /**
   * The weekend's `session_type`, read ONLY through `isAdultSessionType` —
   * never inferred from the party's grain. An adult weekend's guest gets the
   * Jotform section and registration-tagged needs.
   */
  sessionType?: string | undefined
}

export function PartyRequestSections({
  party,
  year,
  householdCmId,
  sessionType,
}: PartyRequestSectionsProps) {
  if (party.grain === 'person' && isAdultSessionType(sessionType)) {
    const request = party.bunking_request ?? null
    return (
      <>
        {/* Absent when the payload withholds it (no bunking.manage): no empty heading. */}
        {request !== null && (
          <Section title="Bunking request (Jotform)">
            <BunkingRequestPanel key={party.person_cm_id ?? 0} request={request} />
          </Section>
        )}
        <Section title="Housing needs (Registration)">
          <HousingNeedDetails
            party={party}
            householdCmId={null}
            year={year}
            jotformSays={request?.jotform_says ?? []}
            sourceTag="Registration"
          />
        </Section>
      </>
    )
  }

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
