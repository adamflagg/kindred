/**
 * A board write-in linked to an adult-weekend Jotform filing (kindred#2759
 * follow-up), opened from its bunking-request mark.
 *
 * BARE-BONES BY DESIGN: the name, a "Write-in" tag, and the one section a
 * write-in has anything to say in -- the filing's bunking request, drawn by the
 * same `BunkingRequestPanel` an adult guest's panel uses. A write-in has no
 * CampMinder record, so there is no placement, party, needs or journey to show.
 * The shell is the family panel's own (`SlideInPanel`).
 */
import type { BunkingRequest } from '../../types/lodging'
import { BunkingRequestPanel } from './BunkingRequestPanel'
import { Section } from './PanelSection'
import { SlideInPanel } from './SlideInPanel'

export interface WriteInDetailsPanelProps {
  /** The write-in's occupant name, as the board shows it. */
  name: string
  request: BunkingRequest
  requestClose?: boolean
  onClose: () => void
}

export function WriteInDetailsPanel({
  name,
  request,
  requestClose = false,
  onClose,
}: WriteInDetailsPanelProps) {
  return (
    <SlideInPanel
      identity={name}
      title={name}
      subtitle="Write-in"
      ariaLabel={`${name} details`}
      requestClose={requestClose}
      onClose={onClose}
      testId="write-in-details-panel"
      backdropTestId="write-in-panel-backdrop"
    >
      <div className="flex flex-col gap-4 p-4">
        <Section title="Bunking request (Jotform)">
          <BunkingRequestPanel key={name} request={request} />
        </Section>
      </div>
    </SlideInPanel>
  )
}
