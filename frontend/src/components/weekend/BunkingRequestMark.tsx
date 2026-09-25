/**
 * The adult card's Handshake bunking-request mark, alone (kindred#2759
 * follow-up): what the Push write-ins deck and the Compare modal draw beside a
 * Jotform-linked write-in's name. The anchor run only -- solid, muted or
 * dotted, with the changed dot -- exactly as `resolveBunkingRequestRuns`
 * grades it for a `FamilyCard`; the coming-with capsule stays on the cards.
 */
import type { BunkingRequest } from '../../types/lodging'
import { resolveBunkingRequestRuns } from './bunkingRequest'
import { MarkRuns } from './MarkRun'

export function BunkingRequestMark({ request }: { request: BunkingRequest }) {
  return (
    <MarkRuns
      runs={resolveBunkingRequestRuns(request).filter((run) => run.key === 'bunking-anchor')}
    />
  )
}
