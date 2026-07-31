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
 * Slice 1 resolves no family names, so `request_text` is shown verbatim with
 * a "needs resolution" badge rather than being silently dropped. It arrives
 * pre-joined from three source fields and is never split back apart.
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
          // Same guard as the chip: an unmapped proximity value from a newer
          // ingest must render as nothing, not crash the row.
          if (!Object.hasOwn(PROXIMITY, kind)) return null
          const entry = PROXIMITY[kind]
          const Icon = entry.icon
          return (
            <span
              key={kind}
              className="bg-muted/60 text-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            >
              <Icon className="h-3 w-3" />
              {entry.label}
            </span>
          )
        })}
      </div>

      {requestText.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs italic">“{requestText}”</p>
          {share.needs_resolution === true && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
              <AlertCircle className="h-3 w-3" />
              Needs resolution
            </span>
          )}
        </div>
      )}
    </div>
  )
}
