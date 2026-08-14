/**
 * A household's cabin-sharing request, unresolved.
 *
 * NEAR and WITH are DIFFERENT requests and must never render alike: NEAR is
 * satisfied by map distance between assigned units, WITH by placing both
 * parties in the same unit. `similar_ages` ACCOMPANIES `with` rather than
 * replacing it — showing one or the other would drop those households out of
 * any "wants to share a cabin" view.
 *
 * Everything here is READ from an ingest-derived column. Nothing is
 * re-parsed from the raw share/modes/request answers: the Go normaliser
 * carries fixes this layer would lose, most importantly the guard that stops
 * the modes field's own "No requests" option reading as a hard decline.
 *
 * The verbatim text uses the same amber blockquote the camper details panel
 * uses for parent request text, so a request reads the same wherever staff
 * meet one. It arrives pre-joined from three source fields and is never split.
 *
 * ## No permission gate on request_text
 *
 * `request_text` has no permission check at all, while `MedicalNarrative`
 * (rendered beside it in `FamilyDetailsPanel`) is gated on `bunking.manage`.
 * The split is intentional: `request_text` is a placement input — why a
 * household wants a particular cabin or setting is a legitimate placement
 * concern for any authenticated user to see, the same way the rest of the
 * roster is. The field is not modelled as PHI (it is free text, not a
 * structured medical disclosure), even though it sometimes contains health
 * detail. `MedicalNarrative` covers the field that IS structured PHI: the
 * formal medical accommodations questionnaire (kindred#2312: that gate used
 * to be a separate `lodging.phi` permission, removed because RBAC here is
 * screen-reduction, not a data boundary, and every sibling endpoint on the
 * lodging router already gated on `bunking.manage`).
 */
import { AlertCircle, MapPin, Users } from 'lucide-react'

import type { ProximityKindValue, ShareRequest } from '../../types/lodging'
import { SharePreferenceChip } from './SharePreferenceChip'

const PROXIMITY: Record<ProximityKindValue, { label: string; icon: typeof MapPin }> = {
  near: { label: 'Near another family', icon: MapPin },
  with: { label: 'Same cabin as another family', icon: Users },
  similar_ages: { label: 'With similarly-aged kids', icon: Users },
}

export interface ShareRequestPanelProps {
  share: ShareRequest
}

export function ShareRequestPanel({ share }: ShareRequestPanelProps) {
  const proximity = share.proximity ?? []
  const requestText = share.request_text ?? ''

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SharePreferenceChip
          preference={share.preference ?? 'unknown'}
          raw={share.preference_raw}
        />
        {proximity.map((kind) => {
          // An unmapped proximity value from a newer ingest renders as
          // nothing rather than crashing the row.
          if (!Object.hasOwn(PROXIMITY, kind)) return null
          const entry = PROXIMITY[kind]
          const Icon = entry.icon
          return (
            <span
              key={kind}
              className="bg-muted/60 text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              <Icon className="h-3 w-3 flex-shrink-0" />
              {entry.label}
            </span>
          )
        })}
      </div>

      {requestText.length > 0 && (
        <blockquote className="text-foreground rounded-r-lg border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm whitespace-pre-wrap italic dark:border-amber-500/60 dark:bg-amber-900/20">
          {requestText}
          {share.needs_resolution === true && (
            <span className="text-muted-foreground mt-1 flex items-center gap-1 text-xs not-italic">
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              Needs resolution
            </span>
          )}
        </blockquote>
      )}
    </div>
  )
}
