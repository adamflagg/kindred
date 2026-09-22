/**
 * An adult weekend guest's camper journey in the Women's/Men's Weekend
 * sidebar. The SAME feed and the SAME card
 * the camper record uses — prior years only, like the summer board's sidebar.
 */
import { useCamperJourney } from '../../hooks/camper/useCamperJourney'
import { CampJourneyTimeline } from '../camper/CampJourneyTimeline'

export function PersonJourneyCard({ personCmId, year }: { personCmId: number; year: number }) {
  const { rows, counts, isLoading } = useCamperJourney(personCmId, year)
  return (
    <div data-testid="person-journey">
      <CampJourneyTimeline
        history={rows}
        counts={counts}
        currentYear={year}
        isLoading={isLoading}
      />
    </div>
  )
}

export default PersonJourneyCard
