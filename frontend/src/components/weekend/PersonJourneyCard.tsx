/**
 * An adult weekend guest's camper journey in the Women's/Men's Weekend
 * sidebar. The SAME rows and the SAME card the camper record uses: the
 * current year's enrollments — every program, with or without a cabin yet,
 * a 21+ guest's family weekends as a parent included — then the prior years
 * (owner rulings 2026-09-24, kindred#2812; this sidebar used to stop at last
 * year). `compact`, like every sidebar (owner ruling 2026-09-22, late): a
 * family weekend shows its bare title, no subtitle.
 */
import { useCamperJourneyWithCurrentYear } from '../../hooks/camper/useCamperJourneyWithCurrentYear'
import { CampJourneyTimeline } from '../camper/CampJourneyTimeline'

export function PersonJourneyCard({ personCmId, year }: { personCmId: number; year: number }) {
  const { history, counts, isLoading, error } = useCamperJourneyWithCurrentYear(personCmId, year)
  return (
    <div data-testid="person-journey">
      <CampJourneyTimeline
        history={history}
        counts={counts}
        currentYear={year}
        isLoading={isLoading}
        error={error}
        variant="compact"
      />
    </div>
  )
}

export default PersonJourneyCard
